from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .lightcurves import LightCurveNotFound, get_light_curve
from .transit_search import search_transits

app = FastAPI(title="NASA Star Planet Finder API", version="0.2.0")

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


@app.get("/api/search")
def search(
    target: str = Query(..., min_length=1, max_length=60, examples=["Pi Mensae"]),
    mission: str = Query("TESS"),
    observations: int = Query(4, ge=1, le=12, description="Sectors (TESS) or quarters (Kepler) to search"),
):
    """Search a star for repeating transits with Box Least Squares. The first run takes a few minutes."""
    try:
        return search_transits(target.strip(), mission, observations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LightCurveNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't reach NASA's archive: {e}")
