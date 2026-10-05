import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { baseLayout, PAPER, PLOT_CONFIG, SIGNAL_COLORS } from "./charts";

const Plot = createPlotlyComponent(Plotly);

/** The cleaned light curve, with a tick under every predicted transit of each candidate. */
export default function FlattenedChart({ data }) {
  const { flattened, signals, time_format } = data;
  const layout = baseLayout({ xTitle: `Time (${time_format})`, yTitle: "Relative brightness", height: 340 });
  const t0 = flattened.time[0];
  const t1 = flattened.time[flattened.time.length - 1];

  layout.shapes = signals.flatMap((s, i) =>
    s.transit_times
      .filter((t) => t >= t0 && t <= t1)
      .map((t) => ({
        type: "line", x0: t, x1: t, yref: "paper", y0: 0, y1: 0.06,
        line: { color: SIGNAL_COLORS[i], width: 2 },
      }))
  );

  return (
    <Plot
      data={[
        {
          x: flattened.time, y: flattened.flux, type: "scattergl", mode: "markers",
          marker: { size: 3, color: PAPER, opacity: 0.5 },
          hovertemplate: "Time %{x:.3f}<br>Brightness %{y:.5f}<extra></extra>",
        },
      ]}
      layout={layout}
      config={PLOT_CONFIG}
      useResizeHandler
      style={{ width: "100%" }}
    />
  );
}
