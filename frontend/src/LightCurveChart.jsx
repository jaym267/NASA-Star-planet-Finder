import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

export default function LightCurveChart({ data }) {
  return (
    <Plot
      data={[
        {
          x: data.time,
          y: data.flux,
          type: "scattergl",
          mode: "markers",
          marker: { size: 3, color: "#f2a541" },
          hovertemplate: "Time %{x:.3f}<br>Brightness %{y:.5f}<extra></extra>",
        },
      ]}
      layout={{
        autosize: true,
        height: 420,
        margin: { l: 70, r: 20, t: 10, b: 50 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "Instrument Sans, sans-serif", color: "#e9e4d6" },
        xaxis: { title: { text: `Time (${data.time_format})` }, gridcolor: "#1a2a42", zeroline: false },
        yaxis: { title: { text: "Relative brightness" }, gridcolor: "#1a2a42", zeroline: false },
      }}
      config={{ displaylogo: false, responsive: true }}
      useResizeHandler
      style={{ width: "100%" }}
    />
  );
}
