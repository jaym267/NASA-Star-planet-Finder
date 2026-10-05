"""Phase 3: score how planet-like a transit signal is.

A random forest trained on Kepler's KOI table (confirmed planets vs. false positives,
see notebooks/vetting_model.ipynb). The same feature code is used for training and
for scoring our own BLS signals, so the model always sees the same inputs.

We only use properties of the star and the signal itself, never things that grow
with how much data you have (signal-to-noise, number of transits). Kepler had four
years of data; a search here might use four months, so those would mislead the model.
"""
import json
import math
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_PATH = MODEL_DIR / "vetting_rf.joblib"
META_PATH = MODEL_DIR / "vetting_rf.json"

FEATURES = [
    "period_days",
    "duration_hours",
    "depth_ppm",
    "planet_radius_earth",
    "star_teff",
    "star_radius_sun",
    "star_logg",
    "duration_ratio",
]

FEATURE_LABELS = {
    "period_days": "Orbital period",
    "duration_hours": "Transit duration",
    "depth_ppm": "Dip depth",
    "planet_radius_earth": "Planet size",
    "star_teff": "Star temperature",
    "star_radius_sun": "Star size",
    "star_logg": "Star surface gravity",
    "duration_ratio": "Duration vs. expected for a planet",
}

SOLAR_LOGG = 4.438


def expected_duration_hours(period_days, star_radius_sun, star_logg):
    """How long a central transit should last for a planet on this orbit around this star.

    From Kepler's third law: T ≈ 13 h × (P / 1 yr)^(1/3) × (stellar density / Sun's)^(-1/3).
    Density comes from surface gravity and radius: ρ/ρ☉ = (g/g☉) / (R/R☉).
    """
    if not (period_days and star_radius_sun and star_logg is not None):
        return None
    density = 10 ** (star_logg - SOLAR_LOGG) / star_radius_sun
    if density <= 0:
        return None
    return 13.0 * (period_days / 365.25) ** (1 / 3) * density ** (-1 / 3)


def _clean(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return math.nan
    return v if math.isfinite(v) else math.nan


def make_features(period_days, duration_hours, depth_ppm, planet_radius_earth, star_teff, star_radius_sun, star_logg):
    expected = expected_duration_hours(_clean(period_days), _clean(star_radius_sun), _clean(star_logg))
    ratio = _clean(duration_hours) / expected if expected else math.nan
    values = {
        "period_days": period_days,
        "duration_hours": duration_hours,
        "depth_ppm": depth_ppm,
        "planet_radius_earth": planet_radius_earth,
        "star_teff": star_teff,
        "star_radius_sun": star_radius_sun,
        "star_logg": star_logg,
        "duration_ratio": ratio,
    }
    return {k: _clean(v) for k, v in values.items()}


def features_from_koi(row) -> dict:
    """Features from a row of the Exoplanet Archive's KOI (cumulative) table."""
    return make_features(
        row["koi_period"], row["koi_duration"], row["koi_depth"], row["koi_prad"],
        row["koi_steff"], row["koi_srad"], row["koi_slogg"],
    )


def features_from_signal(signal: dict, star: dict) -> dict:
    """Features from one of our BLS signals plus the star info from the light curve header."""
    return make_features(
        signal["period_days"], signal["duration_hours"], signal["depth_ppm"], signal.get("planet_radius_earth"),
        star.get("teff"), star.get("radius_sun"), star.get("logg"),
    )


_model = None
_meta = None


def _load():
    global _model, _meta
    if _model is None and MODEL_PATH.exists():
        import joblib

        _model = joblib.load(MODEL_PATH)
        _meta = json.loads(META_PATH.read_text())
    return _model, _meta


def model_info() -> dict | None:
    _, meta = _load()
    return meta


def score_signal(signal: dict, star: dict, mission: str) -> dict | None:
    """Probability (0 to 1) that the signal is a planet rather than a false positive."""
    model, meta = _load()
    if model is None:
        return None
    feats = features_from_signal(signal, star)
    row = [[feats[f] for f in FEATURES]]
    prob = float(model.predict_proba(row)[0][1])
    missing = [FEATURE_LABELS[f] for f in FEATURES if math.isnan(feats[f])]
    notes = []
    if mission != "Kepler":
        notes.append(f"The model learned from Kepler signals, so scores for {mission} data are less certain.")
    if missing:
        notes.append(f"Missing: {', '.join(missing)}. The model scored without them.")
    return {
        "planet_probability": round(prob, 3),
        "verdict": "likely planet" if prob >= 0.7 else "likely false positive" if prob <= 0.3 else "uncertain",
        "features": {f: (None if math.isnan(v) else round(v, 4)) for f, v in feats.items()},
        "notes": notes,
    }
