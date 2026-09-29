# Way2Go — Philly Codefest 2026

Two projects built for **Philly Codefest 2026** (theme: *Building AI for Philly's Future*).

| Project | What it is | Stack |
|---|---|---|
| [`saferoute-ai/`](saferoute-ai/) | **SafeRouteAI** — walking navigation that scores routes by safety using Philadelphia crime data | Next.js, Google Maps, Python (KDE + XGBoost) |
| [`phillypath/`](phillypath/) | **PhillyPath** — AI college counselor for Philadelphia students | FastAPI, Claude (Anthropic API), React (single HTML file) |

See each project's README for setup instructions.

## Quick start

**SafeRouteAI**
```bash
cd saferoute-ai
cp .env.local.example .env.local   # add your Google Maps API key
npm install
npm run dev                        # http://localhost:3000
```

**PhillyPath**
```bash
cd phillypath
cp backend/.env.example backend/.env   # add your Anthropic API key
./start.sh                             # backend on http://localhost:8000
# then open frontend/index.html in your browser
```

API keys are never committed; keep them in the `.env` / `.env.local` files, which are gitignored.
