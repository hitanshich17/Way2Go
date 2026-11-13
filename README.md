# Way2Go — Philly Codefest 2026

Two projects built at **Philly Codefest 2026**, a hackathon themed *Building AI for Philly's Future*.

| Project | What it does | Stack |
|---|---|---|
| [**SafeRouteAI**](saferoute-ai/) | Walking directions that rank routes by safety, not just speed | Next.js, Google Maps, Python (KDE, XGBoost) |
| [**PhillyPath**](phillypath/) | An AI college counselor for Philadelphia students, in English and Spanish | FastAPI, Claude (Anthropic API), React |

## SafeRouteAI

Google Maps returns up to five walking routes; SafeRouteAI scores each one from 0 to 100 using about 43,000
Philadelphia crime records and color-codes them on the map, so you can pick a route that is a little longer but
safer.

- **Risk model:** a kernel density (KDE) risk grid of where crimes cluster, plus an **XGBoost** model of risk by
  hour of day, both trained offline in Python and exported as JSON grids.
- **Scoring in the browser:** each route's points are matched against the grids, with crimes weighted by severity
  and distance, so scoring needs no backend and adds no latency.
- **Night mode** weights crimes that happen after dark more heavily; a heatmap layer shows hotspots.

## PhillyPath

Philadelphia public schools have about one counselor per 491 students. PhillyPath is a free, always-available
counselor that knows Philadelphia: local scholarships, programs, colleges and financial aid.

- **AI counselor:** a FastAPI backend calls **Claude** with a Philadelphia-specific knowledge base, answering in
  English or Spanish.
- **Opportunity explorer:** curated scholarships, mentorships, internships and workforce programs, each with an
  "Ask AI" button that opens a conversation about it.
- **Impact dashboard:** the numbers behind Philadelphia's college-guidance gap.

## Quick start

**SafeRouteAI** (needs a Google Maps API key with the Maps JavaScript, Places and Directions APIs)

```bash
cd saferoute-ai
cp .env.local.example .env.local   # add your Google Maps API key
npm install
npm run dev                        # http://localhost:3000
```

**PhillyPath** (needs an Anthropic API key)

```bash
cd phillypath
cp backend/.env.example backend/.env   # add your Anthropic API key
./start.sh                             # backend on http://localhost:8000
# then open frontend/index.html in your browser
```

API keys stay in the gitignored `.env` / `.env.local` files. Each project's own README has the full details.
