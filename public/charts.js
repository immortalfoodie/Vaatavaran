/**
 * CSP-safe SVG and matrix chart renderers (zero inline styles).
 * Renders the 12-hour dot-matrix outlook, hourly exposure heatmap, and CO2 comparison.
 */
import { category, impact, CO2_KG_PER_KM } from "./engine.js";
import { $, el } from "./dom.js";
import { formatShortHour, formatTime } from "./format.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./types.js").HourlyPoint} HourlyPoint */

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_FORECAST_HOURS = 12;
const MAX_DOT_ROWS = 9;
/** Colours come from CSS classes (see "SVG charts" in style.css) so charts follow the theme. */
const CHART_FONT = { class: "chart-label", "font-size": 8.5, "font-family": "sans-serif" };
/** Label every Nth hour on the dot-matrix x-axis (plus the final hour). */
const AXIS_LABEL_EVERY = 3;

/** Dot-matrix outlook geometry (SVG user units). */
const DOT_CHART = {
  width: 380,
  height: 168,
  padLeft: 30,
  padRight: 10,
  padTop: 14,
  padBottom: 24,
  minScaleAqi: 120,
  maxDotRadius: 5.6,
  dotRadiusRatio: 0.34,
  dotGap: 2,
};

/** Exposure heatmap: relative-intensity bands from top (peak) to bottom (base). */
const EXPOSURE_BANDS = [
  { label: "PEAK", frac: 0.75, baseLvl: 4 },
  { label: "HIGH", frac: 0.5, baseLvl: 3 },
  { label: "MOD", frac: 0.25, baseLvl: 2 },
  { label: "BASE", frac: 0, baseLvl: 1 },
];
const EXPOSURE = { minScaleAqi: 100, minSpan: 25, edgeFraction: 0.18, maxLevel: 4 };

/** CO₂ comparison bar-chart geometry (SVG user units). */
const IMPACT_CHART = {
  viewBox: "0 0 360 134",
  baseline: 118,
  barWidth: 156,
  transitX: 14,
  carX: 190,
  maxBarHeight: 92,
  minCarHeight: 14,
  minTransitHeight: 10,
  minScaleKg: 0.5,
  labelOffset: 6,
};

/**
 * Create an SVG element with stringified attributes.
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @returns {any}
 */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * @param {DataMode} mode
 * @param {boolean} separateOutlook
 * @param {string | undefined} sourceKind
 */
function getForecastLabel(mode, separateOutlook, sourceKind) {
  if (mode === "demo") return "DEMO OUTLOOK";
  if (separateOutlook) return "SEPARATE CAMS MODEL";
  if (sourceKind === "station") return "STATION FEED";
  return "REGIONAL MODEL";
}

/**
 * @param {number | null} selectedHourIndex
 * @param {number} bestIdx
 * @param {number} count
 * @returns {number}
 */
function resolveActiveHourIndex(selectedHourIndex, bestIdx, count) {
  if (
    selectedHourIndex !== null &&
    Number.isInteger(selectedHourIndex) &&
    selectedHourIndex >= 0 &&
    selectedHourIndex < count
  ) {
    return selectedHourIndex;
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

/**
 * Render the interactive 12-hour stacked-circle dot-matrix chart and hour selector pills.
 * @param {object} options
 * @param {Air} options.air Air data that carries the hourly outlook.
 * @param {Plan} options.plan Plan computed from that outlook.
 * @param {DataMode} options.mode
 * @param {City} options.city
 * @param {boolean} [options.separateOutlook] Outlook comes from a different source than the reading.
 * @param {number | null} options.selectedHourIndex
 * @param {(index: number) => void} options.onSelectHour
 */
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

  $("#forecast-label").textContent = getForecastLabel(mode, separateOutlook, air.source?.kind);

  const hours = (air.hourly || []).slice(0, MAX_FORECAST_HOURS);
  if (!hours.length) {
    $("#inspector-reading").textContent = "Hourly forecast unavailable for this feed";
    chart.append(
      el(
        "p",
        "forecast-note",
        "Select Regional model or Demo scenario to view the 12-hour outlook.",
      ),
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
  const activeLabel = activeIdx === 0 ? "Now" : formatTime(city, activeHour.time);
  const lowestNote = activeIdx === bestIdx ? " · Lowest in window" : "";
  $("#inspector-reading").textContent =
    `${activeLabel} · AQI ${activeHour.aqi} (${category(activeHour.aqi).label})${lowestNote}`;

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
  $("#best-window").textContent = describeBestWindow(plan.best, city, separateOutlook);
}

/**
 * @param {HourlyPoint | null} best
 * @param {City} city
 * @param {boolean} separateOutlook
 * @returns {string}
 */
function describeBestWindow(best, city, separateOutlook) {
  if (!best) return "";
  const prefix = separateOutlook
    ? "Separate regional model (not a continuation of the station reading). "
    : "";
  const label = category(best.aqi).label.toLowerCase();
  return `${prefix}Lowest in outlook: ${formatTime(city, best.time)} · AQI ${best.aqi} (${label}). Lower does not mean safe.`;
}

/**
 * @param {HourlyPoint[]} hours
 * @param {number} activeIdx
 * @param {City} city
 */
function buildDotMatrixSvg(hours, activeIdx, city) {
  const { width, height, padLeft: padL, padRight: padR, padTop: padT, padBottom: padB } = DOT_CHART;
  const maxAqi = Math.max(DOT_CHART.minScaleAqi, ...hours.map((h) => h.aqi));
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const colW = plotW / hours.length;
  const dotR = Math.min(DOT_CHART.maxDotRadius, colW * DOT_CHART.dotRadiusRatio);
  const dotStep = plotH / MAX_DOT_ROWS;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
  svg.append(
    svgEl("line", {
      x1: padL,
      y1: padT,
      x2: padL,
      y2: height - padB,
      class: "chart-axis",
    }),
    svgEl("line", {
      x1: padL,
      y1: height - padB,
      x2: width - padR,
      y2: height - padB,
      class: "chart-axis",
    }),
  );

  for (const frac of [0, 0.5, 1]) {
    const y = height - padB - frac * plotH;
    const tick = svgEl("text", { x: padL - 6, y: y + 3, "text-anchor": "end", ...CHART_FONT });
    tick.textContent = String(Math.round(frac * maxAqi));
    svg.append(tick);
  }

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const cx = padL + colW * i + colW / 2;
    const dots = Math.max(1, Math.round((h.aqi / maxAqi) * MAX_DOT_ROWS));
    const dotClass = i === activeIdx ? "chart-dot is-active" : "chart-dot";

    for (let d = 0; d < dots; d++) {
      const cy = height - padB - dotStep * d - dotR - DOT_CHART.dotGap;
      svg.append(
        svgEl("circle", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: dotR.toFixed(1),
          class: dotClass,
        }),
      );
    }

    if (i % AXIS_LABEL_EVERY === 0 || i === hours.length - 1) {
      const lbl = svgEl("text", {
        x: cx.toFixed(1),
        y: height - 8,
        "text-anchor": "middle",
        ...CHART_FONT,
      });
      lbl.textContent = i === 0 ? "NOW" : formatShortHour(city, h.time).toUpperCase();
      svg.append(lbl);
    }
  }
  return svg;
}

/**
 * Shade level (0 = empty, 1–4) of one heatmap cell for a relative intensity.
 * @param {number} rel Hour's AQI position between the window minimum (0) and maximum (1).
 * @param {{ frac: number, baseLvl: number }} band
 * @returns {number}
 */
function exposureLevel(rel, band) {
  if (rel >= band.frac) {
    const nearEdge = rel < band.frac + EXPOSURE.edgeFraction ? 1 : 0;
    return Math.min(EXPOSURE.maxLevel, Math.max(1, band.baseLvl - nearEdge));
  }
  return band.baseLvl === 1 ? 1 : 0;
}

/**
 * Render the 4-band relative olive intensity heatmap on the Analytics view.
 * @param {Air} air
 * @param {City} city
 */
export function renderExposureMatrix(air, city) {
  const container = $("#exposure-matrix");
  container.replaceChildren();
  const hours = (air.hourly || []).slice(0, MAX_FORECAST_HOURS);
  const maxAqi = Math.max(EXPOSURE.minScaleAqi, ...hours.map((h) => h.aqi));
  const minAqi = hours.length ? Math.min(...hours.map((h) => h.aqi)) : 0;
  const span = Math.max(EXPOSURE.minSpan, maxAqi - minAqi);

  for (const band of EXPOSURE_BANDS) {
    const row = el("div", "density-row");
    row.append(el("span", "density-label", band.label));
    for (let i = 0; i < MAX_FORECAST_HOURS; i++) {
      const h = hours[i];
      const lvl = h && Number.isFinite(h.aqi) ? exposureLevel((h.aqi - minAqi) / span, band) : 0;
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

/**
 * Render the diagonal-hatched vs. solid forest commute CO₂ comparison chart.
 * @param {number | string} distance Daily distance in km.
 */
export function renderImpact(distance) {
  const value = Number(distance);
  const { car, transit } = CO2_KG_PER_KM;
  const estimate = impact({ commute: "car", distance: value });
  $("#distance-label").textContent = `${value} km`;
  $("#carbon-saving").textContent = estimate.savedKg.toFixed(2);
  $("#carbon-formula").textContent =
    `${value} km × (${car} − ${transit}) kg CO₂/km = ${estimate.savedKg.toFixed(2)} kg CO₂ per day. Scenario only; not logged as an actual saving.`;

  const chart = $("#impact-chart");
  if (!chart) return;
  chart.replaceChildren();

  const C = IMPACT_CHART;
  const carKg = Number((value * car).toFixed(2));
  const transitKg = Number((value * transit).toFixed(2));
  const maxVal = Math.max(C.minScaleKg, carKg);
  const carH = Math.max(C.minCarHeight, Math.round((carKg / maxVal) * C.maxBarHeight));
  const transitH = Math.max(C.minTransitHeight, Math.round((transitKg / maxVal) * C.maxBarHeight));

  const svg = svgEl("svg", { viewBox: C.viewBox, "aria-hidden": "true" });
  const defs = svgEl("defs");
  const pattern = svgEl("pattern", {
    id: "diag-hatch",
    width: 8,
    height: 8,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 8, class: "chart-hatch" }));
  defs.append(pattern);
  svg.append(defs);

  const barLabelFont = { "font-size": 9, "font-weight": 700, "font-family": "sans-serif" };
  const tY = C.baseline - transitH;
  svg.append(
    svgEl("rect", {
      x: C.transitX,
      y: tY,
      width: C.barWidth,
      height: transitH,
      fill: "url(#diag-hatch)",
      class: "chart-axis",
    }),
  );
  const tLabel = svgEl("text", {
    x: C.transitX,
    y: tY - C.labelOffset,
    class: "chart-label is-muted",
    ...barLabelFont,
  });
  tLabel.textContent = `PUBLIC TRANSIT (${transitKg.toFixed(2)} KG)`;
  svg.append(tLabel);

  const cY = C.baseline - carH;
  svg.append(
    svgEl("rect", { x: C.carX, y: cY, width: C.barWidth, height: carH, class: "chart-bar" }),
  );
  const cLabel = svgEl("text", {
    x: C.carX,
    y: cY - C.labelOffset,
    class: "chart-label",
    ...barLabelFont,
  });
  cLabel.textContent = `SOLO CAR (${carKg.toFixed(2)} KG)`;
  svg.append(cLabel);

  chart.append(svg);
}
