#!/usr/bin/env python3
"""
SafeRouteAI — Spatial Risk Model Training Script
================================================
Trains a weighted Gaussian KDE model on real Philadelphia Police Department
crime data and outputs a pre-computed risk grid used by the app.

Usage:
  python3 scripts/train_risk_model.py            # train (skips if cached)
  python3 scripts/train_risk_model.py --retrain  # force retrain

Requirements: numpy (no other dependencies)
"""

import json, os, sys, time, hashlib
import numpy as np
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CRIMES_FILE    = os.path.join(PROJECT_DIR, 'data',   'crimes.json')
RISK_GRID_FILE = os.path.join(PROJECT_DIR, 'public', 'risk-grid.json')
HEATMAP_FILE   = os.path.join(PROJECT_DIR, 'public', 'heatmap-points.json')
CACHE_FILE     = os.path.join(PROJECT_DIR, 'public', '.model-cache.json')

# ── Model config ───────────────────────────────────────────────────────────────
CELL_SIZE          = 0.001        # grid cell ≈ 111m per side
BANDWIDTH          = 0.0020       # KDE smoothing radius ≈ 220m
LAT_MIN, LAT_MAX   = 39.945, 39.970
LNG_MIN, LNG_MAX   = -75.206, -75.148
KDE_CHUNK          = 200          # process grid cells in batches (memory control)

SEVERITY_WEIGHTS = {
    'HOMICIDE': 10, 'RAPE': 9, 'AGGRAVATED_ASSAULT': 9,
    'SEX_OFFENSE': 7, 'ROBBERY': 8, 'WEAPON_VIOLATION': 7,
    'ARSON': 7, 'FAMILY_OFFENSE': 6, 'DRUG_OFFENSE': 6,
    'ASSAULT': 5, 'BURGLARY': 5, 'RECEIVING_STOLEN': 4,
    'VEHICLE_THEFT': 4, 'THEFT_FROM_VEHICLE': 4, 'THEFT': 3,
    'VANDALISM': 2, 'OTHER_OFFENSE': 2, 'DISORDERLY': 1,
    'DUI': 1, 'PUBLIC_DRUNK': 1, 'VICE': 2, 'LIQUOR': 1, 'VAGRANCY': 1,
}

# ── Utilities ──────────────────────────────────────────────────────────────────

def banner():
    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║          SafeRouteAI  —  Risk Model Training             ║")
    print("║   Weighted Gaussian KDE on Philadelphia crime data       ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()

def progress_bar(done, total, width=42, label=''):
    pct    = done / max(total, 1)
    filled = int(width * pct)
    bar    = '█' * filled + '░' * (width - filled)
    end    = '\n' if done >= total else ''
    print(f'\r  [{bar}] {pct*100:5.1f}%  {label}', end=end, flush=True)

def data_hash(crimes):
    s = f"{len(crimes)}{crimes[0]}{crimes[-1]}"
    return hashlib.md5(s.encode()).hexdigest()[:10]

# ── Step 1 — Load ──────────────────────────────────────────────────────────────

def load_crimes():
    print("📂  Step 1/6 — Loading crime data")
    if not os.path.exists(CRIMES_FILE):
        print(f"  ❌  data/crimes.json not found — run data conversion first")
        sys.exit(1)
    with open(CRIMES_FILE) as f:
        crimes = json.load(f)
    by_type = {}
    for c in crimes:
        by_type[c['type']] = by_type.get(c['type'], 0) + 1
    print(f"  ✅  {len(crimes):,} total incidents loaded")
    print(f"  ✅  {len(by_type)} crime categories")
    for t, n in sorted(by_type.items(), key=lambda x: -x[1])[:6]:
        print(f"       {t:<30}  {n:>6,}")
    print(f"       ... and {max(0, len(by_type)-6)} more types")
    return crimes

# ── Step 2 — Cache check ───────────────────────────────────────────────────────

def check_cache(crimes):
    print("\n🔎  Step 2/6 — Checking cache")
    if not os.path.exists(CACHE_FILE) or not os.path.exists(RISK_GRID_FILE):
        print("  ℹ️   No cache found — training from scratch")
        return False
    try:
        with open(CACHE_FILE) as f:
            cache = json.load(f)
        h = data_hash(crimes)
        if cache.get('data_hash') == h:
            print(f"  ✅  Cache hit!  (built {cache.get('generated_at','?')[:19]})")
            print(f"  ✅  Data unchanged ({h}) — skipping training")
            print(f"\n  💡  Force retrain:  npm run train:force\n")
            return True
        print("  ♻️   Data has changed — retraining")
    except Exception as e:
        print(f"  ⚠️   Cache error ({e}) — retraining")
    return False

def save_cache(crimes):
    cache = {
        'generated_at': datetime.now().isoformat(),
        'num_crimes':   len(crimes),
        'data_hash':    data_hash(crimes),
        'model':        {'bandwidth': BANDWIDTH, 'cell_size': CELL_SIZE},
    }
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2)

# ── Step 3 — Preprocess ────────────────────────────────────────────────────────

def preprocess(crimes):
    print("\n⚙️   Step 3/6 — Preprocessing & splitting by time-of-day")
    day   = [c for c in crimes if  6 <= c['hour'] < 20]
    night = [c for c in crimes if c['hour'] < 6 or c['hour'] >= 20]
    high  = [c for c in crimes if SEVERITY_WEIGHTS.get(c['type'], 1) >= 7]
    print(f"  ✅  Day   incidents  (06:00 – 20:00): {len(day):>6,}")
    print(f"  ✅  Night incidents  (20:00 – 06:00): {len(night):>6,}")
    print(f"  ✅  High-severity crimes (score ≥ 7): {len(high):>6,}")
    return day, night

# ── Step 4 — Build numpy arrays ───────────────────────────────────────────────

def crimes_to_arrays(crimes):
    """Returns (lats, lngs, weights) as float32 numpy arrays."""
    lats    = np.array([c['lat']  for c in crimes], dtype=np.float32)
    lngs    = np.array([c['lng']  for c in crimes], dtype=np.float32)
    weights = np.array([SEVERITY_WEIGHTS.get(c['type'], 3) for c in crimes], dtype=np.float32)
    weights /= weights.sum()   # normalise so they sum to 1
    return lats, lngs, weights

def prepare_data(day_crimes, night_crimes):
    print("\n🔢  Step 4/6 — Building weighted data arrays")
    d_lats, d_lngs, d_w = crimes_to_arrays(day_crimes)
    n_lats, n_lngs, n_w = crimes_to_arrays(night_crimes)
    print(f"  ✅  Day   array:   shape ({len(d_lats):,},)  "
          f"weight range [{d_w.min():.2e}, {d_w.max():.2e}]")
    print(f"  ✅  Night array:   shape ({len(n_lats):,},)  "
          f"weight range [{n_w.min():.2e}, {n_w.max():.2e}]")
    print(f"  ⚙️   Model:        weighted Gaussian KDE, bandwidth={BANDWIDTH}° ≈ "
          f"{BANDWIDTH*111000:.0f}m")
    return (d_lats, d_lngs, d_w), (n_lats, n_lngs, n_w)

# ── Step 5 — Evaluate KDE on grid ────────────────────────────────────────────

def kde_evaluate_chunk(gl, gg, dl, dg, weights, h):
    """
    Weighted Gaussian KDE for a chunk of grid points.
    gl, gg : (chunk,)   grid lats / lngs
    dl, dg : (N,)       data  lats / lngs
    weights: (N,)       normalised crime weights
    Returns: (chunk,)   KDE density estimates
    """
    gl = gl[:, None]   # (chunk, 1)
    gg = gg[:, None]
    dl = dl[None, :]   # (1, N)
    dg = dg[None, :]

    dist_sq = ((gl - dl) / h) ** 2 + ((gg - dg) / h) ** 2   # (chunk, N)
    kernel  = np.exp(-0.5 * dist_sq)                          # Gaussian kernel
    return (kernel * weights[None, :]).sum(axis=1)            # weighted sum

def compute_grid(day_data, night_data):
    d_lats, d_lngs, d_w = day_data
    n_lats, n_lngs, n_w = night_data

    print("\n🗺️   Step 5/6 — Computing risk grid  (this takes ~30–60 seconds)")

    lat_cells = np.arange(LAT_MIN, LAT_MAX + CELL_SIZE, CELL_SIZE)
    lng_cells = np.arange(LNG_MIN, LNG_MAX + CELL_SIZE, CELL_SIZE)
    R, C      = len(lat_cells), len(lng_cells)
    total     = R * C

    print(f"  ⚙️   Grid:      {R} rows × {C} cols = {total:,} cells")
    print(f"  ⚙️   Cell size: {CELL_SIZE}° × {CELL_SIZE}° ≈ {CELL_SIZE*111000:.0f}m × {CELL_SIZE*111000:.0f}m")

    lat_g, lng_g = np.meshgrid(lat_cells, lng_cells, indexing='ij')
    all_lats     = lat_g.ravel().astype(np.float32)
    all_lngs     = lng_g.ravel().astype(np.float32)

    day_scores   = np.zeros(total, dtype=np.float32)
    night_scores = np.zeros(total, dtype=np.float32)

    n_chunks = (total + KDE_CHUNK - 1) // KDE_CHUNK
    print(f"  ⚙️   Processing {total:,} cells in {n_chunks} chunks of {KDE_CHUNK}")
    print()

    for ci in range(n_chunks):
        s, e = ci * KDE_CHUNK, min((ci + 1) * KDE_CHUNK, total)
        gl   = all_lats[s:e]
        gg   = all_lngs[s:e]

        day_scores[s:e]   = kde_evaluate_chunk(gl, gg, d_lats, d_lngs, d_w, BANDWIDTH)
        night_scores[s:e] = kde_evaluate_chunk(gl, gg, n_lats, n_lngs, n_w, BANDWIDTH)

        progress_bar(ci + 1, n_chunks,
                     label=f'chunk {ci+1}/{n_chunks}  |  cells {e:,}/{total:,}')

    # Normalise to 0–100
    def norm100(arr):
        mn, mx = arr.min(), arr.max()
        if mx == mn: return np.zeros_like(arr)
        return (arr - mn) / (mx - mn) * 100.0

    day_norm   = norm100(day_scores)
    night_norm = norm100(night_scores)

    # Build dict — skip near-zero cells to shrink file size
    print("\n  ⏳  Building output dictionary ...")
    grid = {}
    for i in range(R):
        for j in range(C):
            idx = i * C + j
            d   = round(float(day_norm[idx]),   1)
            n   = round(float(night_norm[idx]), 1)
            if d > 0.5 or n > 0.5:
                grid[f'{lat_cells[i]:.4f},{lng_cells[j]:.4f}'] = {'d': d, 'n': n}

    # Stats
    dv = day_norm[day_norm > 0.5]
    nv = night_norm[night_norm > 0.5]
    print(f"\n📊  Risk statistics:")
    print(f"  Day   — mean: {dv.mean():5.1f}  max: 100.0  "
          f"high-risk cells (>70): {int((day_norm>70).sum()):,}")
    print(f"  Night — mean: {nv.mean():5.1f}  max: 100.0  "
          f"high-risk cells (>70): {int((night_norm>70).sum()):,}")
    print(f"  Total non-zero cells: {len(grid):,} / {total:,}")

    meta = {
        'generated_at': datetime.now().isoformat(),
        'cell_size':    CELL_SIZE,
        'bandwidth':    BANDWIDTH,
        'lat_min': LAT_MIN, 'lat_max': float(lat_cells[-1]),
        'lng_min': LNG_MIN, 'lng_max': float(lng_cells[-1]),
        'total_cells':  len(grid),
        'coverage':     'West Philadelphia, University City, Rittenhouse, Center City West',
        'model':        'Weighted Gaussian KDE (pure numpy)',
        'num_crimes':   int(len(d_lats) + len(n_lats)),
    }
    return grid, meta

# ── Step 6 — Save ─────────────────────────────────────────────────────────────

def build_heatmap(crimes):
    srt = sorted(crimes, key=lambda c: SEVERITY_WEIGHTS.get(c['type'], 1), reverse=True)
    return [{'lat': c['lat'], 'lng': c['lng'],
             'w': round(SEVERITY_WEIGHTS.get(c['type'], 1) / 10, 1)}
            for c in srt[:2500]]

def save_outputs(grid, meta, crimes):
    print("\n💾  Step 6/6 — Saving outputs")
    os.makedirs(os.path.dirname(RISK_GRID_FILE), exist_ok=True)

    with open(RISK_GRID_FILE, 'w') as f:
        json.dump({'meta': meta, 'grid': grid}, f, separators=(',', ':'))
    kb = os.path.getsize(RISK_GRID_FILE) / 1024
    print(f"  ✅  public/risk-grid.json       {kb:>7,.0f} KB   ({len(grid):,} cells)")

    hm = build_heatmap(crimes)
    with open(HEATMAP_FILE, 'w') as f:
        json.dump(hm, f, separators=(',', ':'))
    kb2 = os.path.getsize(HEATMAP_FILE) / 1024
    print(f"  ✅  public/heatmap-points.json  {kb2:>7,.0f} KB   ({len(hm):,} points)")

    save_cache(crimes)
    print(f"  ✅  public/.model-cache.json    (future runs skip training)")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    banner()
    t0 = time.time()

    crimes               = load_crimes()
    if check_cache(crimes):
        return

    day_crimes, night_crimes = preprocess(crimes)
    day_data, night_data     = prepare_data(day_crimes, night_crimes)
    grid, meta               = compute_grid(day_data, night_data)
    save_outputs(grid, meta, crimes)

    elapsed = time.time() - t0
    print(f"\n{'═'*60}")
    print(f"  ✅  Training complete in {elapsed:.1f}s")
    print(f"  🚀  Run:  npm run dev   to start the app")
    print(f"  💡  To force retrain:  npm run train:force")
    print(f"{'═'*60}\n")

if __name__ == '__main__':
    if '--retrain' in sys.argv and os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)
        print("🔄  Cache cleared — forcing full retrain\n")
    main()
