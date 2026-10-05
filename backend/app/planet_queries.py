"""Phase 5: questions about the known-planet population, answered from the local archive.

These are the tools the theory assistant calls, so its claims rest on real numbers
instead of memory. Every function only uses measured values: radii from transits,
masses that weren't estimated from a formula.
"""
import math
import sqlite3
import statistics

from .archive import DB_PATH, hz_limits, refresh

HZ_TEFF_RANGE = (2600, 7200)  # where the Kopparapu habitable-zone fit is valid


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _rows(where: list[str], params: list) -> list[sqlite3.Row]:
    refresh()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    sql = "SELECT * FROM planets" + (" WHERE " + " AND ".join(where) if where else "")
    rows = con.execute(sql, params).fetchall()
    con.close()
    return rows


def _filters(args: dict) -> tuple[list[str], list]:
    """Turn optional min/max arguments into SQL conditions. Unknown or non-numeric values are ignored."""
    fields = {
        "star_teff": "st_teff",
        "radius": "pl_rade",
        "period": "pl_orbper",
        "insolation": "pl_insol",
    }
    where, params = [], []
    for name, col in fields.items():
        lo, hi = _num(args.get(f"{name}_min")), _num(args.get(f"{name}_max"))
        if lo is not None:
            where.append(f"{col} >= ?")
            params.append(lo)
        if hi is not None:
            where.append(f"{col} <= ?")
            params.append(hi)
    return where, params


MEASURED_RADIUS = "tran_flag = 1 AND pl_rade > 0"
MEASURED_MASS = "pl_bmasse > 0 AND pl_bmassprov IS NOT NULL AND pl_bmassprov != 'M-R relationship'"


def _median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 3) if values else None


def _planet(r) -> dict:
    return {
        "name": r["pl_name"],
        "period_days": _round(r["pl_orbper"], 3),
        "radius_earth": _round(r["pl_rade"], 2),
        "mass_earth": _round(r["pl_bmasse"], 2) if r["pl_bmassprov"] != "M-R relationship" else None,
        "insolation_earth": _round(r["pl_insol"], 2),
        "star_teff": _round(r["st_teff"], 0),
    }


def _round(v, n):
    return round(v, n) if v is not None else None


def query_planets(args: dict) -> dict:
    """Count and summarize confirmed planets matching filters."""
    where, params = _filters(args)
    if args.get("require_measured_mass"):
        where.append(MEASURED_MASS)
    if _num(args.get("radius_min")) is not None or _num(args.get("radius_max")) is not None:
        where.append(MEASURED_RADIUS)  # filtering on formula-estimated radii would be meaningless
    rows = _rows(where, params)

    in_hz = 0
    hz_checked = 0
    for r in rows:
        t, s = r["st_teff"], r["pl_insol"]
        if t and s and HZ_TEFF_RANGE[0] <= t <= HZ_TEFF_RANGE[1]:
            hz_checked += 1
            inner, outer = hz_limits(t)
            in_hz += outer <= s <= inner

    measured_r = [r["pl_rade"] for r in rows if r["tran_flag"] == 1]
    measured_m = [r["pl_bmasse"] for r in rows if r["pl_bmassprov"] not in (None, "M-R relationship")]
    examples = sorted(rows, key=lambda r: r["pl_name"])[:: max(1, len(rows) // 8)][:8]
    return {
        "count": len(rows),
        "median_period_days": _median([r["pl_orbper"] for r in rows]),
        "median_measured_radius_earth": _median(measured_r),
        "planets_with_measured_radius": len(measured_r),
        "median_measured_mass_earth": _median(measured_m),
        "planets_with_measured_mass": len(measured_m),
        "median_insolation_earth": _median([r["pl_insol"] for r in rows]),
        "in_habitable_zone": in_hz,
        "habitable_zone_checked": hz_checked,
        "discovery_methods": _counts(r["discoverymethod"] for r in rows),
        "examples": [_planet(r) for r in examples],
    }


def _counts(values) -> dict:
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def size_distribution(args: dict) -> dict:
    """Histogram of measured planet radii, evenly spaced in log(radius), with counts per bin."""
    where, params = _filters(args)
    where.append(MEASURED_RADIUS)
    radii = [r["pl_rade"] for r in _rows(where, params)]
    lo, hi = math.log10(0.5), math.log10(6)
    n = int(_num(args.get("bins")) or 16)
    n = max(4, min(n, 40))
    step = (hi - lo) / n
    counts = [0] * n
    for r in radii:
        b = math.floor((math.log10(r) - lo) / step)
        if 0 <= b < n:
            counts[b] += 1
    return {
        "planets_counted": sum(counts),
        "note": "Radii from transits only, 0.5 to 6 × Earth. Bins are equal width in log(radius).",
        "bins": [
            {"from_earth_radii": round(10 ** (lo + i * step), 3), "to_earth_radii": round(10 ** (lo + (i + 1) * step), 3), "count": c}
            for i, c in enumerate(counts)
        ],
    }


# Kempton et al. (2018) transmission spectroscopy metric scale factors, by planet radius.
_TSM_SCALE = [(1.5, 0.190), (2.75, 1.26), (4.0, 1.28), (10.0, 1.15)]


def _mass_estimate(radius):
    """Chen & Kipping (2017) mass-radius relation, as used by Kempton et al. (2018)."""
    return 0.9718 * radius ** 3.58 if radius < 1.23 else 1.436 * radius ** 1.70


def jwst_targets(args: dict) -> dict:
    """Rank transiting planets by the Transmission Spectroscopy Metric (how well JWST could study their atmospheres)."""
    where, params = _filters(args)
    where += [MEASURED_RADIUS, "pl_rade < 10", "pl_eqt > 0", "st_rad > 0", "sy_jmag IS NOT NULL"]
    limit = int(_num(args.get("limit")) or 10)
    limit = max(1, min(limit, 25))
    ranked = []
    for r in _rows(where, params):
        rp = r["pl_rade"]
        measured = r["pl_bmassprov"] not in (None, "M-R relationship") and r["pl_bmasse"] and r["pl_bmasse"] > 0
        mp = r["pl_bmasse"] if measured else _mass_estimate(rp)
        scale = next(s for edge, s in _TSM_SCALE if rp < edge)
        tsm = scale * rp ** 3 * r["pl_eqt"] / (mp * r["st_rad"] ** 2) * 10 ** (-r["sy_jmag"] / 5)
        ranked.append((tsm, r, measured))
    ranked.sort(key=lambda x: -x[0])
    return {
        "candidates_considered": len(ranked),
        "method": "Transmission Spectroscopy Metric (Kempton et al. 2018). Higher means a stronger atmosphere signal per hour of JWST time. "
                  "Suggested cutoffs: 10 for planets under 1.5 × Earth, 90 for larger ones. Mass is estimated from radius when not measured.",
        "top": [
            {**_planet(r), "tsm": round(tsm, 1), "mass_measured": bool(measured), "equilibrium_temp_k": _round(r["pl_eqt"], 0)}
            for tsm, r, measured in ranked[:limit]
        ],
    }


_FILTER_PROPS = {
    "star_teff_min": {"type": "number", "description": "Minimum star temperature in kelvin (red dwarfs are under ~4000 K, the Sun is 5772 K)"},
    "star_teff_max": {"type": "number", "description": "Maximum star temperature in kelvin"},
    "radius_min": {"type": "number", "description": "Minimum planet radius in Earth radii"},
    "radius_max": {"type": "number", "description": "Maximum planet radius in Earth radii"},
    "period_min": {"type": "number", "description": "Minimum orbital period in days"},
    "period_max": {"type": "number", "description": "Maximum orbital period in days"},
    "insolation_min": {"type": "number", "description": "Minimum light received, relative to Earth (Earth = 1)"},
    "insolation_max": {"type": "number", "description": "Maximum light received, relative to Earth"},
}

TOOLS = [
    {
        "name": "query_planets",
        "description": "Count and summarize confirmed exoplanets in the NASA Exoplanet Archive that match optional filters. "
                       "Returns the count, medians of period, measured radius, measured mass and insolation, how many sit in the "
                       "conservative habitable zone, discovery methods, and a few example planets. Use it to check any claim about "
                       "the planet population, and to compare two groups (call it once per group).",
        "input_schema": {
            "type": "object",
            "properties": {
                **_FILTER_PROPS,
                "require_measured_mass": {"type": "boolean", "description": "Only include planets with a measured (not estimated) mass"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "size_distribution",
        "description": "Histogram of measured planet radii (0.5 to 6 × Earth, log-spaced bins) for planets matching optional filters. "
                       "Use it to look for features like the radius valley near 1.5 to 2 × Earth, and to compare groups such as red "
                       "dwarfs vs. Sun-like stars or short vs. long orbits.",
        "input_schema": {
            "type": "object",
            "properties": {
                **_FILTER_PROPS,
                "bins": {"type": "integer", "description": "Number of bins, 4 to 40 (default 16)"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "jwst_targets",
        "description": "Rank transiting planets under 10 × Earth by the Transmission Spectroscopy Metric: how strong an atmosphere "
                       "signal JWST would see. Optional filters narrow the list (for example small planets around cool stars).",
        "input_schema": {
            "type": "object",
            "properties": {
                **_FILTER_PROPS,
                "limit": {"type": "integer", "description": "How many to return, 1 to 25 (default 10)"},
            },
            "additionalProperties": False,
        },
    },
]

HANDLERS = {"query_planets": query_planets, "size_distribution": size_distribution, "jwst_targets": jwst_targets}
