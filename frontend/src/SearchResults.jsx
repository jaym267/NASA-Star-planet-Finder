import { useState } from "react";
import { SIGNAL_COLORS } from "./charts";
import FlattenedChart from "./FlattenedChart";
import FoldedChart from "./FoldedChart";
import PeriodogramChart from "./PeriodogramChart";
import TransitAnimation from "./TransitAnimation";
import VettingPanel from "./VettingPanel";

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-md bg-ink-light px-3 py-2">
      <div className="text-xs text-dim">{label}</div>
      <div className="text-lg font-medium tabular-nums">{value}</div>
      {hint && <div className="text-xs text-dim">{hint}</div>}
    </div>
  );
}

function MatchNote({ signal }) {
  const m = signal.match;
  if (!m) {
    return (
      <p className="text-sm">
        <span className="font-medium">No known planet at this period.</span>{" "}
        <span className="text-dim">It could be new, or a false alarm. Check the vetting score below.</span>
      </p>
    );
  }
  const relation = m.relation === "exact" ? "" : ` (found at ${m.relation} its period)`;
  return (
    <p className="text-sm">
      <span className="font-medium">✓ Rediscovered {m.name}</span>
      <span className="text-dim">: known period {m.period_days.toFixed(4)} days{relation}.</span>
    </p>
  );
}

function Candidate({ signal, index }) {
  const color = SIGNAL_COLORS[index];
  const oddEvenWarn = signal.odd_even_sigma != null && signal.odd_even_sigma > 3;
  return (
    <div className="space-y-5">
      <MatchNote signal={signal} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Orbit (period)" value={`${signal.period_days.toFixed(4)} d`} />
        <Stat label="Dip depth" value={`${signal.depth_ppm.toLocaleString()} ppm`} hint={`${(signal.depth_ppm / 1e4).toFixed(3)}% dimmer`} />
        <Stat label="Transit duration" value={`${signal.duration_hours.toFixed(2)} h`} />
        <Stat
          label="Estimated size"
          value={signal.planet_radius_earth ? `${signal.planet_radius_earth} × Earth` : "n/a"}
          hint={signal.planet_radius_earth ? "from depth and star size" : "star size unknown"}
        />
        <Stat label="Signal-to-noise" value={signal.snr} hint="7.1+ counts as a detection" />
        <Stat label="Transits seen" value={signal.transits_observed} />
        <Stat
          label="Odd vs even transits"
          value={signal.odd_even_sigma != null ? `${signal.odd_even_sigma}σ apart` : "n/a"}
          hint={oddEvenWarn ? "Worth a closer look: two eclipsing stars can alternate depths" : "Consistent, as a planet's should be"}
        />
        <Stat label="Peak strength (SDE)" value={signal.sde} />
      </div>

      <div>
        <h4 className="font-medium">Planet or impostor?</h4>
        <p className="text-sm text-dim">
          Most planet-like dips turn out to be something else, usually two stars eclipsing each other. A model trained on Kepler's verdicts scores this one.
        </p>
        <div className="mt-2">
          <VettingPanel vetting={signal.vetting} signal={signal} />
        </div>
      </div>

      <div>
        <h4 className="font-medium">Folded transit</h4>
        <p className="text-sm text-dim">
          Every transit stacked on top of one another. Colored dots are averages. The white line is the model, and the dotted lines mark the four contact points.
        </p>
        <FoldedChart signal={signal} color={color} />
      </div>

      <div>
        <h4 className="font-medium">What's happening during the dip</h4>
        <TransitAnimation key={`${signal.period_days}`} signal={signal} color={color} />
      </div>
    </div>
  );
}

export default function SearchResults({ data }) {
  const [selected, setSelected] = useState(0);
  const { signals, known_planets: known } = data;
  const sig = signals[Math.min(selected, signals.length - 1)];

  return (
    <div className="mt-6 space-y-8">
      <p className="text-sm text-dim">
        Searched {data.observations_used.join(", ")} ({data.baseline_days} days of data, {data.available_observations} observations
        available) in {data.search_seconds} s.
      </p>

      {signals.length === 0 ? (
        <p>
          No repeating dips strong enough to count. Small planets often need more data, so try searching more sectors.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist">
            {signals.map((s, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === selected}
                onClick={() => setSelected(i)}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                  i === selected ? "border-dim bg-ink-light" : "border-ink-light hover:border-dim"
                }`}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SIGNAL_COLORS[i] }} />
                Candidate {i + 1}: {s.period_days.toFixed(2)} d
                {s.match && <span className="text-dim">({s.match.name})</span>}
              </button>
            ))}
          </div>
          <Candidate signal={sig} index={signals.indexOf(sig)} />
        </>
      )}

      {known.length > 0 && (
        <div className="text-sm">
          <h4 className="font-medium">Already known around this star</h4>
          <ul className="mt-1 text-dim">
            {known.map((p) => {
              const found = signals.some((s) => s.match?.name === p.name);
              return (
                <li key={p.name}>
                  {found ? "✓" : "·"} {p.name}: {Number(p.period_days).toFixed(3)} d
                  {p.radius_earth ? `, ${Number(p.radius_earth).toFixed(2)} × Earth` : ""}
                  {p.status !== "confirmed" ? ` (${p.status})` : ""}
                  {!found && Number(p.period_days) > data.baseline_days / 2 ? " (orbit too long for this much data)" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.periodogram && (
        <div>
          <h4 className="font-medium">Period search</h4>
          <p className="text-sm text-dim">How well each possible orbit matched a repeating dip. Tall peaks are candidates.</p>
          <PeriodogramChart periodogram={data.periodogram} signals={signals} />
        </div>
      )}

      <div>
        <h4 className="font-medium">Cleaned light curve</h4>
        <p className="text-sm text-dim">Slow brightness drifts removed. Ticks along the bottom mark each predicted transit.</p>
        <FlattenedChart data={data} />
      </div>
    </div>
  );
}
