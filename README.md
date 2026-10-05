# NASA Star Planet Finder

A web tool for finding possible exoplanets in public NASA telescope data, and for comparing them against the planets we already know.

When a planet passes in front of its star, the star dims slightly. This app pulls real brightness data from NASA's TESS and Kepler missions so you can look for those dips.

## Roadmap

- [x] **Phase 1: Data explorer.** Look up a star and plot its light curve.
- [x] **Phase 2: Transit search.** Find repeating dips with Box Least Squares, fold them, and animate the transit.
- [x] **Phase 3: Vetting model.** Score how planet-like a signal is.
- [x] **Phase 4: Planet comparison dashboard.** Place candidates among every confirmed planet.
- [x] **Phase 5: Theory workspace.** Notebooks plus a Claude assistant that checks ideas against the archive.
- [ ] **Phase 6: Submit candidates to ExoFOP.**

## Stack

React + Tailwind (Vite) frontend, FastAPI backend, `lightkurve` for NASA data.

## Running locally

You need Python 3.10+ and Node 18+. Run the backend and frontend in two terminals.

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Check it at http://localhost:8000/api/health. Interactive API docs are at http://localhost:8000/docs.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and try `TOI-700`. The first load of a star takes a while because it downloads from NASA; after that it's cached.

Then click **Find transits**. The first search of a star downloads several sectors and takes 1 to 3 minutes.

## Transit search (Phase 2)

`GET /api/search?target=Kepler-10&mission=Kepler&observations=4`

1. Download and stitch several sectors (TESS) or quarters (Kepler).
2. Trim the edges of each data segment, where the telescope's brightness ramps after downlinks mimic transits.
3. Flatten slow trends, clip upward outliers only, and bin to 10 min (TESS) or 30 min (Kepler).
4. Run Box Least Squares over 0.5 days to half the data's time span (max 60 d). Keep a peak only if it has at least 3 transits, SDE ≥ 6, and SNR ≥ 7.1.
5. Mask the found transits, re-flatten, and search again for up to 3 planets.
6. Check each signal against known planets from the NASA Exoplanet Archive (by TIC ID, or Kepler ID in the KOI table).

Test results with 4 sectors or quarters each. Every signal found matches a known planet:

| Star | Found | Known period |
|---|---|---|
| Pi Mensae | 6.2679 d, 2.1 × Earth | pi Men c, 6.2678 d |
| Kepler-10 | 0.8375 d, 1.4 × Earth | Kepler-10 b, 0.8375 d |
| Kepler-10 | 45.29 d, 2.3 × Earth | Kepler-10 c, 45.294 d |
| TOI-700 | 16.050 d, 2.4 × Earth | TOI-700 c, 16.051 d |

TOI-700 b, d, and e are too small or too long-period to find in 4 sectors. Try more sectors.

## Vetting model (Phase 3)

A random forest trained on the Kepler KOI table: 2,748 confirmed planets vs. 4,839 false positives. Each signal from `/api/search` comes back with a `vetting` score. `GET /api/model` returns the training details and metrics.

- **Features:** period, duration, depth, implied planet size, the star's temperature, radius, and surface gravity, and the ratio of the actual duration to a planet's expected duration. Signal-to-noise and transit count are left out on purpose: they grow with the amount of data, and Kepler had years while a search here has months.
- **Results** (5-fold cross-validation grouped by star): ROC AUC 0.963 and accuracy 90%, vs. 64% for always guessing "false positive". It keeps 92% of real planets.
- **Our rediscoveries:** Kepler-10 c 97%, pi Men c 95%, TOI-700 c 85%, Kepler-10 b 65% ("uncertain"; orbits under a day are where many Kepler false positives sit).
- **Retrain:** `pip install -r backend/requirements-notebooks.txt`, then run `notebooks/vetting_model.ipynb`. It writes `backend/models/vetting_rf.joblib`.

## Comparison dashboard (Phase 4)

The **Compare** tab places your candidates among all ~6,400 confirmed planets. `GET /api/planets` serves the NASA Exoplanet Archive's composite table from a local SQLite copy (`data/cache/`, refreshed weekly).

- **Size vs. orbit:** the radius valley at 1.5 to 2 × Earth.
- **How common is each size:** a histogram binned evenly on a log scale, so the valley isn't distorted.
- **Mass vs. size:** a candidate appears as a line, since a transit measures size but not mass.
- **Habitable zone:** light received vs. star temperature, with the Kopparapu et al. (2014) conservative zone.
- **Filter:** all stars, red dwarfs, or Sun-like stars.

Each search signal also returns `derived`: orbit size, light received, equilibrium temperature, and habitable-zone position. These are computed from the period and the star's radius, temperature, and surface gravity.

**Data honesty:** the composite table fills gaps with formula estimates. Non-transiting planets get radii from a mass-radius relation, and many transiting planets get masses the same way. The charts plot only measured values: transit radii (4,740 planets), and for mass vs. size, planets with a measured mass too (1,749).

## Theory workspace (Phase 5)

The **Theorize** tab holds notebooks: a question you're investigating, your notes (autosaved), an optional snapshot of a candidate, and a conversation with Claude.

- **Setup:** create `backend/.env` containing `ANTHROPIC_API_KEY=...` (git-ignored), then restart the backend. Notes work without a key.
- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), streamed, at `medium` effort. Server-side refusal fallback (`fallbacks: "default"`) is on, so if a safety classifier declines, Anthropic retries on its recommended model.
- **Grounded in data:** Claude calls tools that query the local archive: `query_planets` (counts and medians for any filter), `size_distribution` (log-binned radius histogram), and `jwst_targets` (Transmission Spectroscopy Metric ranking, Kempton et al. 2018). The answers show which checks it ran.
- **Storage:** `data/user/notebooks.sqlite` (git-ignored). Conversations are stored exactly as the API returns them and only ever appended to. A failed turn is never saved.
- **Not real accounts yet:** each browser makes up an ID and sends it as `X-User-Id`. That keeps notebooks separate locally, but it is **not authentication**. Real logins are required before deploying for other people.

## Project layout

```
backend/   FastAPI app (light curves, transit search, known-planet lookup)
frontend/  React app (search, charts, transit animation)
data/      Example targets; downloaded data is cached here but not committed
docs/      Data sources and notes
notebooks/ Model training (vetting classifier)
```

## Data

See [docs/data-sources.md](docs/data-sources.md).
