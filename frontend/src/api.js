export async function fetchLightCurve(target, mission) {
  const params = new URLSearchParams({ target, mission });
  const res = await fetch(`/api/lightcurve?${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || "Something went wrong.");
  return body;
}
