import { useEffect, useState } from "react";
import { fetchModelInfo } from "./api";

const VERDICTS = {
  "likely planet": { icon: "✓", text: "Likely a planet" },
  uncertain: { icon: "?", text: "Uncertain" },
  "likely false positive": { icon: "✗", text: "Likely a false positive" },
};

let modelInfoPromise = null; // fetched once per page load

/** The classifier's verdict on one signal: planet, or an impostor like an eclipsing binary. */
export default function VettingPanel({ vetting, signal }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    modelInfoPromise ??= fetchModelInfo().catch(() => null);
    modelInfoPromise.then(setInfo);
  }, []);

  if (!vetting) {
    return <p className="text-sm text-dim">The vetting model isn't trained yet. Run notebooks/vetting_model.ipynb.</p>;
  }

  const pct = Math.round(vetting.planet_probability * 100);
  const verdict = VERDICTS[vetting.verdict];
  const ratio = vetting.features.duration_ratio;

  return (
    <div className="rounded-lg border border-ink-light p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-medium">
          <span aria-hidden="true">{verdict.icon}</span> {verdict.text}
        </p>
        <p className="tabular-nums">
          <span className="text-2xl font-semibold">{pct}%</span>{" "}
          <span className="text-sm text-dim">planet probability</span>
        </p>
      </div>
      <div className="mt-3 h-2 rounded-full bg-ink-light" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label="Planet probability">
        <div className="h-2 rounded-full bg-star" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-dim">
        <span>False positive</span>
        <span>Planet</span>
      </div>

      <ul className="mt-4 space-y-1 text-sm text-dim">
        {signal.planet_radius_earth != null && signal.planet_radius_earth > 22 && (
          <li>At {signal.planet_radius_earth} × Earth, this would be bigger than any known planet. It's more likely a small star.</li>
        )}
        {ratio != null && (
          <li>
            The transit lasts {ratio.toFixed(2)} × as long as a planet crossing the middle of this star would.{" "}
            {ratio > 1.5
              ? "That's long for a planet. Two stars eclipsing, or a blended background star, can do this."
              : ratio < 0.5
                ? "Short transits happen when a planet only grazes the edge of its star."
                : "That fits a planet."}
          </li>
        )}
        {vetting.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>

      {info && (
        <p className="mt-4 text-xs text-dim">
          A random forest trained on {info.n_train.toLocaleString()} Kepler signals that astronomers already settled
          ({info.n_planets.toLocaleString()} confirmed planets, {info.n_false_positives.toLocaleString()} false positives).
          Tested on stars it hadn't seen, it was right {Math.round(info.metrics.accuracy * 100)}% of the time
          (always guessing "false positive" would be right {Math.round(info.metrics.baseline_accuracy * 100)}%). This is a
          screening score, not a confirmation. Real planets need follow-up observations.
        </p>
      )}
    </div>
  );
}
