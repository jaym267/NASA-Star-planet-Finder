// Shared chart styling. Signal colors are a fixed categorical order (validated for
// colorblind separation on the dark background): candidate 1 is always amber, 2 teal, 3 violet.
export const SIGNAL_COLORS = ["#cc7f1e", "#2fa89c", "#9077e0"];

export const INK = "#0f1b2d";
export const PAPER = "#e9e4d6";
export const DIM = "#8a9bb3";
export const GRID = "#1a2a42";

export function baseLayout({ xTitle, yTitle, height = 360 }) {
  return {
    autosize: true,
    height,
    margin: { l: 70, r: 20, t: 10, b: 50 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Instrument Sans, sans-serif", color: PAPER },
    hoverlabel: { bgcolor: GRID, bordercolor: DIM, font: { color: PAPER } },
    xaxis: { title: { text: xTitle }, gridcolor: GRID, zeroline: false },
    yaxis: { title: { text: yTitle }, gridcolor: GRID, zeroline: false },
    showlegend: false,
  };
}

export const PLOT_CONFIG = { displaylogo: false, responsive: true };

/**
 * Transit model with a flat bottom and straight-line ingress/egress, in hours from
 * mid-transit. The model is symmetric, so only the egress contacts (3 and 4) are needed.
 */
export function trapezoid(hours, contacts, depth) {
  const [, , t3, t4] = contacts;
  const h = Math.abs(hours);
  if (h >= t4) return 1;
  if (h <= t3) return 1 - depth;
  return 1 - (depth * (t4 - h)) / (t4 - t3 || 1);
}

export function linspace(a, b, n) {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}
