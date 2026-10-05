import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { baseLayout, DIM, linspace, PAPER, PLOT_CONFIG, trapezoid } from "./charts";

const Plot = createPlotlyComponent(Plotly);

/** Every transit stacked on top of each other, so a dip buried in noise becomes visible. */
export default function FoldedChart({ signal, color }) {
  const { fold, shape, depth_ppm } = signal;
  const depth = depth_ppm / 1e6;
  const modelX = linspace(-fold.window_hours, fold.window_hours, 400);
  const modelY = modelX.map((h) => trapezoid(h, shape.contacts_hours, depth));

  const layout = baseLayout({ xTitle: "Hours from middle of transit", yTitle: "Relative brightness" });
  layout.shapes = shape.contacts_hours.map((x) => ({
    type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1,
    line: { color: DIM, width: 1, dash: "dot" },
  }));
  layout.annotations = shape.contacts_hours.map((x, i) => ({
    x, yref: "paper", y: 1, yanchor: "bottom", text: String(i + 1), showarrow: false,
    font: { color: DIM, size: 12 },
  }));
  layout.margin = { ...layout.margin, t: 24 };

  return (
    <Plot
      data={[
        {
          x: fold.hours, y: fold.flux, type: "scattergl", mode: "markers",
          marker: { size: 3, color: PAPER, opacity: 0.18 },
          hoverinfo: "skip", name: "Individual measurements",
        },
        {
          x: fold.bin_hours, y: fold.bin_flux, type: "scatter", mode: "markers",
          marker: { size: 8, color, line: { color: "#0f1b2d", width: 2 } },
          name: "Average",
          hovertemplate: "%{x:.2f} h<br>Brightness %{y:.5f}<extra>Average</extra>",
        },
        {
          x: modelX, y: modelY, type: "scatter", mode: "lines",
          line: { color: PAPER, width: 2 }, name: "Model", hoverinfo: "skip",
        },
      ]}
      layout={layout}
      config={PLOT_CONFIG}
      useResizeHandler
      style={{ width: "100%" }}
    />
  );
}
