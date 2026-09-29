#!/usr/bin/env node
/**
 * SafeRouteAI — Pre-dev model check
 *
 * Called automatically via `predev` npm hook before `npm run dev`.
 * Checks for both the KDE risk grid and XGBoost predictions.
 * Auto-trains what's missing so the app always starts correctly.
 */

const { execSync } = require('child_process')
const path         = require('path')
const fs           = require('fs')

const ROOT     = path.join(__dirname, '..')
const KDE_GRID = path.join(ROOT, 'public', 'risk-grid.json')
const XGB_PRED = path.join(ROOT, 'public', 'xgb-grid-predictions.json')

function sizeKB(p) { return (fs.statSync(p).size / 1024).toFixed(0) }

function runPython(script, label) {
  console.log(`\n⚙️  Running ${label}...`)
  try {
    execSync(`python3 ${script}`, { cwd: ROOT, stdio: 'inherit' })
  } catch (err) {
    console.error(`\n❌  ${label} failed: ${err.message}`)
    console.error('    Make sure Python 3 and numpy are installed.')
    console.error('    Install: pip3 install numpy\n')
    process.exit(1)
  }
}

// ── KDE risk grid ────────────────────────────────────────────────────────────
if (fs.existsSync(KDE_GRID)) {
  console.log(`✅  KDE risk grid ready     (${sizeKB(KDE_GRID)} KB)`)
} else {
  console.log('⚠️  KDE risk grid not found — training now (first-time setup)...')
  runPython('scripts/train_risk_model.py', 'KDE training')
  console.log(`✅  KDE risk grid built     (${sizeKB(KDE_GRID)} KB)`)
}

// ── XGBoost predictions ──────────────────────────────────────────────────────
if (fs.existsSync(XGB_PRED)) {
  console.log(`✅  XGBoost predictions ready (${sizeKB(XGB_PRED)} KB)`)
} else {
  console.log('⚠️  XGBoost predictions not found — training now...')
  runPython('scripts/train_xgboost_model.py', 'XGBoost training')
  console.log(`✅  XGBoost predictions built (${sizeKB(XGB_PRED)} KB)`)
}

console.log('\n    Run  npm run train:force   to retrain KDE from scratch')
console.log('    Run  npm run train:xgb     to retrain XGBoost')
console.log('    Run  npm run train:all     to retrain everything\n')
