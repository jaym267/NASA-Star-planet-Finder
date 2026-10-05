"""Fetch and clean light curves from NASA's MAST archive using lightkurve."""
import json
import re
from pathlib import Path

import lightkurve as lk
import numpy as np

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

MAX_POINTS = 5000  # enough detail for a chart without a huge payload

# lightkurve's mission names
MISSIONS = {"TESS": "TESS", "Kepler": "Kepler", "K2": "K2"}


class LightCurveNotFound(Exception):
    pass


def _cache_path(target: str, mission: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{mission}_{target}").strip("_")
    return CACHE_DIR / f"{safe}.json"


def _downsample(time: np.ndarray, flux: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Average neighbouring points so we send at most MAX_POINTS."""
    if len(time) <= MAX_POINTS:
        return time, flux
    size = int(np.ceil(len(time) / MAX_POINTS))
    usable = (len(time) // size) * size
    t = time[:usable].reshape(-1, size).mean(axis=1)
    f = flux[:usable].reshape(-1, size).mean(axis=1)
    return t, f


def get_light_curve(target: str, mission: str = "TESS") -> dict:
    if mission not in MISSIONS:
        raise ValueError(f"Mission must be one of: {', '.join(MISSIONS)}")

    cached = _cache_path(target, mission)
    if cached.exists():
        return json.loads(cached.read_text())

    # Prefer the official mission pipelines (SPOC for TESS, Kepler for Kepler).
    author = "SPOC" if mission == "TESS" else mission
    results = lk.search_lightcurve(target, mission=MISSIONS[mission], author=author)
    if len(results) == 0:
        results = lk.search_lightcurve(target, mission=MISSIONS[mission])
    if len(results) == 0:
        raise LightCurveNotFound(f"No {mission} light curves found for '{target}'.")

    # Phase 1: just the first available sector/quarter.
    lc = results[0].download(download_dir=str(CACHE_DIR / "raw"))
    lc = lc.remove_nans().normalize().remove_outliers(sigma=5)

    time = np.asarray(lc.time.value, dtype=float)
    flux = np.asarray(lc.flux.value, dtype=float)
    time, flux = _downsample(time, flux)

    row = results.table[0]
    data = {
        "target": target,
        "mission": mission,
        "observation": str(row["mission"]),
        "author": str(row["author"]),
        "available_observations": len(results),
        "time_format": "BTJD" if mission == "TESS" else "BKJD",
        "points": len(time),
        "time": np.round(time, 5).tolist(),
        "flux": np.round(flux, 6).tolist(),
    }
    cached.write_text(json.dumps(data))
    return data
