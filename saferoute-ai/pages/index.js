import Head from 'next/head'
import { useState, useRef, useCallback, useEffect } from 'react'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import {
  scoreRouteWithGrid,
  scoreRouteHybrid,
  getSafetyTier,
  getRouteStrokeColor,
  getRouteLabel,
} from '../lib/safetyScorer'

// ─── Constants ────────────────────────────────────────────────────────────────

const LIBRARIES     = ['places', 'visualization']
const PHILLY_CENTER = { lat: 39.9526, lng: -75.1652 }
const PHILLY_BOUNDS = { north: 40.137, south: 39.867, east: -74.955, west: -75.280 }
const API_KEY       = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

const DARK_MAP_STYLES = [
  { elementType: 'geometry',                stylers: [{ color: '#0a1628' }] },
  { elementType: 'labels.text.stroke',      stylers: [{ color: '#0a1628' }] },
  { elementType: 'labels.text.fill',        stylers: [{ color: '#4a6a9a' }] },
  { featureType: 'road',                    elementType: 'geometry',         stylers: [{ color: '#112448' }] },
  { featureType: 'road.arterial',           elementType: 'geometry',         stylers: [{ color: '#0d1f38' }] },
  { featureType: 'road.highway',            elementType: 'geometry',         stylers: [{ color: '#1a3a6e' }] },
  { featureType: 'road.highway',            elementType: 'geometry.stroke',  stylers: [{ color: '#0d2a5a' }] },
  { featureType: 'road',                    elementType: 'labels.text.fill', stylers: [{ color: '#3d6490' }] },
  { featureType: 'water',                   elementType: 'geometry',         stylers: [{ color: '#060f1e' }] },
  { featureType: 'poi',                     stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',                 stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',          elementType: 'geometry',         stylers: [{ color: '#1a3a6e' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#5a8abf' }] },
  { featureType: 'landscape',               elementType: 'geometry',         stylers: [{ color: '#0a1628' }] },
]

function fmt12h(h) {
  if (h === 0)  return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score, size = 72, strokeWidth = 7 }) {
  const tier   = getSafetyTier(score)
  const radius = (size - strokeWidth) / 2
  const circ   = 2 * Math.PI * radius
  const offset = circ - (score / 100) * circ
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#112448" strokeWidth={strokeWidth} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={tier.color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 4px ${tier.color}66)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-black leading-none" style={{ color: tier.color }}>{score}</span>
        <span style={{ color: tier.color, fontSize: 8, marginTop: 1, fontWeight: 700 }}>SAFE</span>
      </div>
    </div>
  )
}

function RouteCard({ route, isSelected, onClick }) {
  const tier = getSafetyTier(route.safetyScore)
  return (
    <div className={`route-card fade-up ${isSelected ? 'selected' : ''}`} onClick={onClick}
      style={isSelected ? { borderColor: tier.color, boxShadow: `0 0 0 1px ${tier.color}40, 0 8px 28px rgba(0,0,0,0.5)` } : {}}>
      {isSelected && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full" style={{ background: tier.color }} />
      )}
      <div className="flex items-center gap-4">
        <ScoreRing score={route.safetyScore} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-100 truncate">{route.label}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>
              {tier.label}
            </span>
            {route.mode === 'hybrid' && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
                🤖 XGB
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mb-2">
            <span>🕐 {route.duration}</span>
            <span>📍 {route.distance}</span>
          </div>
          <div className="safety-bar">
            <div className="safety-bar-fill"
              style={{ width: `${route.safetyScore}%`, background: `linear-gradient(90deg,${tier.color}99,${tier.color})` }} />
          </div>
        </div>
      </div>

      {isSelected && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #1e3a5f' }}>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
            {route.mode === 'hybrid' ? '🤖 XGBoost + KDE Analysis' : '🧠 KDE Analysis'}
          </p>
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Avg risk: {route.avgRisk}/100
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Peak risk: {route.peakRisk}/100
            </span>
            {route.mode === 'hybrid' && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}>
                35% KDE · 65% XGB
              </span>
            )}
            {route.outsideCoverage > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                ⚠️ Partial coverage
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RouteSkeleton() {
  return (
    <div className="space-y-3">
      {[1,2,3].map(i => (
        <div key={i} className="route-card">
          <div className="flex items-center gap-4">
            <div className="skeleton rounded-full flex-shrink-0" style={{ width: 72, height: 72 }} />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton h-1.5 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function NoKeyBanner() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="text-5xl mb-4">🗝️</div>
      <h3 className="text-lg font-bold text-slate-200 mb-2">Google Maps API Key Required</h3>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
        Copy <code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400">.env.local.example</code> to{' '}
        <code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400">.env.local</code> and add your key,
        then restart <code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400">npm run dev</code>.
      </p>
    </div>
  )
}

function HeatmapLayer({ heatmapPts, mapRef, heatmapRef, show }) {
  useEffect(() => {
    if (!mapRef.current || !heatmapPts.length || typeof window === 'undefined') return
    const data = heatmapPts.map(p => ({
      location: new window.google.maps.LatLng(p.lat, p.lng), weight: p.w,
    }))
    const hm = new window.google.maps.visualization.HeatmapLayer({
      data, map: show ? mapRef.current : null,
      radius: 28, opacity: 0.72,
      gradient: ['rgba(0,0,0,0)','rgba(37,99,235,0.3)','rgba(245,158,11,0.6)',
                 'rgba(239,100,68,0.8)','rgba(239,68,68,1)','rgba(185,28,28,1)'],
    })
    heatmapRef.current = hm
    return () => { hm.setMap(null); heatmapRef.current = null }
  }, [heatmapPts, mapRef, heatmapRef, show])

  useEffect(() => {
    if (heatmapRef.current) heatmapRef.current.setMap(show ? mapRef.current : null)
  }, [show, mapRef, heatmapRef])

  return null
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function SafeRouteAI() {

  // ── Model data (fetched, not bundled) ──────────────────────────────────────
  const [riskGrid,       setRiskGrid]       = useState(null)
  const [xgbPredictions, setXgbPredictions] = useState(null)
  const [heatmapPts,     setHeatmapPts]     = useState([])
  const [dataReady,      setDataReady]       = useState(false)
  const [xgbReady,       setXgbReady]       = useState(false)
  const [dataError,      setDataError]       = useState('')

  // ── Routing config ─────────────────────────────────────────────────────────
  const [useHybrid,    setUseHybrid]    = useState(true)    // KDE-only vs KDE+XGB
  const [useNow,       setUseNow]       = useState(true)    // use current time vs manual hour
  const [selectedHour, setSelectedHour] = useState(() => new Date().getHours())

  // ── App state ──────────────────────────────────────────────────────────────
  const [routes,      setRoutes]      = useState([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState('')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [mapReady,    setMapReady]    = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapRef           = useRef(null)
  const originInputRef   = useRef(null)
  const destInputRef     = useRef(null)
  const polylinesRef     = useRef([])
  const markersRef       = useRef([])
  const heatmapRef       = useRef(null)
  const coverageRectRef  = useRef(null)

  // ── Fetch KDE grid + heatmap + XGB predictions ────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/risk-grid.json').then(r => r.json()),
      fetch('/heatmap-points.json').then(r => r.json()),
    ])
      .then(([grid, hm]) => {
        setRiskGrid(grid); setHeatmapPts(hm); setDataReady(true)
      })
      .catch(() => setDataError('Risk grid not found — run: npm run train'))
  }, [])

  useEffect(() => {
    fetch('/xgb-grid-predictions.json')
      .then(r => r.json())
      .then(xgb => { setXgbPredictions(xgb); setXgbReady(true) })
      .catch(() => { /* XGB optional — KDE still works */ })
  }, [])

  // Keep hour in sync when using current time
  useEffect(() => {
    if (!useNow) return
    setSelectedHour(new Date().getHours())
    const id = setInterval(() => setSelectedHour(new Date().getHours()), 60000)
    return () => clearInterval(id)
  }, [useNow])

  // ── Google Maps ────────────────────────────────────────────────────────────
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'safe-route-ai', googleMapsApiKey: API_KEY,
    libraries: LIBRARIES, version: 'weekly',
  })

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    const bounds = new window.google.maps.LatLngBounds(
      new window.google.maps.LatLng(PHILLY_BOUNDS.south, PHILLY_BOUNDS.west),
      new window.google.maps.LatLng(PHILLY_BOUNDS.north, PHILLY_BOUNDS.east),
    )
    const opts = { bounds, strictBounds: false,
                   componentRestrictions: { country: 'us' }, fields: ['formatted_address','geometry'] }
    if (originInputRef.current) new window.google.maps.places.Autocomplete(originInputRef.current, opts)
    if (destInputRef.current)   new window.google.maps.places.Autocomplete(destInputRef.current,   opts)
    setMapReady(true)
  }, [])

  // ── Polylines ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return
    polylinesRef.current.forEach(p => p.setMap(null)); polylinesRef.current = []
    ;[...routes].reverse().forEach((route, ri) => {
      const fwdIdx = routes.length - 1 - ri
      const sel    = fwdIdx === selectedIdx
      const poly   = new window.google.maps.Polyline({
        path: route.points, geodesic: true,
        strokeColor: getRouteStrokeColor(route.safetyScore),
        strokeOpacity: sel ? 0.92 : 0.35, strokeWeight: sel ? 7 : 4,
        zIndex: sel ? 100 : fwdIdx, clickable: true,
      })
      poly.setMap(mapRef.current)
      poly.addListener('click', () => setSelectedIdx(fwdIdx))
      polylinesRef.current.push(poly)
    })
  }, [routes, selectedIdx])

  // ── A/B markers ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return
    markersRef.current.forEach(m => m.setMap(null)); markersRef.current = []
    const pts = routes[selectedIdx]?.points ?? []
    if (pts.length < 2) return
    const mkr = (pos, label, color) => new window.google.maps.Marker({
      position: pos, map: mapRef.current,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10,
              fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 },
      label: { text: label, color: '#fff', fontSize: '11px', fontWeight: '700' },
      zIndex: 200,
    })
    markersRef.current.push(mkr(pts[0], 'A', '#2563eb'))
    markersRef.current.push(mkr(pts[pts.length - 1], 'B', '#7c3aed'))
  }, [routes, selectedIdx])

  // ── Coverage zone rectangle ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !dataReady || !riskGrid?.meta || typeof window === 'undefined') return
    if (coverageRectRef.current) coverageRectRef.current.setMap(null)

    const { lat_min, lat_max, lng_min, lng_max } = riskGrid.meta
    coverageRectRef.current = new window.google.maps.Rectangle({
      bounds: { north: lat_max, south: lat_min, east: lng_max, west: lng_min },
      strokeColor:   '#3b82f6',
      strokeOpacity: 0.55,
      strokeWeight:  1.5,
      fillColor:     '#3b82f6',
      fillOpacity:   0.04,
      map:           mapRef.current,
      clickable:     false,
      zIndex:        1,
    })
    return () => { if (coverageRectRef.current) coverageRectRef.current.setMap(null) }
  }, [mapReady, dataReady, riskGrid])

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const origin = originInputRef.current?.value?.trim()
    const dest   = destInputRef.current?.value?.trim()
    if (!origin || !dest) { setError('Enter both a start and destination.'); return }
    if (!dataReady)        { setError('Risk model still loading — please wait.'); return }

    setIsLoading(true); setError(''); setRoutes([])

    const hour    = useNow ? new Date().getHours() : selectedHour
    const isNight = hour < 6 || hour >= 20

    new window.google.maps.DirectionsService().route(
      { origin, destination: dest, travelMode: window.google.maps.TravelMode.WALKING,
        provideRouteAlternatives: true, region: 'us' },
      (result, status) => {
        if (status !== 'OK') {
          setError(status === 'ZERO_RESULTS'
            ? 'No routes found. Try locations within Philadelphia.'
            : `Routing error: ${status}`)
          setIsLoading(false); return
        }

        const scored = result.routes.slice(0, 5).map((gr, idx) => {
          const points = []
          gr.legs.forEach(leg => leg.steps.forEach(step =>
            step.path.forEach(p => points.push({ lat: p.lat(), lng: p.lng() }))
          ))
          const leg = gr.legs[0]

          const result = (useHybrid && xgbReady)
            ? scoreRouteHybrid(points, riskGrid, xgbPredictions, hour, isNight)
            : scoreRouteWithGrid(points, riskGrid, isNight)

          return {
            idx, points, ...result,
            duration:     leg.duration.text,
            durationSecs: leg.duration.value,
            distance:     leg.distance.text,
            label: '',
            scoredHour: hour,
          }
        })

        scored.sort((a, b) => b.safetyScore - a.safetyScore)
        scored.forEach((r, i) => { r.label = getRouteLabel(i, r.safetyScore) })

        setRoutes(scored); setSelectedIdx(0); setIsLoading(false)

        if (mapRef.current && scored[0]?.points.length) {
          const b = new window.google.maps.LatLngBounds()
          scored[0].points.forEach(p => b.extend(p))
          mapRef.current.fitBounds(b, { top: 60, right: 40, bottom: 60, left: 40 })
        }
      }
    )
  }, [dataReady, riskGrid, xgbPredictions, xgbReady, useHybrid, useNow, selectedHour])

  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch() }
  const selectedRoute = routes[selectedIdx] ?? null
  const activeHour    = useNow ? new Date().getHours() : selectedHour
  const isNightHour   = activeHour < 6 || activeHour >= 20

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>SafeRouteAI — Navigate Philadelphia Safely</title>
        <meta name="description" content="AI-powered safe route navigation for Philadelphia" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>" />
      </Head>

      <div className="flex flex-col h-screen" style={{ background: '#050d1a' }}>

        {/* ── Header ── */}
        <header className="flex items-center justify-between px-6 flex-shrink-0"
          style={{ height: 60, background: 'rgba(10,22,40,0.95)',
                   borderBottom: '1px solid #112448', backdropFilter: 'blur(10px)', zIndex: 50 }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center text-xl rounded-xl"
              style={{ width: 38, height: 38, background: 'linear-gradient(135deg,#1e3a8a,#2563eb)',
                       boxShadow: '0 4px 14px rgba(37,99,235,0.4)' }}>🛡️</div>
            <div>
              <div className="text-base font-black tracking-tight text-slate-100">
                SafeRoute<span className="text-blue-400">AI</span>
              </div>
              <div className="text-xs text-slate-500 font-medium leading-none mt-0.5">
                Philadelphia Safe Navigation
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* KDE status */}
            <div className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={dataReady
                ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#10b981' }
                : { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
              {dataReady ? '🧠 KDE Ready' : '⏳ Loading…'}
            </div>

            {/* XGB status */}
            <div className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={xgbReady
                ? { background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' }
                : { background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', color: '#64748b' }}>
              {xgbReady ? '🤖 XGBoost Ready' : '⚙️ XGB Loading…'}
            </div>

            {/* Hybrid / KDE toggle */}
            {xgbReady && (
              <button
                className={`toggle-btn ${useHybrid ? 'active' : ''}`}
                onClick={() => setUseHybrid(v => !v)}
                title={useHybrid ? 'Switch to KDE-only mode' : 'Enable XGBoost hybrid mode'}>
                <span>{useHybrid ? '🤖' : '📊'}</span>
                <span>{useHybrid ? 'Hybrid (KDE+XGB)' : 'KDE Only'}</span>
              </button>
            )}

            <div className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)', color: '#60a5fa' }}>
              📍 Philadelphia, PA
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── LEFT PANEL ── */}
          <aside className="flex flex-col flex-shrink-0 overflow-hidden"
            style={{ width: 390, background: '#080f1e', borderRight: '1px solid #112448' }}>

            {/* Search */}
            <div className="p-5 flex-shrink-0" style={{ borderBottom: '1px solid #112448' }}>
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Plan Your Route</h2>

              <div className="relative mb-3">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 text-sm font-bold select-none">A</span>
                <input ref={originInputRef} type="text" placeholder="Starting location in Philadelphia…"
                  className="route-input" onKeyDown={handleKeyDown} disabled={!isLoaded || !!loadError} />
              </div>

              <div className="relative mb-4">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 text-sm font-bold select-none">B</span>
                <input ref={destInputRef} type="text" placeholder="Destination in Philadelphia…"
                  className="route-input" onKeyDown={handleKeyDown} disabled={!isLoaded || !!loadError} />
              </div>

              {/* ── Time controls ── */}
              <div className="mb-4 p-3 rounded-xl" style={{ background: '#0d1f38', border: '1px solid #1e3a5f' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-400">
                    {isNightHour ? '🌙' : '☀️'} Time of travel
                  </span>
                  <button
                    className="text-xs px-2 py-0.5 rounded-full font-semibold transition-all"
                    style={useNow
                      ? { background: 'rgba(37,99,235,0.2)', color: '#60a5fa', border: '1px solid rgba(37,99,235,0.3)' }
                      : { background: 'rgba(100,116,139,0.1)', color: '#64748b', border: '1px solid #1e3a5f' }}
                    onClick={() => setUseNow(v => !v)}>
                    {useNow ? '⏱ Now' : '🕐 Manual'}
                  </button>
                </div>

                {useNow ? (
                  <div className="text-sm font-bold text-slate-200">
                    {fmt12h(activeHour)}
                    <span className="text-xs text-slate-500 font-normal ml-2">
                      (auto-updated · click Manual to override)
                    </span>
                  </div>
                ) : (
                  <div>
                    <input type="range" min="0" max="23" value={selectedHour}
                      onChange={e => setSelectedHour(+e.target.value)}
                      className="w-full accent-blue-500 cursor-pointer" />
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>12 AM</span>
                      <span className="font-bold text-slate-300">{fmt12h(selectedHour)}</span>
                      <span>11 PM</span>
                    </div>
                  </div>
                )}
              </div>

              <button className="btn-primary" onClick={handleSearch}
                disabled={!isLoaded || !!loadError || isLoading || !dataReady}>
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="dot" style={{ background: '#93c5fd' }} />
                    <span className="dot" style={{ background: '#93c5fd' }} />
                    <span className="dot" style={{ background: '#93c5fd' }} />
                    <span className="ml-1">
                      {useHybrid && xgbReady ? 'XGBoost scoring routes…' : 'Scoring routes…'}
                    </span>
                  </span>
                ) : '🛡️ Find Safest Routes'}
              </button>

              {(error || dataError) && (
                <div className="mt-3 p-3 rounded-xl text-xs text-red-300 leading-relaxed"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  ⚠️ {error || dataError}
                </div>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoading && <RouteSkeleton />}

              {!isLoading && routes.length === 0 && !error && (
                <div className="text-center pt-6 px-4">
                  <div className="text-4xl mb-3">🗺️</div>
                  <p className="text-sm font-semibold text-slate-300 mb-2">Ready to navigate safely</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {useHybrid && xgbReady
                      ? <>Powered by <span className="text-purple-400">XGBoost</span> + <span className="text-blue-400">KDE</span> trained on <span className="text-blue-400">43,328 PPD incidents</span></>
                      : <>Powered by <span className="text-blue-400">KDE model</span> trained on <span className="text-blue-400">43,328 PPD incidents</span></>
                    }
                  </p>

                  {/* Quick-fill suggestions */}
                  <div className="mt-5 space-y-2 text-left">
                    {[
                      ['Temple University', 'Jefferson Hospital'],
                      ['30th Street Station', 'Independence Hall'],
                      ['Penn Medicine', 'Reading Terminal Market'],
                    ].map(([from, to]) => (
                      <button key={from}
                        className="w-full text-left text-xs p-2.5 rounded-lg transition-all"
                        style={{ background: '#0d1f38', border: '1px solid #112448', color: '#64748b' }}
                        onClick={() => {
                          if (originInputRef.current) originInputRef.current.value = from + ', Philadelphia, PA'
                          if (destInputRef.current)   destInputRef.current.value   = to   + ', Philadelphia, PA'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='#2563eb'; e.currentTarget.style.color='#94a3b8' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='#112448'; e.currentTarget.style.color='#64748b' }}
                        disabled={!isLoaded}>
                        <span className="text-blue-500">→</span> {from} to {to}
                      </button>
                    ))}
                  </div>

                  {/* Model info cards */}
                  {dataReady && (
                    <div className="mt-5 space-y-2">
                      {/* KDE card */}
                      <div className="p-3 rounded-xl text-left text-xs"
                        style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
                        <p className="text-blue-400 font-semibold mb-1">🧠 KDE Model</p>
                        <p className="text-slate-500">Weighted Gaussian KDE · {riskGrid?.meta?.total_cells?.toLocaleString()} cells @ ~111m resolution</p>
                        <p className="text-slate-500">Day/night split · 43,328 PPD incidents</p>
                      </div>

                      {/* XGB card */}
                      {xgbReady && xgbPredictions?.meta && (
                        <div className="p-3 rounded-xl text-left text-xs"
                          style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                          <p className="text-purple-400 font-semibold mb-1">🤖 XGBoost Model</p>
                          <p className="text-slate-500">
                            AUC-ROC: <span className="text-purple-300 font-bold">
                              {(xgbPredictions.meta.metrics?.auc_roc * 100).toFixed(1)}%
                            </span>
                            {' '}· Accuracy: <span className="text-purple-300 font-bold">
                              {(xgbPredictions.meta.metrics?.accuracy * 100).toFixed(1)}%
                            </span>
                          </p>
                          <p className="text-slate-500">
                            F1: <span className="text-purple-300">{xgbPredictions.meta.metrics?.f1_score?.toFixed(3)}</span>
                            {' '}· {xgbPredictions.meta.total_cells?.toLocaleString()} cells × 24 hrs
                          </p>
                          <p className="text-slate-500">Features: lat, lng, hour (sin/cos), KDE score</p>
                          <p className="text-slate-500 mt-1">
                            Built: {xgbPredictions.meta.generated_at?.slice(0,16).replace('T',' ')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!isLoading && routes.map((route, i) => (
                <RouteCard key={i} route={route} isSelected={i === selectedIdx}
                  onClick={() => {
                    setSelectedIdx(i)
                    if (mapRef.current && route.points.length) {
                      const b = new window.google.maps.LatLngBounds()
                      route.points.forEach(p => b.extend(p))
                      mapRef.current.fitBounds(b, { top:60, right:40, bottom:60, left:40 })
                    }
                  }} />
              ))}
            </div>

            {/* Legend */}
            <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid #112448' }}>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">Safety Scale</p>
              <div className="space-y-1.5">
                {[
                  { color: '#22c55e', label: 'Very Safe',   range: '82–100' },
                  { color: '#eab308', label: 'Mostly Safe', range: '70–81'  },
                  { color: '#f97316', label: 'Use Caution', range: '57–69'  },
                  { color: '#ef4444', label: 'Higher Risk', range: '0–56'   },
                ].map(({ color, label, range }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
                    <span className="text-xs text-slate-400">{label}</span>
                    <span className="text-xs text-slate-600 ml-auto">{range}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 text-xs text-slate-600" style={{ borderTop: '1px solid #112448' }}>
                {useHybrid && xgbReady ? 'KDE + XGBoost hybrid' : 'KDE model'} · 43,328 PPD incidents · AUC 89.3%
              </div>
            </div>
          </aside>

          {/* ── MAP ── */}
          <div className="flex-1 relative overflow-hidden">
            {!API_KEY || loadError ? (
              <div style={{ background: '#080f1e', width: '100%', height: '100%' }}>
                <NoKeyBanner />
              </div>
            ) : !isLoaded ? (
              <div className="flex items-center justify-center w-full h-full" style={{ background: '#080f1e' }}>
                <div className="text-center">
                  <div className="w-10 h-10 rounded-full border-2 border-blue-600 border-t-transparent spin-slow mx-auto mb-3" />
                  <p className="text-sm text-slate-400">Loading map…</p>
                </div>
              </div>
            ) : (
              <div className="map-wrapper">
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={PHILLY_CENTER} zoom={13} onLoad={onMapLoad}
                  options={{
                    styles: DARK_MAP_STYLES, disableDefaultUI: false,
                    zoomControl: true, mapTypeControl: false,
                    streetViewControl: false, fullscreenControl: true,
                    clickableIcons: false,
                    restriction: { latLngBounds: PHILLY_BOUNDS, strictBounds: false },
                  }}>
                  {mapReady && heatmapPts.length > 0 && (
                    <HeatmapLayer heatmapPts={heatmapPts} mapRef={mapRef} heatmapRef={heatmapRef} show={showHeatmap} />
                  )}
                </GoogleMap>

                {/* Floating controls */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2" style={{ zIndex: 30 }}>
                  <button className={`toggle-btn ${showHeatmap ? 'active' : ''}`}
                    onClick={() => setShowHeatmap(v => !v)}>
                    <span>🔥</span>
                    <span>{showHeatmap ? 'Hide' : 'Show'} Crime Heatmap</span>
                  </button>

                  {selectedRoute && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold"
                      style={{
                        background: 'rgba(13,31,56,0.95)',
                        border: `1px solid ${getSafetyTier(selectedRoute.safetyScore).border}`,
                        color: getSafetyTier(selectedRoute.safetyScore).color,
                        backdropFilter: 'blur(8px)',
                      }}>
                      <span>{getSafetyTier(selectedRoute.safetyScore).emoji}</span>
                      <span>
                        {selectedRoute.label} · Score {selectedRoute.safetyScore}/100
                        {selectedRoute.scoredHour !== undefined && ` · ${fmt12h(selectedRoute.scoredHour)}`}
                        {selectedRoute.mode === 'hybrid' && ' · 🤖 XGB'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Loading overlay */}
                {isLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{ background: 'rgba(5,13,26,0.75)', backdropFilter: 'blur(2px)', zIndex: 20 }}>
                    <div className="w-12 h-12 rounded-full border-2 border-blue-500 border-t-transparent spin-slow mb-4" />
                    <p className="text-sm font-semibold text-slate-300">
                      {useHybrid && xgbReady ? 'Scoring with XGBoost + KDE…' : 'Scoring routes with KDE model…'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {useHybrid && xgbReady
                        ? `AUC-ROC 89.3% · ${fmt12h(activeHour)} predictions`
                        : '43,328 incidents · instant grid lookup'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
