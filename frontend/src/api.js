async function getJson(path, params) {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // FastAPI validation errors come back as a list of problems
    const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
    throw new Error(detail || "Something went wrong.");
  }
  return body;
}

export function fetchLightCurve(target, mission) {
  return getJson("/api/lightcurve", { target, mission });
}

export function searchTransits(target, mission, observations) {
  return getJson("/api/search", { target, mission, observations });
}

export function fetchModelInfo() {
  return getJson("/api/model", {});
}

export function fetchPlanets() {
  return getJson("/api/planets", {});
}
