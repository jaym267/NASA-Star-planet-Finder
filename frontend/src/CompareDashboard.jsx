import { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { fetchPlanets } from "./api";
import { baseLayout, DIM, PAPER, PLOT_CONFIG, SIGNAL_COLORS } from "./charts";

const Plot = createPlotlyComponent(Plotly);

// Reference points everyone knows. Values from NASA's planetary fact sheets.
const SOLAR_SYSTEM = [
  { name: "Venus", period: 224.7, radius: 0.95, mass: 0.815, insol: 1.91 },
  { name: "Earth", period: 365.25, radius: 1, mass: 1, insol: 1 },
  { name: "Mars", period: 687, radius: 0.53, mass: 0.107, insol: 0.43 },
  { name: "Neptune", period: 60190, radius: 3.88, mass: 17.1, insol: 0.0011 },
  { name: "Jupiter", period: 4333, radius: 11.2, mass: 317.8, insol: 0.037 },
];
const SUN_TEFF = 5772;

const FILTERS = {
  all: { label: "All stars", test: () => true },
  red: { label: "Red dwarfs (cooler than 4,000 K)", test: (t) => t != null && t < 4000 },
  sunlike: { label: "Sun-like (5,300 to 6,000 K)", test: (t) => t != null && t >= 5300 && t <= 6000 },
};

function knownTrace(x, y, names, extraHover = "") {
  return {
    x, y, text: names, name: "Known planets", type: "scattergl", mode: "markers",
    marker: { size: 5, color: DIM, opacity: 0.45 },
    hovertemplate: `<b>%{text}</b><br>${extraHover}<extra></extra>`,
  };
}

function solarTrace(xKey, yKey, yFn) {
  return {
    x: SOLAR_SYSTEM.map((p) => p[xKey]),
    y: SOLAR_SYSTEM.map((p) => (yFn ? yFn(p) : p[yKey])),
    text: SOLAR_SYSTEM.map((p) => p.name),
    name: "Solar System", type: "scatter", mode: "markers+text", textposition: "top center",
    textfont: { color: PAPER, size: 11 },
    marker: { size: 9, color: PAPER, symbol: "circle-open", line: { width: 2 } },
    hovertemplate: "<b>%{text}</b><extra></extra>",
  };
}

function candidateTraces(candidates, xFn, yFn) {
  return candidates
    .filter((c) => xFn(c) != null && yFn(c) != null)
    .map((c) => ({
      x: [xFn(c)], y: [yFn(c)], name: c.label, text: [c.label],
      type: "scatter", mode: "markers+text", textposition: "middle right", textfont: { color: PAPER, size: 12 },
      marker: { size: 14, color: c.color, symbol: "star", line: { color: "#0f1b2d", width: 2 } },
      hovertemplate: `<b>${c.label}</b><extra></extra>`,
    }));
}

function legendLayout(layout) {
  layout.showlegend = true;
  layout.legend = { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12 } };
  layout.margin = { ...layout.margin, t: 40 };
  return layout;
}

function Chart({ title, children, data, layout }) {
  return (
    <section className="mt-10">
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-1 max-w-3xl text-sm text-dim">{children}</p>
      <Plot data={data} layout={layout} config={PLOT_CONFIG} useResizeHandler style={{ width: "100%" }} />
    </section>
  );
}

export default function CompareDashboard({ search }) {
  const [planets, setPlanets] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchPlanets().then(setPlanets).catch((e) => setError(e.message));
  }, []);

  const candidates = useMemo(
    () =>
      (search?.signals ?? []).map((s, i) => ({
        label: `Candidate ${i + 1}`,
        color: SIGNAL_COLORS[i],
        period: s.period_days,
        radius: s.planet_radius_earth,
        insol: s.derived?.insolation_earth,
        teff: search.star?.teff,
        hz: s.derived?.habitable_zone,
        eqt: s.derived?.equilibrium_temp_k,
        match: s.match?.name,
      })),
    [search]
  );

  const rows = useMemo(() => {
    if (!planets) return null;
    const c = planets.columns;
    const test = FILTERS[filter].test;
    return c.pl_name
      .map((name, i) => ({
        name, period: c.pl_orbper[i], radius: c.pl_rade[i], mass: c.pl_bmasse[i],
        insol: c.pl_insol[i], teff: c.st_teff[i], method: c.discoverymethod[i],
        // The archive estimates missing radii and masses from a formula; only keep measured ones
        radiusMeasured: c.tran_flag[i] === 1,
        massMeasured: c.pl_bmassprov[i] != null && c.pl_bmassprov[i] !== "M-R relationship",
      }))
      .filter((p) => test(p.teff));
  }, [planets, filter]);

  if (error) return <p className="mt-8 text-danger">{error}</p>;
  if (!rows) return <p className="mt-8 text-dim">Loading every known exoplanet from NASA…</p>;

  const pick = (keys) => rows.filter((p) => keys.every((k) => p[k] != null && p[k] > 0));

  // 1. Size vs orbit
  const rp = pick(["period", "radius"]).filter((p) => p.radiusMeasured);
  const sizeOrbit = legendLayout(baseLayout({ xTitle: "Orbital period (days, log scale)", yTitle: "Radius (× Earth, log scale)", height: 460 }));
  sizeOrbit.xaxis.type = "log";
  sizeOrbit.yaxis.type = "log";
  sizeOrbit.shapes = [{
    type: "rect", xref: "paper", x0: 0, x1: 1, y0: 1.5, y1: 2, fillcolor: PAPER, opacity: 0.06, line: { width: 0 },
  }];
  sizeOrbit.annotations = [{
    xref: "paper", x: 1, y: Math.log10(1.75), xanchor: "right", text: "radius valley", showarrow: false,
    font: { color: DIM, size: 11 },
  }];

  // 2. Size histogram, binned evenly in log(radius) so the valley isn't distorted.
  // Short orbits only, where the valley shows up best.
  const short = rp.filter((p) => p.period < 100);
  const [lo, hi, nBins] = [Math.log10(0.4), Math.log10(20), 50];
  const step = (hi - lo) / nBins;
  const counts = Array(nBins).fill(0);
  short.forEach((p) => {
    const b = Math.floor((Math.log10(p.radius) - lo) / step);
    if (b >= 0 && b < nBins) counts[b] += 1;
  });
  const centers = counts.map((_, i) => lo + (i + 0.5) * step);
  const ticks = [0.5, 1, 1.5, 2, 3, 4, 6, 10, 20];
  const hist = legendLayout(baseLayout({ xTitle: "Radius (× Earth, log scale)", yTitle: "Number of planets", height: 340 }));
  hist.xaxis = { ...hist.xaxis, range: [lo, hi], tickvals: ticks.map(Math.log10), ticktext: ticks.map(String) };
  hist.bargap = 0.1;
  hist.shapes = candidates.filter((c) => c.radius).map((c) => ({
    type: "line", x0: Math.log10(c.radius), x1: Math.log10(c.radius), yref: "paper", y0: 0, y1: 1,
    line: { color: c.color, width: 2, dash: "dot" },
  }));
  hist.annotations = candidates.filter((c) => c.radius).map((c) => ({
    x: Math.log10(c.radius), yref: "paper", y: 1, yanchor: "bottom", text: c.label, showarrow: false, font: { color: PAPER, size: 11 },
  }));

  // 3. Mass vs radius
  const mr = pick(["mass", "radius"]).filter((p) => p.radiusMeasured && p.massMeasured);
  const massRadius = legendLayout(baseLayout({ xTitle: "Mass (× Earth, log scale)", yTitle: "Radius (× Earth, log scale)", height: 420 }));
  massRadius.xaxis.type = "log";
  massRadius.yaxis.type = "log";
  massRadius.shapes = candidates.filter((c) => c.radius).map((c) => ({
    type: "line", xref: "paper", x0: 0, x1: 1, y0: c.radius, y1: c.radius, line: { color: c.color, width: 2, dash: "dot" },
  }));
  massRadius.annotations = candidates.filter((c) => c.radius).map((c) => ({
    xref: "paper", x: 0.01, y: Math.log10(c.radius), xanchor: "left", yanchor: "bottom", showarrow: false,
    text: `${c.label}: size known, mass not measured yet`, font: { color: PAPER, size: 11 },
  }));

  // 4. Habitable zone: light received vs star temperature
  const hzp = pick(["insol", "teff"]);
  const hz = planets.habitable_zone;
  const hzLayout = legendLayout(baseLayout({ xTitle: "Light received (× Earth, log scale; hotter ←, colder →)", yTitle: "Star temperature (K)", height: 460 }));
  hzLayout.xaxis.type = "log";
  // Open zoomed in on the zone (hot planets reach 10,000× Earth's light and would squash it),
  // widened if a candidate falls outside. A log axis range is given in powers of ten; listing
  // the bigger value first puts hotter planets on the left.
  const candInsol = candidates.map((c) => c.insol).filter((v) => v > 0);
  const hot = Math.max(100, ...candInsol.map((v) => v * 2));
  const cold = Math.min(0.02, ...candInsol.map((v) => v / 2));
  hzLayout.xaxis.range = [Math.log10(hot), Math.log10(cold)];
  hzLayout.yaxis.range = [2400, 7400];
  const hzBand = {
    x: [...hz.inner, ...[...hz.outer].reverse()],
    y: [...hz.teff, ...[...hz.teff].reverse()],
    type: "scatter", mode: "lines", fill: "toself", name: "Habitable zone",
    fillcolor: "rgba(47,168,156,0.16)", line: { color: "rgba(47,168,156,0.5)", width: 1 }, hoverinfo: "skip",
  };

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="star-filter" className="text-sm text-dim">Show planets around</label>
        <select id="star-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-ink-light bg-ink-light px-3 py-2">
          {Object.entries(FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <span className="text-sm text-dim">
          {rows.length.toLocaleString()} of {planets.count.toLocaleString()} confirmed planets. NASA Exoplanet Archive, updated {planets.updated}.
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="mt-4 rounded-md bg-ink-light px-4 py-3 text-sm">
          Search a star on the <b>Find</b> tab to place your candidates on these charts.
        </p>
      ) : (
        <ul className="mt-4 space-y-1 text-sm">
          {candidates.map((c) => (
            <li key={c.label}>
              <span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c.color }} />{" "}
              <b>{c.label}</b> ({search.target}{c.match ? `, matches ${c.match}` : ""}): {c.period.toFixed(2)}-day orbit
              {c.radius ? `, ${c.radius} × Earth` : ""}
              {c.insol != null ? `, gets ${c.insol} × Earth's light (about ${c.eqt} K), ${c.hz}` : ""}.
            </li>
          ))}
        </ul>
      )}

      <Chart
        title="Size vs. orbit"
        data={[
          knownTrace(rp.map((p) => p.period), rp.map((p) => p.radius), rp.map((p) => p.name), "%{x:.2f} d · %{y:.2f} × Earth"),
          solarTrace("period", "radius"),
          ...candidateTraces(candidates, (c) => c.period, (c) => c.radius),
        ]}
        layout={sizeOrbit}
      >
        Every confirmed planet whose size was measured from its transit. Hot Jupiters cluster top left, and small planets on short orbits fill the
        bottom. The shaded band at 1.5 to 2 times Earth's size is the radius valley, where planets are less common than just above or below it.
      </Chart>

      <Chart
        title="How common is each size?"
        data={[{
          x: centers, y: counts, type: "bar", name: "Known planets (orbits under 100 days)",
          marker: { color: DIM, opacity: 0.8 },
          customdata: centers.map((c) => [(10 ** (c - step / 2)).toFixed(2), (10 ** (c + step / 2)).toFixed(2)]),
          hovertemplate: "%{y} planets between %{customdata[0]} and %{customdata[1]} × Earth<extra></extra>",
        }]}
        layout={hist}
      >
        Planets on orbits shorter than 100 days, counted by size. Look for the shallow dip around 1.8 to 2 times Earth's size,
        between the rocky super-Earths (about 1.5 × Earth) and the gassy sub-Neptunes (about 2.5 × Earth). In this mixed archive
        data it's faint. Studies that measured their stars' sizes very precisely see a much deeper gap (Fulton et al. 2017).
        One leading idea is that starlight strips the atmospheres off some planets, which shrinks them across the gap.
      </Chart>

      <Chart
        title="Mass vs. size"
        data={[
          knownTrace(mr.map((p) => p.mass), mr.map((p) => p.radius), mr.map((p) => p.name), "%{x:.1f} × Earth mass · %{y:.2f} × Earth size"),
          solarTrace("mass", "radius"),
        ]}
        layout={massRadius}
      >
        Planets whose mass and size were both measured. Together they give a planet's density, which tells you whether it's rock, water, or gas. A transit only measures
        size. Mass needs a different method, such as measuring how the star wobbles, so your candidate appears as a line. Its
        mass could be anywhere along it.
      </Chart>

      <Chart
        title="The habitable zone"
        data={[
          hzBand,
          knownTrace(hzp.map((p) => p.insol), hzp.map((p) => p.teff), hzp.map((p) => p.name), "%{x:.2f} × Earth's light · star %{y:.0f} K"),
          solarTrace("insol", null, () => SUN_TEFF),
          ...candidateTraces(candidates, (c) => c.insol, (c) => c.teff),
        ]}
        layout={hzLayout}
      >
        How much light each planet gets compared with Earth, against how hot its star is. The green band is the conservative
        habitable zone, where liquid water could exist on a rocky surface (Kopparapu et al. 2014). Cooler stars' zones sit at
        lower light levels because their light is redder and warms planets more efficiently. Being in the zone doesn't make a
        planet habitable. It just makes it worth a closer look. Double-click the chart to zoom out to every planet.
      </Chart>
    </div>
  );
}
