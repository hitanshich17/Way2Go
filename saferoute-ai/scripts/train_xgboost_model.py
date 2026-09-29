#!/usr/bin/env python3
"""
SafeRouteAI — XGBoost Spatiotemporal Crime Risk Model
======================================================
Trains a gradient-boosted classifier on real PPD crime data using:
  - Geographic coordinates (lat, lng)
  - Cyclical time features  (hour_sin, hour_cos)
  - Day/night flag          (is_night)
  - KDE baseline scores     (kde_day, kde_night, kde_current)
  - Crime severity          (severity)
  - Crime type encoding     (crime_type)

Outputs:
  public/xgb-grid-predictions.json  — per-cell × 24-hour risk matrix (fast browser lookup)
  .xgb-cache.json                   — data hash so we skip retraining when data is unchanged

Uses XGBoost when available; falls back to a pure-numpy gradient-boosted decision
tree implementation so the script works everywhere without extra installs.

Usage:
  python3 scripts/train_xgboost_model.py           # trains (cached on subsequent runs)
  python3 scripts/train_xgboost_model.py --retrain # forces full retrain
"""

import json, hashlib, sys, time, os
import numpy as np
from datetime import datetime
from pathlib import Path

ROOT       = Path(__file__).parent.parent
CRIMES_F   = ROOT / 'data'   / 'crimes.json'
GRID_F     = ROOT / 'public' / 'risk-grid.json'
XGB_OUT    = ROOT / 'public' / 'xgb-grid-predictions.json'
CACHE_F    = ROOT / '.xgb-cache.json'

FEATURE_NAMES = ['lat', 'lng', 'hour_sin', 'hour_cos', 'is_night',
                 'kde_day', 'kde_night', 'kde_current', 'severity', 'crime_type']

CRIME_TYPES = [
    'THEFT', 'ASSAULT', 'ROBBERY', 'VEHICLE_THEFT', 'BURGLARY',
    'VANDALISM', 'DRUG_OFFENSE', 'WEAPON_OFFENSE', 'SEXUAL_OFFENSE',
    'HOMICIDE', 'OTHER_OFFENSE', 'FRAUD', 'DUI', 'ARSON', 'KIDNAPPING',
]
def encode_type(t):
    try:    return CRIME_TYPES.index(t)
    except: return len(CRIME_TYPES)

CELL_SIZE = 0.001
def snap(lat, lng):
    return f"{round(lat/CELL_SIZE)*CELL_SIZE:.4f},{round(lng/CELL_SIZE)*CELL_SIZE:.4f}"

def make_features(lat, lng, hour, kde_day, kde_night, crime_type_enc, severity):
    h_sin    = np.sin(2 * np.pi * hour / 24)
    h_cos    = np.cos(2 * np.pi * hour / 24)
    is_night = 1 if (hour < 6 or hour >= 20) else 0
    kde_cur  = kde_night if is_night else kde_day
    return [lat, lng, h_sin, h_cos, is_night, kde_day, kde_night, kde_cur, severity, crime_type_enc]

# ─── Pure-numpy Gradient Boosting (fallback when XGBoost not installed) ────────

class _Tree:
    """Depth-limited regression tree for gradient boosting."""

    def __init__(self, max_depth=3, min_samples=8):
        self.max_depth   = max_depth
        self.min_samples = min_samples
        self.root        = None

    @staticmethod
    def _best_split(X, r):
        best, best_loss = None, np.inf
        n = len(r)
        for feat in range(X.shape[1]):
            thresholds = np.percentile(X[:, feat], [15, 30, 45, 60, 75, 90])
            for thresh in thresholds:
                m = X[:, feat] <= thresh
                nl, nr = m.sum(), (~m).sum()
                if nl < 4 or nr < 4:
                    continue
                loss = np.var(r[m]) * nl + np.var(r[~m]) * nr
                if loss < best_loss:
                    best_loss, best = loss, (feat, thresh, m)
        return best

    def _build(self, X, r, depth):
        if depth >= self.max_depth or len(r) < self.min_samples:
            return ('leaf', float(np.mean(r)))
        sp = self._best_split(X, r)
        if sp is None:
            return ('leaf', float(np.mean(r)))
        feat, thresh, mask = sp
        return ('split', feat, thresh,
                self._build(X[mask], r[mask], depth + 1),
                self._build(X[~mask], r[~mask], depth + 1))

    def fit(self, X, residuals):
        self.root = self._build(X, residuals, 0)
        return self

    def _pred(self, X, node):
        if node[0] == 'leaf':
            return np.full(len(X), node[1])
        _, feat, thresh, left, right = node
        out  = np.empty(len(X))
        mask = X[:, feat] <= thresh
        if mask.any():    out[mask]  = self._pred(X[mask],  left)
        if (~mask).any(): out[~mask] = self._pred(X[~mask], right)
        return out

    def predict(self, X):
        return self._pred(X, self.root)


class NumpyGBC:
    """
    Gradient Boosted Classifier (log-loss) built on pure numpy _Tree.
    API mirrors sklearn/XGBoost: fit(X,y) / predict_proba(X) / predict(X).
    """

    def __init__(self, n_estimators=80, learning_rate=0.12, max_depth=3, subsample=0.8):
        self.n_estimators  = n_estimators
        self.learning_rate = learning_rate
        self.max_depth     = max_depth
        self.subsample     = subsample
        self.trees         = []
        self.F0            = 0.0

    @staticmethod
    def _sigmoid(x):
        return 1.0 / (1.0 + np.exp(-np.clip(x, -15, 15)))

    def fit(self, X, y):
        p0 = np.clip(y.mean(), 1e-7, 1 - 1e-7)
        self.F0 = float(np.log(p0 / (1 - p0)))
        F = np.full(len(y), self.F0)
        n_sub = max(8, int(len(y) * self.subsample))

        for i in range(self.n_estimators):
            p         = self._sigmoid(F)
            residuals = y - p                         # negative log-loss gradient
            idx       = np.random.choice(len(y), n_sub, replace=False)
            tree      = _Tree(self.max_depth).fit(X[idx], residuals[idx])
            update    = tree.predict(X)
            F        += self.learning_rate * update
            self.trees.append(tree)

            if (i + 1) % 20 == 0:
                loss = -np.mean(y * np.log(p + 1e-10) + (1 - y) * np.log(1 - p + 1e-10))
                acc  = ((p >= 0.5) == y).mean()
                print(f"      [{i+1:>3}/{self.n_estimators}] log-loss: {loss:.4f}  acc: {acc*100:.1f}%")
        return self

    def _score(self, X):
        F = np.full(len(X), self.F0)
        for tree in self.trees:
            F += self.learning_rate * tree.predict(X)
        return F

    def predict_proba(self, X):
        probs = self._sigmoid(self._score(X))
        return np.column_stack([1 - probs, probs])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

    # Approximate feature importance via permutation on training residuals
    def feature_importances_(self, X, y):
        base_loss = -np.mean(y * np.log(self._sigmoid(self._score(X)) + 1e-10))
        imps = []
        for f in range(X.shape[1]):
            Xp = X.copy(); np.random.shuffle(Xp[:, f])
            loss = -np.mean(y * np.log(self._sigmoid(self._score(Xp)) + 1e-10))
            imps.append(max(0.0, loss - base_loss))
        total = sum(imps) or 1
        return np.array([v / total for v in imps])


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    force = '--retrain' in sys.argv

    # ── Try real XGBoost first ──────────────────────────────────────────────
    try:
        import xgboost as xgb
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import (roc_auc_score, accuracy_score,
                                     precision_score, recall_score, f1_score)
        BACKEND = f'XGBoost {xgb.__version__}'
    except ImportError:
        xgb = None
        BACKEND = 'numpy-GBT (pure numpy fallback)'
        print("ℹ️  XGBoost not installed — using built-in numpy gradient boosting.")
        print("   For faster training: pip3 install xgboost scikit-learn\n")

    print("=" * 62)
    print("  SafeRouteAI — Spatiotemporal Crime Risk Model")
    print(f"  Backend: {BACKEND}")
    print("=" * 62)

    # ── Cache check ─────────────────────────────────────────────────────────
    data_hash = hashlib.md5(CRIMES_F.read_bytes()).hexdigest()
    if not force and CACHE_F.exists() and XGB_OUT.exists():
        cache = json.loads(CACHE_F.read_text())
        if cache.get('data_hash') == data_hash:
            print(f"\n✅  XGB predictions already cached — skipping training")
            print(f"    Generated: {cache.get('generated_at', 'unknown')}")
            print(f"    Run with --retrain to force rebuild\n")
            return
    if force:
        print("  ⚡ --retrain flag detected — rebuilding from scratch\n")

    t0 = time.time()

    # ── Load data ───────────────────────────────────────────────────────────
    print("\n[1/6] Loading crime data and KDE grid...")
    crimes    = json.loads(CRIMES_F.read_text())
    grid_data = json.loads(GRID_F.read_text())
    grid      = grid_data['grid']
    print(f"      {len(crimes):,} crime incidents  |  {len(grid):,} grid cells")

    # ── Positive samples (actual crimes) ───────────────────────────────────
    print("\n[2/6] Building positive samples (actual crime incidents)...")
    X_pos, y_pos = [], []
    for c in crimes:
        ck   = snap(c['lat'], c['lng'])
        cell = grid.get(ck, {'d': 0.0, 'n': 0.0})
        X_pos.append(make_features(
            c['lat'], c['lng'], c['hour'],
            cell['d'], cell['n'],
            encode_type(c['type']), c['severity']
        ))
        y_pos.append(1)
    print(f"      {len(X_pos):,} positive samples")

    # ── Negative samples (random safe locations) ────────────────────────────
    print("\n[3/6] Building negative samples (safe-area simulation)...")
    meta      = grid_data['meta']
    safe_cells = [(k, v) for k, v in grid.items() if v['d'] < 15 and v['n'] < 15]
    n_neg     = len(crimes)
    np.random.seed(42)
    X_neg, y_neg = [], []
    for _ in range(n_neg):
        ck, cv  = safe_cells[np.random.randint(len(safe_cells))]
        lat_c, lng_c = map(float, ck.split(','))
        lat  = lat_c + np.random.uniform(-CELL_SIZE / 2, CELL_SIZE / 2)
        lng  = lng_c + np.random.uniform(-CELL_SIZE / 2, CELL_SIZE / 2)
        hour = int(np.random.randint(0, 24))
        X_neg.append(make_features(lat, lng, hour, cv['d'], cv['n'],
                                   int(np.random.randint(0, len(CRIME_TYPES))), 2))
        y_neg.append(0)
    print(f"      {len(X_neg):,} negative samples  (balanced 1:1 ratio)")

    # ── Combine & subsample for speed ───────────────────────────────────────
    X_all = np.array(X_pos + X_neg, dtype=np.float64)
    y_all = np.array(y_pos + y_neg, dtype=np.float64)
    # Stratified subsample for the numpy backend (XGBoost handles the full set fine)
    if xgb is None:
        MAX_TRAIN = 14000
        if len(X_all) > MAX_TRAIN:
            idx_pos = np.where(y_all == 1)[0]
            idx_neg = np.where(y_all == 0)[0]
            half    = MAX_TRAIN // 2
            keep    = np.concatenate([
                np.random.choice(idx_pos, half, replace=False),
                np.random.choice(idx_neg, half, replace=False),
            ])
            np.random.shuffle(keep)
            X_all, y_all = X_all[keep], y_all[keep]
    print(f"      Training set: {len(X_all):,} samples total")

    # ── Train / test split ──────────────────────────────────────────────────
    print("\n[4/6] Training model...")
    split = int(len(X_all) * 0.8)
    idx   = np.random.permutation(len(X_all))
    tr, te = idx[:split], idx[split:]
    X_train, X_test = X_all[tr], X_all[te]
    y_train, y_test = y_all[tr], y_all[te]
    print(f"      Train: {len(X_train):,}  |  Test: {len(X_test):,}")

    t_train = time.time()
    if xgb is not None:
        model = xgb.XGBClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.08,
            subsample=0.8, colsample_bytree=0.8,
            eval_metric='logloss', random_state=42, n_jobs=-1,
        )
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
        feat_imp = dict(zip(FEATURE_NAMES, model.feature_importances_))
    else:
        model = NumpyGBC(n_estimators=80, learning_rate=0.12, max_depth=3, subsample=0.8)
        model.fit(X_train, y_train)
        raw_imp = model.feature_importances_(X_test, y_test)
        feat_imp = dict(zip(FEATURE_NAMES, raw_imp))

    print(f"      Training done in {time.time()-t_train:.1f}s")

    # ── Accuracy metrics ────────────────────────────────────────────────────
    print("\n[5/6] Evaluating model accuracy...")
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    tp = int(((y_pred == 1) & (y_test == 1)).sum())
    tn = int(((y_pred == 0) & (y_test == 0)).sum())
    fp = int(((y_pred == 1) & (y_test == 0)).sum())
    fn = int(((y_pred == 0) & (y_test == 1)).sum())
    acc  = (tp + tn) / len(y_test)
    prec = tp / (tp + fp) if (tp + fp) else 0
    rec  = tp / (tp + fn) if (tp + fn) else 0
    f1   = 2 * prec * rec / (prec + rec) if (prec + rec) else 0

    # AUC-ROC (trapezoid rule, no sklearn needed)
    sort_idx = np.argsort(-y_prob)
    s_label  = y_test[sort_idx]
    s_prob   = y_prob[sort_idx]
    tpr_list, fpr_list = [0.0], [0.0]
    P, N = y_test.sum(), (y_test == 0).sum()
    tp_r = fp_r = 0
    for lb in s_label:
        if lb == 1: tp_r += 1
        else:       fp_r += 1
        tpr_list.append(tp_r / P)
        fpr_list.append(fp_r / N)
    auc = float(np.trapz(tpr_list, fpr_list))

    metrics = {
        'auc_roc':   round(abs(auc), 4),
        'accuracy':  round(acc,  4),
        'precision': round(prec, 4),
        'recall':    round(rec,  4),
        'f1_score':  round(f1,   4),
        'true_positives':  tp,
        'true_negatives':  tn,
        'false_positives': fp,
        'false_negatives': fn,
        'test_samples':    len(y_test),
        'train_samples':   len(X_train),
    }

    print(f"\n  ┌─────────────────────────────────────┐")
    print(f"  │  AUC-ROC   {metrics['auc_roc']:.4f}  ({metrics['auc_roc']*100:.1f}%)        │")
    print(f"  │  Accuracy  {acc:.4f}  ({acc*100:.1f}%)        │")
    print(f"  │  Precision {prec:.4f}  ({prec*100:.1f}%)        │")
    print(f"  │  Recall    {rec:.4f}  ({rec*100:.1f}%)        │")
    print(f"  │  F1 Score  {f1:.4f}                   │")
    print(f"  └─────────────────────────────────────┘")

    # Feature importance
    sorted_imp = sorted(feat_imp.items(), key=lambda x: -x[1])
    print(f"\n  Feature importances:")
    for name, imp in sorted_imp:
        bar = '█' * int(imp * 35)
        print(f"    {name:<14} {bar:<35} {imp:.3f}")

    # ── Pre-generate per-cell × 24-hour prediction matrix ──────────────────
    print(f"\n[6/6] Pre-generating grid predictions ({len(grid):,} cells × 24 hours)...")
    predictions = {}
    cell_keys   = list(grid.keys())
    batch_size  = 200

    for i in range(0, len(cell_keys), batch_size):
        batch = cell_keys[i : i + batch_size]
        rows  = []
        for ck in batch:
            cv = grid[ck]
            lat_c, lng_c = map(float, ck.split(','))
            for hour in range(24):
                rows.append(make_features(lat_c, lng_c, hour, cv['d'], cv['n'], 0, 5))
        X_batch = np.array(rows, dtype=np.float64)
        probs   = model.predict_proba(X_batch)[:, 1]
        for j, ck in enumerate(batch):
            slice_ = probs[j * 24 : (j + 1) * 24]
            predictions[ck] = [round(float(p * 100), 1) for p in slice_]

        done = min(i + batch_size, len(cell_keys))
        if done % 400 == 0 or done == len(cell_keys):
            print(f"      {done}/{len(cell_keys)} cells ({100*done/len(cell_keys):.0f}%)")

    # ── Save output ─────────────────────────────────────────────────────────
    output = {
        'meta': {
            'generated_at':    datetime.now().isoformat(),
            'backend':         BACKEND,
            'total_cells':     len(predictions),
            'hours_per_cell':  24,
            'feature_names':   FEATURE_NAMES,
            'metrics':         metrics,
            'feature_importance': {k: round(float(v), 4) for k, v in sorted_imp},
            'scoring': 'predict_proba(crime_occurs) × 100  →  0–100 risk scale',
            'hybrid_weight': 'UI: 0.35 × KDE  +  0.65 × XGB  (togglable)',
        },
        'predictions': predictions,
    }
    XGB_OUT.write_text(json.dumps(output, separators=(',', ':')))
    size_kb = XGB_OUT.stat().st_size / 1024
    print(f"\n✅  Saved xgb-grid-predictions.json ({size_kb:.0f} KB)")

    CACHE_F.write_text(json.dumps({
        'data_hash':    data_hash,
        'generated_at': datetime.now().isoformat(),
        'backend':      BACKEND,
        'auc_roc':      metrics['auc_roc'],
        'accuracy':     metrics['accuracy'],
    }))

    elapsed = time.time() - t0
    print(f"\n{'='*62}")
    print(f"  Training complete in {elapsed:.1f}s")
    print(f"  AUC-ROC: {metrics['auc_roc']*100:.1f}%  |  Accuracy: {acc*100:.1f}%  |  F1: {f1:.3f}")
    print(f"{'='*62}\n")


if __name__ == '__main__':
    if '--retrain' in sys.argv and CACHE_F.exists():
        CACHE_F.unlink()
    main()
