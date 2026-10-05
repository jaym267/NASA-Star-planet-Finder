"""Phase 2: search a star's light curve for repeating transits with Box Least Squares.

Pipeline:
  1. Download several sectors/quarters and stitch them into one light curve.
  2. Flatten (remove slow stellar and instrumental trends) so only short dips remain.
  3. Run BLS: try many orbital periods and durations, and score how well a
     repeating box-shaped dip fits at each one.
  4. Keep the strongest signal, mask its transits, and search again to find
     additional planets in the same system.
"""
import json
import time as _time
import warnings

import lightkurve as lk
import numpy as np
from astropy.timeseries import BoxLeastSquares

from .known_planets import known_planets, match_known
from .lightcurves import CACHE_DIR, MISSIONS, LightCurveNotFound, _cache_path

SEARCH_CACHE_VERSION = 5

MAX_SIGNALS = 3          # planets to look for per star
MIN_SNR = 7.1            # the Kepler mission's detection threshold
MIN_SDE = 6.0            # how far the peak stands above the rest of the periodogram
MIN_TRANSITS = 3         # fewer than this and a "period" is just a guess
MAX_PEAKS_TRIED = 25
MIN_PERIOD = 0.5         # days
MAX_PERIOD_CAP = 60.0    # days; longer needs years of data anyway
DURATIONS = np.array([1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5]) / 24  # days
FLATTEN_WINDOW = 1.0     # days; must be several times longer than a transit
BIN_MINUTES = {"TESS": 10, "Kepler": 30, "K2": 30}
EARTH_RADII_PER_SUN = 109.1
GAP_DAYS = 0.5           # a break in the data longer than this starts a new segment
TRIM_START_DAYS = 0.25   # brightness ramps after each data downlink
TRIM_END_DAYS = 0.15
MIN_SEGMENT_DAYS = 1.0


def _download(target: str, mission: str, max_obs: int) -> tuple[lk.LightCurve, dict]:
    """Download up to max_obs observations and stitch them into one normalized light curve."""
    author = "SPOC" if mission == "TESS" else mission
    exptime = 120 if mission == "TESS" else "long"
    results = lk.search_lightcurve(target, mission=MISSIONS[mission], author=author, exptime=exptime)
    if len(results) == 0:
        results = lk.search_lightcurve(target, mission=MISSIONS[mission])
    if len(results) == 0:
        raise LightCurveNotFound(f"No {mission} light curves found for '{target}'.")

    available = len(results)
    results = results[:max_obs]
    collection = results.download_all(download_dir=str(CACHE_DIR / "raw"))
    if collection is None or len(collection) == 0:
        raise LightCurveNotFound(f"Couldn't download {mission} data for '{target}'.")

    meta = collection[0].meta
    lc = collection.stitch(lambda x: x.remove_nans().normalize())
    lc = _trim_segment_edges(lc.remove_nans())
    star = {
        "radius_sun": _num(meta.get("RADIUS")),
        "teff": _num(meta.get("TEFF")),
        "logg": _num(meta.get("LOGG")),
        "tic_id": meta.get("TICID"),
        "kepler_id": meta.get("KEPLERID"),
        "object": meta.get("OBJECT"),
    }
    info = {
        "observations_used": [str(m) for m in results.table["mission"]],
        "available_observations": available,
    }
    return lc, {"star": star, **info}


def _trim_segment_edges(lc: lk.LightCurve) -> lk.LightCurve:
    """Drop the edges of each continuous stretch of data.

    The telescope warms up and settles after every pause to send data home, which
    makes the star look briefly dimmer. Those ramps look exactly like transits to BLS.
    """
    t = lc.time.value
    starts = np.r_[0, np.where(np.diff(t) > GAP_DAYS)[0] + 1]
    ends = np.r_[starts[1:], len(t)]
    keep = np.zeros(len(t), dtype=bool)
    for a, b in zip(starts, ends):
        lo, hi = t[a] + TRIM_START_DAYS, t[b - 1] - TRIM_END_DAYS
        if hi - lo >= MIN_SEGMENT_DAYS:
            keep[a:b] = (t[a:b] >= lo) & (t[a:b] <= hi)
    return lc[keep]


def _num(v):
    try:
        v = float(v)
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _flatten(lc: lk.LightCurve, mission: str, mask=None) -> lk.LightCurve:
    """Remove slow trends, then bin. Transit points are masked so the trend fit doesn't eat them."""
    cadence = np.nanmedian(np.diff(lc.time.value))
    window = int(FLATTEN_WINDOW / cadence) | 1  # odd number of cadences
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        flat = lc.flatten(window_length=max(window, 5), mask=mask, break_tolerance=10)
        # Clip only upward outliers (cosmic rays, flares). Dips are what we're looking for.
        flat = flat.remove_outliers(sigma_upper=4, sigma_lower=np.inf)
        flat = flat.bin(time_bin_size=BIN_MINUTES[mission] / 1440).remove_nans()
    return flat


def _bls_once(t, f, e, max_period):
    """Return the strongest periodic signal, skipping peaks caused by one or two isolated glitches."""
    bls = BoxLeastSquares(t, f, dy=e)
    baseline = t.max() - t.min()
    # Log-spaced periods, fine enough that phase drifts < 1/3 of the shortest
    # transit over the full baseline.
    step = DURATIONS.min() / (3 * baseline)
    periods = np.exp(np.arange(np.log(MIN_PERIOD), np.log(max_period), step))
    pg = bls.power(periods, DURATIONS, objective="snr")
    power = np.asarray(pg.power)
    mean, std = power.mean(), power.std()

    tried = []
    for i in np.argsort(power)[::-1][:2000]:
        period = float(pg.period[i])
        if any(abs(period / p - 1) < 0.01 for p in tried):
            continue
        tried.append(period)
        if len(tried) > MAX_PEAKS_TRIED:
            break
        period, t0, duration = _refine(bls, period, float(pg.duration[i]))
        stats = bls.compute_stats(period, duration, t0)
        if np.sum(stats["per_transit_count"] > 0) >= MIN_TRANSITS:
            sde = float((power[i] - mean) / std)
            return bls, pg, period, t0, duration, stats, sde
    return bls, pg, None, None, None, None, 0.0


def _refine(bls, period, duration):
    """Zoom in around a periodogram peak with a finer period and duration grid."""
    periods = np.linspace(period * (1 - 2e-3), period * (1 + 2e-3), 401)
    durations = np.arange(0.5, 8.01, 0.25) / 24
    durations = durations[durations < 0.4 * periods.min()]
    pg = bls.power(periods, durations, objective="likelihood")
    j = int(np.argmax(pg.power))
    return float(pg.period[j]), float(pg.transit_time[j]), float(pg.duration[j])


def _periodogram_summary(pg, n=1500):
    """Downsample the periodogram for plotting, keeping the peak in each bin."""
    periods, power = np.asarray(pg.period), np.asarray(pg.power)
    edges = np.linspace(0, len(periods), n + 1).astype(int)
    out_p, out_s = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        if b > a:
            j = a + int(np.argmax(power[a:b]))
            out_p.append(round(float(periods[j]), 5))
            out_s.append(round(float(power[j]), 3))
    return {"period": out_p, "power": out_s}


def _fold(t, f, period, t0, duration):
    """Fold the light curve on the candidate and return points near the transit, in hours."""
    phase = ((t - t0 + 0.5 * period) % period) - 0.5 * period
    half_window = min(3 * duration, 0.5 * period)
    near = np.abs(phase) < half_window
    ph, fl = phase[near] * 24, f[near]
    order = np.argsort(ph)
    ph, fl = ph[order], fl[order]

    edges = np.linspace(-half_window * 24, half_window * 24, 61)
    centers, binned = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        sel = (ph >= a) & (ph < b)
        if sel.sum() >= 3:
            centers.append(round(float((a + b) / 2), 4))
            binned.append(round(float(np.median(fl[sel])), 6))

    if len(ph) > 4000:
        keep = np.random.default_rng(0).choice(len(ph), 4000, replace=False)
        keep.sort()
        ph, fl = ph[keep], fl[keep]
    return {
        "hours": np.round(ph, 4).tolist(),
        "flux": np.round(fl, 6).tolist(),
        "bin_hours": centers,
        "bin_flux": binned,
        "window_hours": round(float(half_window * 24), 3),
    }


def _shape(depth, duration_h):
    """Approximate the four contact points of a transit (model, assumes a central crossing).

    A planet that covers fraction k of the star's radius takes about k/(1+k) of the
    transit to fully cross the star's edge (ingress), and the same to leave (egress).
    """
    k = float(np.sqrt(max(depth, 0)))
    ingress = duration_h * k / (1 + k)
    half = duration_h / 2
    return {
        "radius_ratio": round(k, 5),
        "ingress_hours": round(ingress, 4),
        "contacts_hours": [round(-half, 4), round(-half + ingress, 4),
                           round(half - ingress, 4), round(half, 4)],
    }


def _signal(bls, period, t0, duration, stats, sde, t, f, star):
    depth, depth_err = (float(x) for x in stats["depth"])
    odd, odd_err = (float(x) for x in stats["depth_odd"])
    even, even_err = (float(x) for x in stats["depth_even"])
    odd_even_sigma = abs(odd - even) / np.hypot(odd_err, even_err) if odd_err and even_err else None
    n_transits = int(np.sum(stats["per_transit_count"] > 0))
    radius_sun = star.get("radius_sun")
    k = np.sqrt(max(depth, 0))
    duration_h = float(duration * 24)
    return {
        "period_days": round(float(period), 5),
        "t0": round(float(t0), 5),
        "duration_hours": round(duration_h, 3),
        "depth_ppm": round(depth * 1e6, 1),
        "depth_err_ppm": round(depth_err * 1e6, 1),
        "snr": round(depth / depth_err, 1) if depth_err > 0 else None,
        "sde": round(sde, 1),
        "transits_observed": n_transits,
        "odd_even_sigma": round(float(odd_even_sigma), 2) if odd_even_sigma is not None else None,
        "planet_radius_earth": round(float(k * radius_sun * EARTH_RADII_PER_SUN), 2) if radius_sun else None,
        "transit_times": np.round(np.asarray(stats["transit_times"]), 5).tolist(),
        "shape": _shape(depth, duration_h),
        "fold": _fold(t, f, period, t0, duration),
    }


def _downsample(t, f, n=5000):
    if len(t) <= n:
        return t, f
    size = int(np.ceil(len(t) / n))
    usable = (len(t) // size) * size
    return t[:usable].reshape(-1, size).mean(1), f[:usable].reshape(-1, size).mean(1)


def search_transits(target: str, mission: str = "TESS", max_obs: int = 4) -> dict:
    if mission not in MISSIONS:
        raise ValueError(f"Mission must be one of: {', '.join(MISSIONS)}")
    if not 1 <= max_obs <= 12:
        raise ValueError("Use between 1 and 12 observations.")

    cached = _cache_path(f"{target}_search{SEARCH_CACHE_VERSION}_{max_obs}", mission)
    if cached.exists():
        return json.loads(cached.read_text())

    started = _time.time()
    raw, info = _download(target, mission, max_obs)
    star = info["star"]

    mask = np.zeros(len(raw), dtype=bool)
    flat = _flatten(raw, mission)
    signals, periodogram = [], None

    for _ in range(MAX_SIGNALS):
        keep = np.ones(len(flat), dtype=bool)
        for s in signals:  # hide transits we've already found
            keep &= ~BoxLeastSquares(flat.time.value, flat.flux.value).transit_mask(
                flat.time.value, s["period_days"], 1.5 * s["duration_hours"] / 24, s["t0"])
        t = flat.time.value[keep]
        f = np.asarray(flat.flux.value[keep], dtype=float)
        e = np.asarray(flat.flux_err.value[keep], dtype=float)
        baseline = t.max() - t.min()
        max_period = min(MAX_PERIOD_CAP, baseline / 2)  # need at least two transits
        if max_period <= MIN_PERIOD:
            break

        bls, pg, period, t0, duration, stats, sde = _bls_once(t, f, e, max_period)
        if periodogram is None:
            periodogram = _periodogram_summary(pg)
        if period is None or sde < MIN_SDE:
            break

        # Re-flatten with this signal's transits masked so the detrend doesn't
        # shave the dips, then measure it properly.
        mask |= BoxLeastSquares(raw.time.value, raw.flux.value).transit_mask(
            raw.time.value, period, 1.5 * duration, t0)
        flat = _flatten(raw, mission, mask=mask)
        tt, ff = flat.time.value, np.asarray(flat.flux.value, dtype=float)
        ee = np.asarray(flat.flux_err.value, dtype=float)
        bls = BoxLeastSquares(tt, ff, dy=ee)
        stats = bls.compute_stats(period, duration, t0)
        sig = _signal(bls, period, t0, duration, stats, sde, tt, ff, star)

        if sig["snr"] is None or sig["snr"] < MIN_SNR or sig["depth_ppm"] <= 0:
            break
        signals.append(sig)

    known = known_planets(target, mission, star)
    for s in signals:
        s["match"] = match_known(s["period_days"], known)

    t_plot, f_plot = _downsample(flat.time.value, np.asarray(flat.flux.value, dtype=float))
    data = {
        "target": target,
        "mission": mission,
        **info,
        "time_format": "BTJD" if mission == "TESS" else "BKJD",
        "baseline_days": round(float(raw.time.value.max() - raw.time.value.min()), 2),
        "signals": signals,
        "known_planets": known,
        "periodogram": periodogram,
        "flattened": {"time": np.round(t_plot, 5).tolist(), "flux": np.round(f_plot, 6).tolist()},
        "search_seconds": round(_time.time() - started, 1),
    }
    cached.write_text(json.dumps(data))
    return data
