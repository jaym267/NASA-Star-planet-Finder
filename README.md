# NASA Star Planet Finder

A web tool for finding possible exoplanets in public NASA telescope data, and for comparing them against the planets we already know.

When a planet passes in front of its star, the star dims slightly. This app pulls real brightness data from NASA's TESS and Kepler missions so you can look for those dips.

## Roadmap

- [x] **Phase 1: Data explorer.** Look up a star and plot its light curve.
- [x] **Phase 2: Transit search.** Find repeating dips with Box Least Squares, fold them, and animate the transit.
- [ ] **Phase 3: Vetting model.** Score how planet-like a signal is.
- [ ] **Phase 4: Planet comparison dashboard.**
- [ ] **Phase 5: Theory workspace.**
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

## Project layout

```
backend/   FastAPI app (light curves, transit search, known-planet lookup)
frontend/  React app (search, charts, transit animation)
data/      Example targets; downloaded data is cached here but not committed
docs/      Data sources and notes
```

## Data

See [docs/data-sources.md](docs/data-sources.md).
