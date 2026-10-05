import json

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import assistant, notebooks
from .archive import all_planets, derived_properties, hz_curve
from .lightcurves import LightCurveNotFound, get_light_curve
from .transit_search import search_transits
from .vetting import model_info, score_signal

app = FastAPI(title="NASA Star Planet Finder API", version="0.5.0")

app.add_middleware(GZipMiddleware, minimum_size=2000)  # chart payloads shrink ~5x
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
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
        signal["derived"] = derived_properties(signal, result["star"])
    return result


@app.get("/api/planets")
def planets():
    """Every confirmed exoplanet (NASA Exoplanet Archive), plus the habitable zone's edges."""
    try:
        return {**all_planets(), "habitable_zone": hz_curve()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't load the Exoplanet Archive: {e}")


@app.get("/api/model")
def model():
    """What the vetting model was trained on and how well it did."""
    info = model_info()
    if info is None:
        raise HTTPException(status_code=503, detail="Vetting model not trained yet. Run notebooks/vetting_model.ipynb.")
    return info


# --- Phase 5: theory notebooks and the assistant ---------------------------------


def _user(x_user_id: str | None) -> str:
    if not notebooks.valid_user(x_user_id):
        raise HTTPException(status_code=401, detail="Missing or invalid X-User-Id header.")
    return x_user_id


class NewNotebook(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    context: dict | None = None


class NotebookUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    notes: str | None = Field(None, max_length=50_000)


class ChatMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


@app.get("/api/assistant")
def assistant_status():
    return {"configured": assistant.configured(), "model": assistant.MODEL}


@app.get("/api/notebooks")
def list_notebooks(x_user_id: str | None = Header(None)):
    return notebooks.list_notebooks(_user(x_user_id))


@app.post("/api/notebooks")
def create_notebook(body: NewNotebook, x_user_id: str | None = Header(None)):
    return notebooks.create_notebook(_user(x_user_id), body.title.strip(), body.context)


@app.get("/api/notebooks/{nb_id}")
def get_notebook(nb_id: str, x_user_id: str | None = Header(None)):
    try:
        return notebooks.get_notebook(_user(x_user_id), nb_id)
    except notebooks.NotFound:
        raise HTTPException(status_code=404, detail="Notebook not found.")


@app.patch("/api/notebooks/{nb_id}")
def update_notebook(nb_id: str, body: NotebookUpdate, x_user_id: str | None = Header(None)):
    try:
        return notebooks.update_notebook(_user(x_user_id), nb_id, body.title, body.notes)
    except notebooks.NotFound:
        raise HTTPException(status_code=404, detail="Notebook not found.")


@app.delete("/api/notebooks/{nb_id}")
def delete_notebook(nb_id: str, x_user_id: str | None = Header(None)):
    try:
        notebooks.delete_notebook(_user(x_user_id), nb_id)
    except notebooks.NotFound:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    return {"deleted": nb_id}


@app.post("/api/notebooks/{nb_id}/chat")
def chat(nb_id: str, body: ChatMessage, x_user_id: str | None = Header(None)):
    """Ask the assistant inside a notebook. Streams Server-Sent Events: text, tool, error, done."""
    owner = _user(x_user_id)
    if not assistant.configured():
        raise HTTPException(status_code=503, detail="The assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to backend/.env and restart the backend.")
    try:
        history, context = notebooks.get_history(owner, nb_id)
    except notebooks.NotFound:
        raise HTTPException(status_code=404, detail="Notebook not found.")

    def events():
        try:
            for event in assistant.run_turn(history, body.message.strip(), context):
                if event["type"] == "done":
                    notebooks.append_messages(owner, nb_id, event["messages"])  # only complete turns are saved
                    event = {"type": "done"}
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': assistant.friendly_error(e)})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
