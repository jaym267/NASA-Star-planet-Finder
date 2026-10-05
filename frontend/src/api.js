async function errorFrom(res) {
  const body = await res.json().catch(() => ({}));
  // FastAPI validation errors come back as a list of problems
  const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
  return new Error(detail || "Something went wrong.");
}

async function getJson(path, params) {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
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

export function fetchAssistantStatus() {
  return getJson("/api/assistant", {});
}

// --- Notebooks -------------------------------------------------------------------
// The browser makes up an ID and remembers it. This keeps each person's notebooks
// separate on a shared computer's browser profile, but it is not a login.

function userId() {
  const KEY = "spf-user-id";
  let id = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
  } catch {
    id ??= crypto.randomUUID(); // storage blocked: notebooks last for this page load only
  }
  return id;
}

const USER_ID = userId();

async function notebookRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "X-User-Id": USER_ID, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export const listNotebooks = () => notebookRequest("/api/notebooks");
export const getNotebook = (id) => notebookRequest(`/api/notebooks/${id}`);
export const createNotebook = (title, context) => notebookRequest("/api/notebooks", { method: "POST", body: { title, context } });
export const updateNotebook = (id, changes) => notebookRequest(`/api/notebooks/${id}`, { method: "PATCH", body: changes });
export const deleteNotebook = (id) => notebookRequest(`/api/notebooks/${id}`, { method: "DELETE" });

/** Send a message to the assistant and call onEvent for each streamed event (text, tool, error, done). */
export async function streamChat(id, message, onEvent) {
  const res = await fetch(`/api/notebooks/${id}/chat`, {
    method: "POST",
    headers: { "X-User-Id": USER_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw await errorFrom(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop(); // keep a partial event for the next chunk
    for (const raw of events) {
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}
