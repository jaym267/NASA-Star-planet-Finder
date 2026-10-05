import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { baseLayout, DIM, PLOT_CONFIG, SIGNAL_COLORS } from "./charts";

const Plot = createPlotlyComponent(Plotly);

/** How strongly each tested orbital period matched a repeating dip. Peaks are candidates. */
export default function PeriodogramChart({ periodogram, signals }) {
  const layout = baseLayout({ xTitle: "Orbital period tested (days)", yTitle: "Signal strength", height: 300 });
  layout.xaxis.type = "log";
  layout.margin = { ...layout.margin, t: 24 };
  layout.annotations = signals.map((s, i) => ({
    x: Math.log10(s.period_days), yref: "paper", y: 1, yanchor: "bottom", showarrow: false,
    text: `#${i + 1}`, font: { color: DIM, size: 12 },
  }));
  layout.shapes = signals.map((s, i) => ({
    type: "line", x0: s.period_days, x1: s.period_days, yref: "paper", y0: 0, y1: 1,
    line: { color: SIGNAL_COLORS[i], width: 2, dash: "dot" },
  }));

  return (
    <Plot
      data={[
        {
          x: periodogram.period, y: periodogram.power, type: "scatter", mode: "lines",
          line: { color: DIM, width: 1.5 },
          hovertemplate: "Period %{x:.3f} d<br>Strength %{y:.1f}<extra></extra>",
        },
      ]}
      layout={layout}
      config={PLOT_CONFIG}
      useResizeHandler
      style={{ width: "100%" }}
    />
  );
}
