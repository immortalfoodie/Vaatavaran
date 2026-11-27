/**
 * Air Quality Index hero card renderer: source copy, dual US/India NAQI scales,
 * 24-hour delta pill, WHO context, segmented meter, freshness and attributions.
 */
import { isFiniteNumber } from "./engine.js";
import { formatRelativeAge, formatTime } from "./format.js";
import { indiaNaqiFromPm } from "./aqi-scales.js";
import { $, $time, el } from "./dom.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").DataMode} DataMode */

const WHO_PM25_24H_UG_M3 = 15;
const METER_SEGMENTS = 20;
const METER_MAX_AQI = 350;

/**
 * Rounded AQI for display, or an em dash when unavailable.
 * @param {unknown} aqi
 * @returns {string}
 */
export const formatAqi = (aqi) => (isFiniteNumber(aqi) ? String(Math.round(aqi)) : "—");

/**
 * "Updated <time> · fetched <time>" line for a live source.
 * @param {string} prefix Source-specific verb phrase, e.g. "Model valid".
 * @param {Air} air
 * @param {City} city
 * @returns {string}
 */
function describeObserved(prefix, air, city) {
  if (!air.observedAt) return "No valid reading for the selected source";
  const observed = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: city.zone,
  }).format(new Date(air.observedAt));
  const fetched = air.fetchedAt ? formatTime(city, air.fetchedAt) : "";
  return `${prefix} ${observed} · fetched ${fetched}`;
}

/**
 * @typedef {object} SourceCopy
 * @property {string} heading
 * @property {string} typeMain
 * @property {string} typeSub
 * @property {string} badge
 * @property {(air: Air) => string} description
 * @property {(air: Air, city: City) => string} observed
 * @property {string} warning
 */

/**
 * Display copy for each data source. Keeping it as data makes every label easy to audit.
 * @type {Record<"demo" | "google" | "station" | "model", SourceCopy>}
 */
const SOURCE_COPY = {
  demo: {
    heading: "DEMO SCENARIO",
    typeMain: "Demo ",
    typeSub: "scenario",
    badge: "DEMO DATA",
    description: () => "Illustrative winter-smog scenario · not current conditions",
    observed: () => "Demo scenario · switch to live source for current data",
    warning: "Illustrative scenario. Do not use these numbers as current conditions.",
  },
  google: {
    heading: "GOOGLE AIR QUALITY (500M)",
    typeMain: "Google ",
    typeSub: "500m live",
    badge: "GOOGLE 500M LIVE",
    description: (air) => {
      const local = air.localIndex ? ` · ${air.localIndex.name}: ${air.localIndex.aqi}` : "";
      return `Google Air Quality · 500 m sensor-fused grid${local}`;
    },
    observed: (air, city) => describeObserved("Google updated", air, city),
    warning:
      "Official US EPA NowCast AQI from Google Air Quality (500 m sensor-fused grid). Hourly PM2.5/PM10 shown separately.",
  },
  station: {
    heading: "STATION-REPORTED AQI",
    typeMain: "Station ",
    typeSub: "report",
    badge: "STATION LIVE",
    description: (air) => `WAQI · station ${air.source?.distanceKm} km from city centre`,
    observed: (air, city) => describeObserved("Station reported", air, city),
    warning:
      "PM values are pollutant-specific US AQI, not concentrations (µg/m³). One nearby station, not a city-wide average. Data is provisional.",
  },
  model: {
    heading: "REGIONAL FORECAST ESTIMATE",
    typeMain: "Model ",
    typeSub: "forecast",
    badge: "MODEL LIVE",
    description: () => "Copernicus CAMS global model · ~45 km resolution",
    observed: (air, city) => describeObserved("Model valid", air, city),
    warning: "Not a street-level sensor reading. Local pollution may differ substantially.",
  },
};

/**
 * Return human-readable display strings for the active air-quality source.
 * @param {DataMode} mode
 * @param {Air} air
 * @param {City} city
 */
function describeSource(mode, air, city) {
  const copy = SOURCE_COPY[mode === "demo" ? "demo" : air.source?.kind || "model"];
  const hasReading = isFiniteNumber(air.aqi);
  return {
    heading: hasReading ? copy.heading : "AIR DATA UNAVAILABLE",
    typeMain: copy.typeMain,
    typeSub: copy.typeSub,
    badge: hasReading ? copy.badge : "CHECKING DATA",
    description: copy.description(air),
    observed: copy.observed(air, city),
    warning: copy.warning,
  };
}

/**
 * Short display label for the active data source.
 * @param {DataMode} mode
 * @param {string} kind
 * @returns {string}
 */
export function getSourceLabel(mode, kind) {
  if (mode === "demo") return "Demo scenario";
  if (kind === "google") return "Google Air Quality (500m)";
  if (kind === "station") return "Station-reported AQI";
  return "Regional forecast estimate";
}

/**
 * @param {Air} air
 * @param {Air | null} forecastAir
 * @returns {{ value: number, suffix: string } | null}
 */
function resolveDelta24h(air, forecastAir) {
  if (isFiniteNumber(air.delta24h)) {
    return { value: air.delta24h, suffix: "VS YESTERDAY" };
  }
  const modelDelta = forecastAir?.delta24h;
  if (isFiniteNumber(modelDelta)) {
    return { value: modelDelta, suffix: "MODEL 24H" };
  }
  return null;
}

/**
 * @param {Air} air
 * @param {Air | null} forecastAir
 * @param {DataMode} mode
 */
function renderDeltaPill(air, forecastAir, mode) {
  const deltaEl = $("#aqi-delta");
  const resolved = mode === "demo" ? null : resolveDelta24h(air, forecastAir);
  if (!resolved) {
    deltaEl.hidden = true;
    return;
  }
  deltaEl.hidden = false;
  deltaEl.className = `delta-pill${resolved.value > 0 ? " worse" : ""}`;
  if (resolved.value === 0) {
    deltaEl.textContent = `SAME ${resolved.suffix}`;
  } else {
    const arrow = resolved.value > 0 ? "↑" : "↓";
    deltaEl.textContent = `${arrow} ${Math.abs(resolved.value)} ${resolved.suffix}`;
  }
}

/**
 * India NAQI estimate shown beside US AQI. Hidden for station feeds, whose PM fields are
 * US AQI sub-indices rather than concentrations, and whenever no PM reading exists.
 * @param {Air} air
 * @param {boolean} station
 */
function renderIndiaNaqi(air, station) {
  const naqi = station ? null : indiaNaqiFromPm(air.pm25, air.pm10);
  $("#naqi").hidden = !naqi;
  if (!naqi) return;
  $("#naqi-value").textContent = String(naqi.aqi);
  const tag = $("#naqi-category");
  tag.textContent = naqi.label.toUpperCase();
  tag.className = `status-tag ${naqi.tone}`;
  $("#naqi-basis").textContent =
    `Estimate from current ${naqi.dominant}; official CPCB values use 24-hour averages.`;
}

/**
 * "Updated 4 minutes ago" line. Safe to call on a timer: it only reads the reading's timestamp.
 * Demo scenarios have no meaningful age, so the line is hidden for them.
 * @param {Air} air
 * @param {DataMode} mode
 * @param {number} [now] Current time in ms.
 */
export function renderFreshness(air, mode, now = Date.now()) {
  const node = $time("#updated-ago");
  node.hidden = mode === "demo";
  const age = formatRelativeAge(air.fetchedAt, now);
  node.dateTime = age && air.fetchedAt ? air.fetchedAt : "";
  node.textContent = age ? `Updated ${age}` : "";
}

/**
 * @param {Air} air
 * @param {boolean} station
 */
function renderWhoContext(air, station) {
  const whoEl = $("#who-context");
  if (!station && isFiniteNumber(air.pm25) && air.pm25 > 0) {
    const ratio = (air.pm25 / WHO_PM25_24H_UG_M3).toFixed(1);
    whoEl.hidden = false;
    whoEl.textContent =
      air.pm25 > WHO_PM25_24H_UG_M3
        ? `Hourly PM2.5 is ~${ratio}× the WHO 24h guideline (${WHO_PM25_24H_UG_M3} µg/m³).`
        : `Hourly PM2.5 is within the WHO 24h guideline (${WHO_PM25_24H_UG_M3} µg/m³).`;
  } else {
    whoEl.hidden = true;
  }
}

/** @param {number | null} aqi */
function renderSegmentedMeter(aqi) {
  const container = $("#aqi-meter");
  container.replaceChildren();
  const filled = isFiniteNumber(aqi)
    ? Math.max(1, Math.min(METER_SEGMENTS, Math.round((aqi / METER_MAX_AQI) * METER_SEGMENTS)))
    : 0;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    container.append(el("span", i < filled ? "seg-block filled" : "seg-block"));
  }
}

/**
 * @param {Air} air
 * @param {DataMode} mode
 */
function renderAttribution(air, mode) {
  const container = $("#source-attribution");
  container.replaceChildren();
  if (mode === "demo" || !air.source) return;
  const credits = [
    { name: air.source.name, url: air.source.url },
    ...(air.source.attributions || []),
  ];
  for (const credit of credits) {
    if (container.childNodes.length) container.append(document.createTextNode(" · "));
    if (credit.url) {
      const link = el("a", "", credit.name);
      link.href = credit.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      container.append(link);
    } else {
      container.append(el("span", "", credit.name));
    }
  }
}

/**
 * @param {Air} air
 * @param {boolean} station
 */
function renderParticulateCells(air, station) {
  for (const [id, value] of [
    ["pm25", station ? air.pollutantAqi?.pm25 : air.pm25],
    ["pm10", station ? air.pollutantAqi?.pm10 : air.pm10],
  ]) {
    if (isFiniteNumber(value)) {
      $(`#${id}`).replaceChildren(
        document.createTextNode(`${Math.round(value)} `),
        el("small", "", station ? "US AQI" : "µg/m³"),
      );
    } else {
      $(`#${id}`).replaceChildren(el("small", "", "Not reported"));
    }
  }
}

/**
 * Render the primary Air Quality Index card.
 * @param {{ air: Air, forecastAir: Air | null, plan: Plan, city: City, mode: DataMode,
 *   station: boolean }} options
 */
export function renderAirCard({ air, forecastAir, plan, city, mode, station }) {
  const meta = describeSource(mode, air, city);

  $("#air-heading").textContent = meta.heading;
  $("#air-location").textContent =
    (station ? air.source?.station : null) || `${city.name} · ${city.region}`;
  $("#aqi").textContent = formatAqi(air.aqi);
  $("#aqi-category").textContent = plan.category.label.toUpperCase();
  $("#aqi-category").className = `status-tag ${plan.category.tone}`;

  renderDeltaPill(air, forecastAir, mode);
  if (plan.category.level < 0) {
    $("#aqi-guidance").textContent = "Check local monitoring";
  } else if (plan.high) {
    $("#aqi-guidance").textContent = "Take extra care outdoors";
  } else {
    $("#aqi-guidance").textContent = "Stay aware of local conditions";
  }

  renderSegmentedMeter(air.aqi);
  renderWhoContext(air, station);
  renderIndiaNaqi(air, station);
  renderFreshness(air, mode);
  renderParticulateCells(air, station);

  $("#data-type").replaceChildren(
    document.createTextNode(meta.typeMain),
    el("small", "", meta.typeSub),
  );
  $("#data-label").textContent = meta.badge;
  $("#data-description").textContent = meta.description;
  $("#observed-label").textContent = meta.observed;
  $("#source-warning").textContent = meta.warning;

  renderAttribution(air, mode);
  $(".air-card").dataset.tone = plan.category.tone;
}
