/**
 * CSP-safe SVG and matrix chart renderers (zero inline styles).
 * Renders the 12-hour dot-matrix outlook, hourly exposure heatmap, and CO2 comparison.
 */
import { category, impact } from "./engine.js";

const $ = (selector) => document.querySelector(selector);
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_FORECAST_HOURS = 12;
const MAX_DOT_ROWS = 9;
const FOREST = "#23371b";
const DOT_FILL = "#ebf3db";

/** Create an HTML element with optional class name and text content. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Create an SVG element with stringified attributes. */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/** Format an ISO timestamp in the city's local time (e.g. "5:30 am"). */
export function formatTime(city, time) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: city.zone,
  }).format(new Date(time));
}

/** Format an ISO timestamp as a short hour label (e.g. "5 am"). */
export function formatShortHour(city, time) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    timeZone: city.zone,
  }).format(new Date(time));
}

function getForecastLabel(mode, separateOutlook, sourceKind) {
  if (mode === "demo") return "DEMO OUTLOOK";
  if (separateOutlook) return "SEPARATE CAMS MODEL";
  if (sourceKind === "station") return "STATION FEED";
  return "REGIONAL MODEL";
}

function resolveActiveHourIndex(selectedHourIndex, bestIdx, count) {
  if (
    Number.isInteger(selectedHourIndex) &&
    selectedHourIndex >= 0 &&
    selectedHourIndex < count
  ) {
    return selectedHourIndex;
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

/** Render the interactive 12-hour stacked-circle dot-matrix chart and hour selector pills. */
export function renderForecast({
  air,
  plan,
  mode,
  city,
  separateOutlook = false,
  selectedHourIndex,
  onSelectHour,
}) {
  const chart = $("#forecast");
  const pills = $("#hour-pills");
  const table = $("#forecast-table");
  chart.replaceChildren();
  pills.replaceChildren();
  table.replaceChildren();

  $("#forecast-label").textContent = getForecastLabel(
    mode,
    separateOutlook,
    air.source?.kind,
  );

  const hours = (air.hourly || []).slice(0, MAX_FORECAST_HOURS);
  if (!hours.length) {
    $("#inspector-reading").textContent = "Hourly forecast unavailable for this feed";
    chart.append(
      el("p", "forecast-note", "Select Regional model or Demo scenario to view the 12-hour outlook."),
    );
    $("#best-window").textContent =
      air.source?.kind === "station"
        ? "This station feed does not supply an hourly forecast. Select Regional model for the CAMS outlook."
        : "No forecast is available. Check local monitoring before outdoor activity.";
    return;
  }

  const bestIdx = hours.findIndex((h) => h.time === plan.best?.time);
  const activeIdx = resolveActiveHourIndex(selectedHourIndex, bestIdx, hours.length);

  const activeHour = hours[activeIdx];
  $("#inspector-reading").textContent =
    `${activeIdx === 0 ? "Now" : formatTime(city, activeHour.time)} · AQI ${activeHour.aqi} (${category(activeHour.aqi).label})${activeIdx === bestIdx ? " · Lowest in window" : ""}`;

  chart.append(buildDotMatrixSvg(hours, activeIdx, city));

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const isSelected = i === activeIdx;
    const btn = el(
      "button",
      `hour-pill${isSelected ? " selected" : ""}`,
      i === 0 ? "NOW" : formatShortHour(city, h.time).replace(/\s+/g, "").toUpperCase(),
    );
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(isSelected));
    btn.addEventListener("click", () => onSelectHour(i));
    pills.append(btn);

    const row = el("tr");
    row.append(
      el("td", "", formatTime(city, h.time)),
      el("td", "", String(h.aqi)),
      el("td", "", category(h.aqi).label),
    );
    table.append(row);
  }

  chart.setAttribute(
    "aria-label",
    `${mode === "demo" ? "Illustrative" : "Modelled"} hourly US AQI: ${hours.map((h) => `${formatTime(city, h.time)}: ${h.aqi}`).join(", ")}. A data table follows.`,
  );
  $("#best-window").textContent = plan.best
    ? `${separateOutlook ? "Separate regional model (not a continuation of the station reading). " : ""}Lowest in outlook: ${formatTime(city, plan.best.time)} · AQI ${plan.best.aqi} (${category(plan.best.aqi).label.toLowerCase()}). Lower does not mean safe.`
    : "";
}

function buildDotMatrixSvg(hours, activeIdx, city) {
  const maxAqi = Math.max(120, ...hours.map((h) => h.aqi));
  const width = 380;
  const height = 168;
  const padL = 30;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const colW = plotW / hours.length;
  const dotR = Math.min(5.6, colW * 0.34);
  const dotStep = plotH / MAX_DOT_ROWS;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
  svg.append(
    svgEl("line", { x1: padL, y1: padT, x2: padL, y2: height - padB, stroke: FOREST, "stroke-width": 1 }),
    svgEl("line", { x1: padL, y1: height - padB, x2: width - padR, y2: height - padB, stroke: FOREST, "stroke-width": 1 }),
  );

  for (const frac of [0, 0.5, 1]) {
    const y = height - padB - frac * plotH;
    const tick = svgEl("text", {
      x: padL - 6,
      y: y + 3,
      "text-anchor": "end",
      "font-size": 8.5,
      fill: FOREST,
      "font-family": "sans-serif",
    });
    tick.textContent = String(Math.round(frac * maxAqi));
    svg.append(tick);
  }

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const cx = padL + colW * i + colW / 2;
    const dots = Math.max(1, Math.round((h.aqi / maxAqi) * MAX_DOT_ROWS));
    const fill = i === activeIdx ? FOREST : DOT_FILL;

    for (let d = 0; d < dots; d++) {
      const cy = height - padB - dotStep * d - dotR - 2;
      svg.append(
        svgEl("circle", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: dotR.toFixed(1),
          fill,
          stroke: FOREST,
          "stroke-width": 1,
        }),
      );
    }

    if (i === 0 || i === 3 || i === 6 || i === 9 || i === hours.length - 1) {
      const lbl = svgEl("text", {
        x: cx.toFixed(1),
        y: height - 8,
        "text-anchor": "middle",
        "font-size": 8.5,
        fill: FOREST,
        "font-family": "sans-serif",
      });
      lbl.textContent = i === 0 ? "NOW" : formatShortHour(city, h.time).toUpperCase();
      svg.append(lbl);
    }
  }
  return svg;
}

/** Render the 4-band relative olive intensity heatmap on the Analytics view. */
export function renderExposureMatrix(air, city) {
  const container = $("#exposure-matrix");
  container.replaceChildren();
  const hours = (air.hourly || []).slice(0, MAX_FORECAST_HOURS);
  const maxAqi = Math.max(100, ...hours.map((h) => h.aqi));
  const minAqi = hours.length ? Math.min(...hours.map((h) => h.aqi)) : 0;
  const span = Math.max(25, maxAqi - minAqi);
  const bands = [
    { label: "PEAK", frac: 0.75, baseLvl: 4 },
    { label: "HIGH", frac: 0.5, baseLvl: 3 },
    { label: "MOD", frac: 0.25, baseLvl: 2 },
    { label: "BASE", frac: 0, baseLvl: 1 },
  ];

  for (const band of bands) {
    const row = el("div", "density-row");
    row.append(el("span", "density-label", band.label));
    for (let i = 0; i < MAX_FORECAST_HOURS; i++) {
      const h = hours[i];
      let lvl = 0;
      if (h && Number.isFinite(h.aqi)) {
        const rel = (h.aqi - minAqi) / span;
        if (rel >= band.frac) {
          lvl = Math.min(4, Math.max(1, band.baseLvl - (rel < band.frac + 0.18 ? 1 : 0)));
        } else if (band.baseLvl === 1) {
          lvl = 1;
        }
      }
      row.append(el("span", `density-cell${lvl ? ` lvl-${lvl}` : ""}`));
    }
    container.append(row);
  }

  const times = el("div", "density-times");
  times.append(el("span", "", ""));
  for (let i = 0; i < MAX_FORECAST_HOURS; i++) {
    const h = hours[i];
    let text = "—";
    if (h) {
      text = i === 0 ? "NOW" : formatShortHour(city, h.time).replace(/\s*(am|pm)/i, "$1");
    }
    times.append(el("span", "", text));
  }
  container.append(times);
}

/** Render the diagonal-hatched vs. solid forest commute CO2 comparison chart. */
export function renderImpact(distance) {
  const value = Number(distance);
  const estimate = impact({ commute: "car", distance: value });
  $("#distance-label").textContent = `${value} km`;
  $("#carbon-saving").textContent = estimate.savedKg.toFixed(2);
  $("#carbon-formula").textContent =
    `${value} km × (0.17 − 0.06) kg CO₂/km = ${estimate.savedKg.toFixed(2)} kg CO₂ per day. Scenario only; not logged as an actual saving.`;

  const chart = $("#impact-chart");
  if (!chart) return;
  chart.replaceChildren();

  const carKg = Number((value * 0.17).toFixed(2));
  const transitKg = Number((value * 0.06).toFixed(2));
  const maxVal = Math.max(0.5, carKg);
  const carH = Math.max(14, Math.round((carKg / maxVal) * 92));
  const transitH = Math.max(10, Math.round((transitKg / maxVal) * 92));

  const svg = svgEl("svg", { viewBox: "0 0 360 134", "aria-hidden": "true" });
  const defs = svgEl("defs");
  const pattern = svgEl("pattern", {
    id: "diag-hatch",
    width: 8,
    height: 8,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: FOREST, "stroke-width": 2.4 }));
  defs.append(pattern);
  svg.append(defs);

  const tY = 118 - transitH;
  svg.append(
    svgEl("rect", { x: 14, y: tY, width: 156, height: transitH, fill: "url(#diag-hatch)", stroke: FOREST, "stroke-width": 1 }),
  );
  const tLabel = svgEl("text", { x: 14, y: tY - 6, "font-size": 9, "font-weight": 700, fill: "#4a5444", "font-family": "sans-serif" });
  tLabel.textContent = `PUBLIC TRANSIT (${transitKg.toFixed(2)} KG)`;
  svg.append(tLabel);

  const cY = 118 - carH;
  svg.append(svgEl("rect", { x: 190, y: cY, width: 156, height: carH, fill: FOREST }));
  const cLabel = svgEl("text", { x: 190, y: cY - 6, "font-size": 9, "font-weight": 700, fill: FOREST, "font-family": "sans-serif" });
  cLabel.textContent = `SOLO CAR (${carKg.toFixed(2)} KG)`;
  svg.append(cLabel);

  chart.append(svg);
}
