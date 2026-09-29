/**
 * SafeRouteAI — Route Safety Scoring
 *
 * Two scoring modes, togglable in the UI:
 *
 *   KDE-only   — Weighted Gaussian KDE, day/night aware
 *   Hybrid     — 0.35 × KDE  +  0.65 × XGBoost  (time-aware per-hour prediction)
 *
 * Both modes use the pre-computed grid lookup: O(150 samples) per route,
 * no heavy computation at request time.
 */

const CELL_SIZE = 0.001   // ~111 m per cell

/**
 * Calibrate a raw safety score (0–100) to feel more intuitive for users.
 *
 * Raw scores cluster in the 30–70 range because the coverage area is
 * urban Philadelphia — there is no truly crime-free baseline cell.
 * A power transform (exponent < 1) lifts scores upward while fully
 * preserving relative ordering: safer routes always score higher.
 *
 * Examples:  raw 70 → 82   raw 50 → 68   raw 30 → 52   raw 20 → 41
 *
 * The raw avgRisk and peakRisk values are intentionally NOT calibrated —
 * they remain as direct crime-density readings (0–100) for transparency.
 */
function calibrateScore(raw) {
  return Math.round(100 * Math.pow(Math.max(0, Math.min(100, raw)) / 100, 0.55))
}

/**
 * Snap a coordinate to its grid-cell key.
 * Matches the Python snap() used during training.
 */
function snapToGrid(lat, lng) {
  const la = (Math.round(lat / CELL_SIZE) * CELL_SIZE).toFixed(4)
  const lg = (Math.round(lng / CELL_SIZE) * CELL_SIZE).toFixed(4)
  return `${la},${lg}`
}

// ─── KDE-only scoring ─────────────────────────────────────────────────────────

/**
 * Score a route using the pre-computed KDE risk grid.
 * @param {Array<{lat,lng}>} routePoints
 * @param {Object} riskGrid  — parsed risk-grid.json
 * @param {boolean} isNight
 * @returns {{ safetyScore, avgRisk, peakRisk, sampledPoints, outsideCoverage }}
 */
export function scoreRouteWithGrid(routePoints, riskGrid, isNight) {
  if (!riskGrid?.grid || !routePoints?.length) {
    return { safetyScore: 50, avgRisk: 50, peakRisk: 50, sampledPoints: 0, outsideCoverage: 0 }
  }

  const grid   = riskGrid.grid
  const stride = Math.max(1, Math.floor(routePoints.length / 150))
  let totalRisk = 0, count = 0, peakRisk = 0, outsideCoverage = 0

  for (let i = 0; i < routePoints.length; i += stride) {
    const pt  = routePoints[i]
    const key = snapToGrid(pt.lat, pt.lng)
    const cell = grid[key]

    if (!cell) { outsideCoverage++; continue }

    const risk = isNight ? cell.n : cell.d
    totalRisk += risk
    peakRisk   = Math.max(peakRisk, risk)
    count++
  }

  const avgRisk     = count > 0 ? totalRisk / count : 0
  const rawScore    = Math.max(0, Math.min(100, 100 - avgRisk))

  return {
    safetyScore:      calibrateScore(rawScore),
    avgRisk:          Math.round(avgRisk  * 10) / 10,
    peakRisk:         Math.round(peakRisk * 10) / 10,
    sampledPoints:    count,
    outsideCoverage,
  }
}

// ─── Hybrid scoring (KDE + XGBoost) ──────────────────────────────────────────

/**
 * Score a route using both KDE and the XGBoost per-hour predictions.
 *
 * XGBoost was trained on 86,656 samples (real PPD crimes vs safe-area negatives)
 * using spatiotemporal features: lat, lng, hour_sin, hour_cos, is_night, kde_*
 * → AUC-ROC 89.3%  |  Accuracy 82.3%  |  F1 0.786
 *
 * Final risk = 0.35 × KDE  +  0.65 × XGB   (XGB weighted higher because it is
 * time-aware: predictions vary across 24 hourly slots per cell)
 *
 * @param {Array<{lat,lng}>} routePoints
 * @param {Object} riskGrid        — parsed risk-grid.json
 * @param {Object} xgbPredictions  — parsed xgb-grid-predictions.json
 * @param {number} hour            — 0–23, current or user-selected hour
 * @param {boolean} isNight
 * @returns {{ safetyScore, avgRisk, peakRisk, sampledPoints, outsideCoverage, mode }}
 */
export function scoreRouteHybrid(routePoints, riskGrid, xgbPredictions, hour, isNight) {
  if (!riskGrid?.grid || !routePoints?.length) {
    return { safetyScore: 50, avgRisk: 50, peakRisk: 50, sampledPoints: 0, outsideCoverage: 0, mode: 'kde' }
  }

  const grid = riskGrid.grid
  const xgb  = xgbPredictions?.predictions
  const h    = Math.max(0, Math.min(23, Math.round(hour)))

  const stride = Math.max(1, Math.floor(routePoints.length / 150))
  let totalRisk = 0, count = 0, peakRisk = 0, outsideCoverage = 0
  let xgbUsed = 0

  for (let i = 0; i < routePoints.length; i += stride) {
    const pt   = routePoints[i]
    const key  = snapToGrid(pt.lat, pt.lng)
    const cell = grid[key]

    if (!cell) { outsideCoverage++; continue }

    const kdeScore = isNight ? cell.n : cell.d

    let risk
    if (xgb?.[key]) {
      const xgbScore = xgb[key][h] ?? kdeScore
      risk = 0.35 * kdeScore + 0.65 * xgbScore
      xgbUsed++
    } else {
      risk = kdeScore   // graceful KDE fallback if cell missing from XGB
    }

    totalRisk += risk
    peakRisk   = Math.max(peakRisk, risk)
    count++
  }

  const avgRisk  = count > 0 ? totalRisk / count : 0
  const rawScore = Math.max(0, Math.min(100, 100 - avgRisk))

  return {
    safetyScore:    calibrateScore(rawScore),
    avgRisk:        Math.round(avgRisk  * 10) / 10,
    peakRisk:       Math.round(peakRisk * 10) / 10,
    sampledPoints:  count,
    outsideCoverage,
    mode: xgbUsed > count * 0.5 ? 'hybrid' : 'kde',
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export function getSafetyTier(score) {
  if (score >= 82) return { label: 'Very Safe',    emoji: '🟢', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.35)'   }
  if (score >= 70) return { label: 'Mostly Safe',  emoji: '🟡', color: '#eab308', bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.35)'   }
  if (score >= 57) return { label: 'Use Caution',  emoji: '🟠', color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.35)'  }
  return              { label: 'Higher Risk',   emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)'   }
}

export function getRouteStrokeColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#eab308'
  if (score >= 50) return '#f97316'
  return '#ef4444'
}

export function getRouteLabel(rank, score) {
  if (rank === 0) return score >= 65 ? '✦ Safest Route' : '✦ Best Available'
  if (rank === 1) return 'Alternative Route'
  return 'Third Option'
}
