import { useEffect, useId, useRef, useState } from "react";
import { DIM, GRID, linspace, PAPER, trapezoid } from "./charts";

const MOMENTS = [
  { label: "Edge touches", detail: "The planet's leading edge reaches the star. Dimming begins." },
  { label: "Fully on", detail: "The whole planet is in front of the star. Dimming is at its deepest." },
  { label: "Starts leaving", detail: "The leading edge reaches the far side. Brightness starts to recover." },
  { label: "Fully off", detail: "The planet has cleared the star. Brightness is back to normal." },
];

const LOOP_SECONDS = 7;

/**
 * A planet crossing its star, synced to the brightness it would cause.
 * Rebuilt from the measurements: transit depth sets the planet's size, duration sets its speed.
 */
export default function TransitAnimation({ signal, color }) {
  const { shape, depth_ppm, duration_hours, fold } = signal;
  const window = fold.window_hours;
  const [t, setT] = useState(-window);
  const [playing, setPlaying] = useState(true);
  const gradientId = useId();
  const last = useRef(null);

  useEffect(() => {
    if (!playing) return;
    let frame;
    const tick = (now) => {
      if (last.current != null) {
        const dt = ((now - last.current) / 1000) * ((2 * window) / LOOP_SECONDS);
        setT((prev) => (prev + dt > window ? -window : prev + dt));
      }
      last.current = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, window]);

  // Star scene
  const W = 520, H = 230, cx = W / 2, cy = H / 2, R = 92;
  const k = shape.radius_ratio;
  const r = Math.max(k * R, 2); // keep tiny planets visible
  const half = duration_hours / 2;
  const px = cx + (t / half) * (R + k * R);

  // Model light curve under the scene
  const CW = 520, CH = 130, pad = 16;
  const depth = depth_ppm / 1e6;
  const xs = linspace(-window, window, 300);
  const toX = (h) => pad + ((h + window) / (2 * window)) * (CW - 2 * pad);
  const toY = (f) => pad + ((1 - f) / depth) * (CH - 2 * pad - 14);
  const path = xs.map((h, i) => `${i ? "L" : "M"}${toX(h).toFixed(1)},${toY(trapezoid(h, shape.contacts_hours, depth)).toFixed(1)}`).join(" ");
  const flux = trapezoid(t, shape.contacts_hours, depth);

  const [c1, c2, c3, c4] = shape.contacts_hours;
  const active = t < c1 || t > c4 ? -1 : t < c2 ? 0 : t < c3 ? 1 : t < c4 ? 2 : 3;
  const nearest = shape.contacts_hours.reduce((best, c, i) => (Math.abs(t - c) < Math.abs(t - shape.contacts_hours[best]) ? i : best), 0);
  const status =
    active === -1 ? "Out of transit: nothing is blocking the star."
    : active === 0 ? "Ingress: the planet is sliding onto the star."
    : active === 1 ? "Fully in front: the flat bottom of the dip."
    : "Egress: the planet is sliding off the star.";

  return (
    <div className="rounded-lg border border-ink-light p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Model of a planet ${(k * 100).toFixed(1)}% the width of its star crossing it`}>
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor="#fff4d8" />
            <stop offset="70%" stopColor="#f6c56f" />
            <stop offset="100%" stopColor="#c8742a" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={R} fill={`url(#${gradientId})`} />
        <circle cx={px} cy={cy} r={r} fill="#08111e" stroke={DIM} strokeWidth={Math.abs(px - cx) > R + r ? 1 : 0} />
        {r < 8 && (
          // Small planets are drawn to scale, so ring them to show where they are
          <circle cx={px} cy={cy} r={14} fill="none" stroke={PAPER} strokeWidth="1.5" strokeDasharray="3 3" />
        )}
        <text x={W - 8} y={H - 8} textAnchor="end" fill={DIM} fontSize="11">Planet and star drawn to scale</text>
      </svg>

      <svg viewBox={`0 0 ${CW} ${CH}`} className="mt-2 w-full" aria-hidden="true">
        <line x1={pad} x2={CW - pad} y1={toY(1)} y2={toY(1)} stroke={GRID} />
        {shape.contacts_hours.map((c, i) => (
          <g key={i}>
            <line x1={toX(c)} x2={toX(c)} y1={pad - 4} y2={CH - pad} stroke={i === nearest && active !== -1 ? PAPER : DIM}
              strokeDasharray="2 3" />
            {/* 1 and 3 sit left of their line, 2 and 4 right, so close contacts don't overlap */}
            <text x={toX(c) + (i % 2 ? 4 : -4)} y={CH - 2} textAnchor={i % 2 ? "start" : "end"} fill={DIM} fontSize="11">{i + 1}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
        <circle cx={toX(t)} cy={toY(flux)} r="5" fill={PAPER} stroke="#0f1b2d" strokeWidth="2" />
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => setPlaying((p) => !p)}
          className="rounded-md border border-ink-light px-3 py-1 text-sm hover:border-dim">
          {playing ? "Pause" : "Play"}
        </button>
        <input type="range" min={-window} max={window} step={window / 200} value={t}
          aria-label="Time from middle of transit"
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
          className="flex-1 accent-star" />
        <span className="w-20 text-right text-sm tabular-nums text-dim">{t >= 0 ? "+" : ""}{t.toFixed(1)} h</span>
      </div>
      <p className="mt-2 text-sm">{status}</p>

      <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {MOMENTS.map((m, i) => (
          <li key={m.label} className={`rounded-md border px-3 py-2 ${i === nearest && active !== -1 ? "border-dim" : "border-ink-light"}`}>
            <span className="font-medium">{i + 1}. {m.label}</span>{" "}
            <span className="text-dim">({shape.contacts_hours[i] >= 0 ? "+" : ""}{shape.contacts_hours[i].toFixed(2)} h)</span>
            <span className="block text-dim">{m.detail}</span>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs text-dim">
        This is a model rebuilt from the data, not a picture of the planet. The planet's size comes from the dip's depth
        ({depth_ppm.toLocaleString()} ppm means it covers {(k * 100).toFixed(1)}% of the star's width), and its speed from the
        transit's {duration_hours.toFixed(1)}-hour duration. It assumes the planet crosses the middle of the star. The curve's
        dip is stretched vertically so you can see it. Planets make flat-bottomed dips with short ingress and egress. Two stars
        eclipsing each other usually make a V shape.
      </p>
    </div>
  );
}
