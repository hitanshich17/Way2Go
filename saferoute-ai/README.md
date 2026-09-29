# 🛡️ SafeRouteAI — Navigate Philadelphia Safely

> **Philly Codefest 2026** | Theme: Building AI for Philly's Future | Track: Civic Safety & Community

---

## What It Does

SafeRouteAI is a full-stack navigation app that routes pedestrians through **safer** parts of Philadelphia — not just faster ones. It uses ~43,000 Philadelphia Police Department crime records, modeled with a KDE risk grid and an XGBoost time-of-day model, to score every walking route and surface the safest path.

**Core user story:** You're walking from Temple's campus to Jefferson Hospital at night. Google Maps shows you the fastest route — through a stretch of North Philly with elevated robbery rates. SafeRouteAI gives you that route too — color-coded red — and highlights a green alternative that's 2 minutes longer and significantly safer.

---

## Features

### 🗺️ Interactive Safety Map
- Dark-themed Google Map centered on Philadelphia
- **Crime heatmap overlay** using 641 data points (toggle on/off)
- Route polylines **color-coded by safety score** (green/yellow/red)
- A/B markers for origin and destination

### 🚦 Route Safety Scoring
Each route receives a **Safety Score (0–100)** computed by:

```
For each crime within 300m of route:
  risk += severity × proximity_factor²
  where proximity_factor = 1 - (distance / 300m)

Safety Score = 100 - normalize(risk, MAX_RISK) × 100
```

Crime severity weights:
| Crime Type | Weight |
|---|---|
| Homicide | 10 |
| Rape | 9 |
| Aggravated Assault | 8 |
| Robbery | 7 |
| Drug Offense | 6 |
| Burglary | 5 |
| Vehicle Theft | 4 |
| Theft | 3 |
| Vandalism | 2 |

### 📊 Route Comparison Panel
- Up to 5 alternative routes from Google Maps
- Sorted by safety (safest first)
- Each card shows: safety score ring, tier badge, time, distance, safety bar, crime breakdown
- Click any card or route on the map to select it

### 🌙 Night Mode Safety Weighting
Toggle **Night Mode** to apply a 30% boost to crimes that historically occur after dark — giving more conservative scores when you're navigating at night.

### 📍 Philadelphia Address Autocomplete
- Google Places autocomplete restricted to Philadelphia bounds
- One-click example routes in the panel

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (Pages Router) |
| Styling | Tailwind CSS + custom CSS animations |
| Map | Google Maps JavaScript API via `@react-google-maps/api` |
| Routing | Google Maps Directions API (walking mode, up to 5 alternatives) |
| Geocoding | Google Maps Places API (autocomplete) |
| Heatmap | Google Maps Visualization Library |
| Scoring | KDE risk grid + XGBoost hourly risk (trained offline in Python, scored client-side) |
| Crime Data | ~43,000 Philadelphia crime records (`data/crimes.json`) |

---

## Setup (5 minutes)

### 1. Get a Google Maps API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project
3. Enable these APIs:
   - **Maps JavaScript API**
   - **Places API**
   - **Directions API**
4. Create an API key under Credentials

### 2. Configure Environment

```bash
cd saferoute-ai
cp .env.local.example .env.local
# Edit .env.local and paste your API key
```

### 3. Install Python dependencies

`npm run dev` checks for the pre-built model files in `public/` and retrains them if they are missing, which needs Python 3:

```bash
pip3 install numpy
pip3 install xgboost scikit-learn   # optional, faster/better XGBoost training
```

### 4. Install & Run

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## Safety Scoring Algorithm — Deep Dive

The algorithm runs entirely client-side in the browser — no backend, no latency:

1. **Google Maps** returns up to 5 route alternatives
2. Each route's polyline is decoded into lat/lng path points
3. For each of the 641 crime data points, we compute:
   - Minimum Euclidean distance to any route point
   - If within `PROXIMITY_RADIUS` (≈300m): accumulate `severity × proximityFactor²`
4. Total risk is normalized against `MAX_RISK = 180` → mapped to 0–100
5. Routes are sorted descending by safety score

The `proximityFactor²` (squared) ensures crimes **directly on the route** contribute ~4× more than crimes near the edge of the proximity zone. This creates a sharp, realistic falloff.

### Calibration

| Route | Expected Score |
|---|---|
| Through Kensington (high robbery/drugs) | 25–45 |
| Through Center City (high theft, low violence) | 65–80 |
| Through Chestnut Hill / Manayunk (low crime) | 85–95 |

---

## Crime Data

641 synthesized crime incidents distributed across real Philadelphia crime hotspots. Data points include:
- `lat`, `lng` — geographic coordinates (Philadelphia bounds)
- `type` — one of 9 crime categories
- `severity` — integer 2–10
- `hour` — typical hour the crime type occurs (used for Night Mode)

**Important:** This is representative/synthesized data for demonstration. Production deployment would use live data from [OpenDataPhilly](https://opendataphilly.org/) (which provides real incident-level crime data with exact coordinates).

---

## Design Decisions

**Why walking mode only?** Walking pedestrians are most vulnerable and benefit most from safety routing. Driving adds complexity (one-way streets, traffic) without as much safety benefit since you're in a vehicle.

**Why client-side scoring?** Eliminates backend latency. The 641-point dataset fits comfortably in memory. Enables offline capability (with service worker). Simpler deployment.

**Why not use real-time crime data?** For a hackathon MVP, synthesized data lets us demonstrate the full algorithm without data licensing issues or rate limiting. The architecture is identical with a live OpenDataPhilly API feed.

---

## Responsible AI & Ethics

**Privacy:** No user data stored. No accounts. The app doesn't know who you are.

**Bias awareness:** Geographic crime data reflects historical policing patterns, not just actual crime rates. A production version would include this caveat prominently and supplement with community safety reports.

**Transparency:** Safety scores are explained in plain English. Users see the crime breakdown behind every score.

**Augmentation:** This is a decision-support tool. Users retain full agency — they can choose any route.

---

## What's Next

- [ ] Live crime data from OpenDataPhilly API (real-time updates)
- [ ] Time-of-day animation on heatmap
- [ ] Driving + cycling route modes
- [ ] "Avoid this zone" custom exclusion areas
- [ ] Real-time incident alerts via push notification
- [ ] Community safety reports (resident-submitted)
- [ ] Offline PWA mode
- [ ] 911 quick-call panic button integration

---

Built with ❤️ for Philadelphia at Philly Codefest 2026.

*"The fastest route isn't always the right one."*
