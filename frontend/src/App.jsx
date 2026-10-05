import { useEffect, useState } from "react";
import { fetchLightCurve, searchTransits } from "./api";
import CompareDashboard from "./CompareDashboard";
import LightCurveChart from "./LightCurveChart";
import SearchResults from "./SearchResults";

const EXAMPLES = ["TOI-700", "Pi Mensae", "Kepler-10"];

export default function App() {
  const [target, setTarget] = useState("");
  const [mission, setMission] = useState("TESS");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [observations, setObservations] = useState(4);
  const [search, setSearch] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState("find");

  useEffect(() => {
    if (!searching) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [searching]);

  async function runSearch() {
    setSearching(true);
    setElapsed(0);
    setSearchError("");
    setSearch(null);
    try {
      setSearch(await searchTransits(data.target, data.mission, observations));
    } catch (e) {
      setSearchError(e.message);
    } finally {
      setSearching(false);
    }
  }

  async function load(name = target, m = mission) {
    if (!name.trim()) {
      setError("Enter a star name or ID first.");
      return;
    }
    setLoading(true);
    setError("");
    setSearch(null);
    setSearchError("");
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
      <nav className="mt-6 flex gap-1 border-b border-ink-light" role="tablist">
        {[["find", "Find"], ["compare", "Compare"]].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`-mb-px border-b-2 px-4 py-2 ${view === key ? "border-star text-paper" : "border-transparent text-dim hover:text-paper"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "compare" && (
        <>
          <p className="mt-6 max-w-2xl text-dim">
            See how your candidates measure up against every planet astronomers have confirmed, and look for patterns worth testing.
          </p>
          <CompareDashboard search={search} />
        </>
      )}

      {view === "find" && (
        <>
          <p className="mt-6 max-w-2xl text-dim">
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

          {data && (
            <section className="mt-12 border-t border-ink-light pt-10">
              <h2 className="text-2xl font-semibold tracking-tight">Search for planets</h2>
              <p className="mt-2 max-w-2xl text-dim">
                Combine several {data.mission === "TESS" ? "sectors" : "quarters"} of data, then test thousands of possible orbits
                for a dip that repeats on schedule. This uses the Box Least Squares method. More data finds smaller planets and
                longer orbits, but takes longer.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <label className="text-sm text-dim" htmlFor="observations">
                  {data.mission === "TESS" ? "Sectors" : "Quarters"} to search
                </label>
                <select
                  id="observations"
                  value={observations}
                  onChange={(e) => setObservations(Number(e.target.value))}
                  className="rounded-md border border-ink-light bg-ink-light px-3 py-2"
                >
                  {[2, 4, 6, 8].map((n) => (
                    <option key={n} value={n} disabled={n > data.available_observations}>{n}</option>
                  ))}
                </select>
                <button
                  onClick={runSearch}
                  disabled={searching}
                  className="rounded-md bg-star px-5 py-2 font-medium text-ink disabled:opacity-60"
                >
                  {searching ? `Searching… ${elapsed}s` : "Find transits"}
                </button>
              </div>
              {searching && (
                <p className="mt-3 text-sm text-dim">
                  Downloading from NASA and testing orbits. The first search of a star usually takes 1 to 3 minutes. After that it's cached.
                </p>
              )}
              {searchError && <p className="mt-4 text-danger">{searchError}</p>}
              {search && <SearchResults key={`${search.target}-${search.observations_used.length}`} data={search} />}
              {search?.signals.length > 0 && (
                <p className="mt-8 text-sm">
                  <button className="underline underline-offset-4 hover:text-star" onClick={() => { setView("compare"); window.scrollTo(0, 0); }}>
                    Compare {search.signals.length > 1 ? "these candidates" : "this candidate"} with every known planet →
                  </button>
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
