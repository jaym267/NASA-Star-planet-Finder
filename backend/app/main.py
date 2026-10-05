from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .lightcurves import LightCurveNotFound, get_light_curve
from .transit_search import search_transits
from .vetting import model_info, score_signal

app = FastAPI(title="NASA Star Planet Finder API", version="0.3.0")

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
        result = search_transits(target.strip(), mission, observations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LightCurveNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't reach NASA's archive: {e}")
    # Scored on every request (not cached) so a retrained model applies to old searches too
    for signal in result["signals"]:
        signal["vetting"] = score_signal(signal, result["star"], result["mission"])
    return result


@app.get("/api/model")
def model():
    """What the vetting model was trained on and how well it did."""
    info = model_info()
    if info is None:
        raise HTTPException(status_code=503, detail="Vetting model not trained yet. Run notebooks/vetting_model.ipynb.")
    return info
