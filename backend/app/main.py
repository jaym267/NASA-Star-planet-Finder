from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .lightcurves import LightCurveNotFound, get_light_curve

app = FastAPI(title="NASA Star Planet Finder API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/lightcurve")
def lightcurve(
    target: str = Query(..., min_length=1, max_length=60, examples=["TOI-700"]),
    mission: str = Query("TESS"),
):
    try:
        return get_light_curve(target.strip(), mission)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LightCurveNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # network or archive problems
        raise HTTPException(status_code=502, detail=f"Couldn't reach NASA's archive: {e}")
