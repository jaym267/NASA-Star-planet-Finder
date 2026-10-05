# NASA Star Planet Finder

A web tool for finding possible exoplanets in public NASA telescope data, and for comparing them against the planets we already know.

When a planet passes in front of its star, the star dims slightly. This app pulls real brightness data from NASA's TESS and Kepler missions so you can look for those dips.

## Roadmap

- [x] **Phase 1: Data explorer.** Look up a star and plot its light curve.
- [ ] **Phase 2: Transit search.** Find repeating dips with Box Least Squares.
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

## Project layout

```
backend/   FastAPI app (fetches and cleans light curves)
frontend/  React app (search + chart)
data/      Example targets; downloaded data is cached here but not committed
docs/      Data sources and notes
```

## Data

See [docs/data-sources.md](docs/data-sources.md).
