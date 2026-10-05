"""Phase 4: a local copy of every confirmed exoplanet, for comparing candidates against.

The NASA Exoplanet Archive's Planetary Systems Composite table (pscomppars) has one
row per planet with the best available values. We store it in SQLite under
data/cache/ (git-ignored, re-downloadable) and refresh it weekly.
"""
import csv
import io
import sqlite3
import threading
import time
import urllib.parse
import urllib.request

from .lightcurves import CACHE_DIR

DB_PATH = CACHE_DIR / "exoplanets_v2.sqlite"  # bump the name when COLUMNS change
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MAX_AGE_SECONDS = 7 * 24 * 3600

COLUMNS = {
    "pl_name": "TEXT PRIMARY KEY",
    "hostname": "TEXT",
    "pl_orbper": "REAL",      # orbital period, days
    "pl_rade": "REAL",        # radius, Earth radii
    "pl_bmasse": "REAL",      # mass (or minimum mass), Earth masses
    "pl_insol": "REAL",       # light received, relative to Earth
    "pl_eqt": "REAL",         # equilibrium temperature, K
    "st_teff": "REAL",        # star temperature, K
    "st_rad": "REAL",         # star radius, Sun radii
    "st_mass": "REAL",        # star mass, Sun masses
    "sy_dist": "REAL",        # distance, parsecs
    "discoverymethod": "TEXT",
    "disc_year": "INTEGER",
    # Provenance. This table fills gaps with estimates: radii of non-transiting planets and many
    # masses come from an empirical mass-radius formula, not a measurement. Charts must filter
    # on these so they show real data.
    "tran_flag": "INTEGER",   # 1 = transits, so its radius was measured
    "pl_bmassprov": "TEXT",   # "Mass" / "Msini" = measured; "M-R relationship" = estimated
}

_lock = threading.Lock()


def _download_rows() -> list[dict]:
    query = f"select {','.join(COLUMNS)} from pscomppars"
    url = f"{TAP_URL}?{urllib.parse.urlencode({'query': query, 'format': 'csv'})}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def refresh(force: bool = False) -> None:
    """Download the archive into SQLite if it's missing or more than a week old."""
    with _lock:
        if not force and DB_PATH.exists() and time.time() - DB_PATH.stat().st_mtime < MAX_AGE_SECONDS:
            return
        rows = _download_rows()
        tmp = DB_PATH.with_suffix(".tmp")
        tmp.unlink(missing_ok=True)
        con = sqlite3.connect(tmp)
        con.execute(f"CREATE TABLE planets ({', '.join(f'{c} {t}' for c, t in COLUMNS.items())})")
        con.executemany(
            f"INSERT OR REPLACE INTO planets VALUES ({', '.join('?' for _ in COLUMNS)})",
            [[_value(r[c], COLUMNS[c]) for c in COLUMNS] for r in rows],
        )
        con.commit()
        con.close()
        tmp.replace(DB_PATH)  # swap in atomically so readers never see a half-built table


def _value(v: str, sql_type: str):
    if v == "":
        return None
    if sql_type == "REAL":
        return float(v)
    if sql_type == "INTEGER":
        return int(float(v))
    return v


def all_planets() -> dict:
    """Every planet as columns of arrays (compact for charts)."""
    refresh()
    con = sqlite3.connect(DB_PATH)
    cur = con.execute(f"SELECT {', '.join(COLUMNS)} FROM planets ORDER BY pl_name")
    rows = cur.fetchall()
    con.close()
    cols = {c: [r[i] for r in rows] for i, c in enumerate(COLUMNS)}
    return {
        "count": len(rows),
        "updated": time.strftime("%Y-%m-%d", time.gmtime(DB_PATH.stat().st_mtime)),
        "columns": cols,
    }


# --- Physics for placing a candidate on the same charts -------------------------

SOLAR_TEFF = 5772.0
SOLAR_LOGG = 4.438


def star_mass_sun(radius_sun, logg):
    """Mass from surface gravity and radius: M/M☉ = (g/g☉)(R/R☉)²."""
    if radius_sun is None or logg is None:
        return None
    return 10 ** (logg - SOLAR_LOGG) * radius_sun ** 2


def derived_properties(signal: dict, star: dict) -> dict:
    """Orbit size, light received, and temperature of a candidate, from its period and its star."""
    period, r_star, teff = signal["period_days"], star.get("radius_sun"), star.get("teff")
    mass = star_mass_sun(r_star, star.get("logg"))
    out = {"semi_major_axis_au": None, "insolation_earth": None, "equilibrium_temp_k": None, "habitable_zone": None}
    if not (period and r_star and teff and mass):
        return out
    a = (period / 365.25) ** (2 / 3) * mass ** (1 / 3)               # Kepler's third law, AU
    s = r_star ** 2 * (teff / SOLAR_TEFF) ** 4 / a ** 2            # Earth receives 1.0
    out.update(
        semi_major_axis_au=round(a, 5),
        insolation_earth=round(s, 3),
        equilibrium_temp_k=round(278.6 * s ** 0.25),               # zero albedo, like the archive's pl_eqt
        habitable_zone=habitable_zone_position(s, teff),
    )
    return out


# Kopparapu et al. (2014) conservative habitable zone for an Earth-mass planet:
# Seff = S☉ + aT + bT² + cT³ + dT⁴, with T = Teff − 5780 K. Valid for 2600–7200 K.
_HZ = {
    "inner": (1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-15),   # runaway greenhouse
    "outer": (0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16),   # maximum greenhouse
}


def hz_limits(teff: float) -> tuple[float, float]:
    """Insolation at the inner (hot) and outer (cold) edges of the habitable zone."""
    t = min(max(teff, 2600), 7200) - 5780
    def seff(c): return c[0] + c[1] * t + c[2] * t ** 2 + c[3] * t ** 3 + c[4] * t ** 4
    return seff(_HZ["inner"]), seff(_HZ["outer"])


def habitable_zone_position(insolation: float, teff: float) -> str:
    inner, outer = hz_limits(teff)
    if insolation > inner:
        return "too hot"
    if insolation < outer:
        return "too cold"
    return "in the habitable zone"


def hz_curve(n: int = 47) -> dict:
    """The habitable zone's edges across star temperatures, for drawing the band."""
    temps = [2600 + i * (7200 - 2600) / (n - 1) for i in range(n)]
    limits = [hz_limits(t) for t in temps]
    return {
        "teff": [round(t) for t in temps],
        "inner": [round(i, 4) for i, _ in limits],
        "outer": [round(o, 4) for _, o in limits],
    }

