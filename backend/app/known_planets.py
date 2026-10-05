"""Look up planets already known around a star, so a search can be checked against them.

TESS stars are matched by TIC ID against confirmed planets (pscomppars). Kepler
stars are matched by Kepler ID against the KOI table, which also lists candidates
and false positives. Anything else falls back to the host name.
"""
import json
import urllib.parse
import urllib.request

TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"


def _tap(query: str) -> list[dict]:
    url = f"{TAP_URL}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read())


def _sql_str(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def known_planets(target: str, mission: str, star: dict) -> list[dict]:
    """Best effort: an archive outage shouldn't break the search, so failures return []."""
    try:
        if star.get("kepler_id"):
            rows = _tap(
                "select kepoi_name, kepler_name, koi_period, koi_prad, koi_disposition "
                f"from cumulative where kepid={int(star['kepler_id'])}"
            )
            return [
                {
                    "name": r["kepler_name"] or r["kepoi_name"],
                    "period_days": r["koi_period"],
                    "radius_earth": r["koi_prad"],
                    "status": r["koi_disposition"].lower(),
                }
                for r in rows
                if r["koi_period"]
            ]
        if star.get("tic_id"):
            where = f"tic_id={_sql_str(f'TIC {int(star['tic_id'])}')}"
        else:
            where = f"lower(hostname)=lower({_sql_str(target)})"
        rows = _tap(f"select pl_name, pl_orbper, pl_rade from pscomppars where {where}")
        return [
            {"name": r["pl_name"], "period_days": r["pl_orbper"], "radius_earth": r["pl_rade"], "status": "confirmed"}
            for r in rows
            if r["pl_orbper"]
        ]
    except Exception:
        return []


def match_known(period: float, known: list[dict], tol: float = 0.01) -> dict | None:
    """Match a found period to a known planet, allowing for BLS locking onto 2x or 1/2 the period."""
    best = None
    for p in known:
        for factor, label in ((1, "exact"), (2, "double"), (0.5, "half")):
            ratio = period / (p["period_days"] * factor)
            err = abs(ratio - 1)
            if err < tol and (best is None or err < best["error"]):
                best = {"name": p["name"], "period_days": p["period_days"], "relation": label, "error": round(err, 5)}
    return best
