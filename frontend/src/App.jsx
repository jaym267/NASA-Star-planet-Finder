import { useState } from "react";
import { fetchLightCurve } from "./api";
import LightCurveChart from "./LightCurveChart";

const EXAMPLES = ["TOI-700", "Pi Mensae", "Kepler-10"];

export default function App() {
  const [target, setTarget] = useState("");
  const [mission, setMission] = useState("TESS");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(name = target, m = mission) {
    if (!name.trim()) {
      setError("Enter a star name or ID first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setData(await fetchLightCurve(name.trim(), m));
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">Star Planet Finder</h1>
      <p className="mt-3 max-w-2xl text-dim">
        Look up a star and see how its brightness changed over time. Small, repeating dips can mean a planet is passing in front of it.
      </p>

      <form
        className="mt-8 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setError("");
          }}
          placeholder="TOI-700"
          aria-label="Star name or ID"
          className="min-w-64 flex-1 rounded-md border border-ink-light bg-ink-light px-4 py-2 outline-none focus:border-star"
        />
        <select
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          aria-label="Mission"
          className="rounded-md border border-ink-light bg-ink-light px-3 py-2 focus:border-star"
        >
          <option>TESS</option>
          <option>Kepler</option>
          <option>K2</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-star px-5 py-2 font-medium text-ink disabled:opacity-60"
        >
          {loading ? "Loading…" : "Show light curve"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm text-dim">
        Try:
        {EXAMPLES.map((name) => (
          <button
            key={name}
            className="underline decoration-dim/40 underline-offset-4 hover:text-paper"
            onClick={() => {
              const m = name.startsWith("Kepler") ? "Kepler" : "TESS";
              setTarget(name);
              setMission(m);
              load(name, m);
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {error && <p className="mt-6 text-danger">{error}</p>}

      {data && (
        <section className="mt-10">
          <p className="text-sm text-dim">
            {data.target}, {data.observation}, {data.points.toLocaleString()} points ({data.available_observations} observations available)
          </p>
          <LightCurveChart data={data} />
          <p className="text-sm text-dim">Drag on the chart to zoom in. Double-click to reset.</p>
        </section>
      )}
    </main>
  );
}
