/**
 * Stateless dashboard view renderers.
 * Receives normalized data and callbacks; never fetches or persists state.
 */
import { category, makePlan, activityReadiness, isFiniteNumber, LEVEL } from "./engine.js";
import { renderForecast, renderExposureMatrix, renderImpact } from "./charts.js";
import { formatRelativeAge, formatTime } from "./format.js";
import { indiaNaqiFromPm } from "./aqi-scales.js";
import { $, el } from "./dom.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").PlanCard} PlanCard */
/** @typedef {import("./types.js").Profile} Profile */
/** @typedef {import("./types.js").DataMode} DataMode */

/** Daily plan always has one movement, one commute and one home action. */
const TOTAL_ACTIONS = 3;
const WHO_PM25_24H_UG_M3 = 15;
const METER_SEGMENTS = 20;
const METER_MAX_AQI = 350;

const COMMUTE_LABELS = {
  car: "Solo car",
  transit: "Public transit",
  walk: "Walk / cycle",
  home: "Work from home",
};

/**
 * Rounded AQI for display, or an em dash when unavailable.
 * @param {unknown} aqi
 * @returns {string}
 */
const formatAqi = (aqi) => (isFiniteNumber(aqi) ? String(Math.round(aqi)) : "—");

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
 * @param {DataMode} mode
 * @param {string} kind
 */
function getSourceLabel(mode, kind) {
  if (mode === "demo") return "Demo scenario";
  if (kind === "google") return "Google Air Quality (500m)";
  if (kind === "station") return "Station-reported AQI";
  return "Regional forecast estimate";
}

/**
 * Coordinate all dashboard sections from current state.
 * @param {object} options
 * @param {Air} options.air Primary reading.
 * @param {Air | null} options.forecastAir Separate model outlook, when the primary has none.
 * @param {Profile} options.profile
 * @param {City} options.city
 * @param {DataMode} options.mode
 * @param {Set<string>} options.completed Completed action ids for today.
 * @param {number | null} options.selectedHourIndex
 * @param {(id: string, checked: boolean) => void} options.onComplete
 * @param {(index: number) => void} options.onSelectHour
 */
export function renderDashboard({
  air,
  forecastAir,
  profile,
  city,
  mode,
  completed,
  selectedHourIndex,
  onComplete,
  onSelectHour,
}) {
  const plan = makePlan(air, profile);
  const kind = air.source?.kind || "model";
  const station = kind === "station";
  const sourceLabel = getSourceLabel(mode, kind);
  const outlookAir = air.hourly?.length ? air : forecastAir || air;
  const outlookPlan = outlookAir === air ? plan : makePlan(outlookAir, profile);
  const separateOutlook = outlookAir !== air && Boolean(outlookAir.hourly?.length);

  renderHeaderMeta({ air, plan, profile, city });
  renderAirCard({ air, forecastAir, plan, city, mode, station, sourceLabel });
  renderBriefCard({ plan, outlookPlan, city, station, separateOutlook });
  renderPriorities({ plan, completed, onComplete });
  renderProfileSummary(profile, city);
  renderForecast({
    air: outlookAir,
    plan: outlookPlan,
    mode: separateOutlook ? "model" : mode,
    city,
    separateOutlook,
    selectedHourIndex,
    onSelectHour,
  });
  renderActivityReadiness(air, profile);
  renderExposureMatrix(outlookAir, city);
  renderSignals(outlookAir, outlookPlan, completed);

  $("#home-personal").textContent = plan.cards[2].action;
  $("#chat-context").textContent =
    `${city.name} · ${air.aqi ?? "Unavailable"} US AQI · ${sourceLabel} · current household preferences`;
  $("#impact-preview").textContent =
    plan.impact.savedKg > 0
      ? `Switching a ${profile.distance} km solo car commute to transit could avoid ~${plan.impact.savedKg} kg CO₂/day (illustrative scenario).`
      : "Your travel choices matter. Explore how a shared or lower-emission journey changes an illustrative carbon footprint.";
  $("#impact-distance").value = profile.distance;
  renderImpact(profile.distance);
}

/** @param {{ air: Air, plan: Plan, profile: Profile, city: City }} options */
function renderHeaderMeta({ air, plan, profile, city }) {
  $("#date-label").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: city.zone,
  })
    .format(new Date())
    .toUpperCase();
  $("#profile-caption").textContent = profile.sensitive
    ? "SENSITIVE HOUSEHOLD"
    : "STANDARD HOUSEHOLD";
  $("#header-aqi-count").textContent = formatAqi(air.aqi);
  $("#header-aqi-label").textContent = plan.category.label.toUpperCase();
}

/**
 * @param {{ air: Air, forecastAir: Air | null, plan: Plan, city: City, mode: DataMode,
 *   station: boolean, sourceLabel: string }} options
 */
function renderAirCard({ air, forecastAir, plan, city, mode, station }) {
  const meta = describeSource(mode, air, city);

  $("#air-heading").textContent = meta.heading;
  $("#air-location").textContent = station ? air.source?.station : `${city.name} · ${city.region}`;
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
  const node = $("#updated-ago");
  node.hidden = mode === "demo";
  const age = formatRelativeAge(air.fetchedAt, now);
  node.dateTime = age ? air.fetchedAt : "";
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

/**
 * @param {{ plan: Plan, outlookPlan: Plan, city: City, station: boolean,
 *   separateOutlook: boolean }} options
 */
function renderBriefCard({ plan, outlookPlan, city, station, separateOutlook }) {
  $("#hero-title").textContent = plan.headline;
  $("#hero-summary").textContent = plan.summary;
  if (plan.category.level < 0) {
    $("#outdoor-summary").textContent = "Check local monitor";
  } else if (plan.high) {
    $("#outdoor-summary").textContent = "Move indoors";
  } else {
    $("#outdoor-summary").textContent = "Quieter routes";
  }
  $("#window-summary").textContent = plan.high ? "Keep peaks out" : "Ventilate cleanly";
  const best = plan.best || outlookPlan?.best;
  if (best) {
    const suffix = separateOutlook ? " (model)" : "";
    $("#best-slot").textContent = `${formatTime(city, best.time)} · AQI ${best.aqi}${suffix}`;
  } else {
    $("#best-slot").textContent = station ? "Loading model…" : "Unavailable";
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
    const node = el(credit.url ? "a" : "span", "", credit.name);
    if (credit.url) {
      node.href = credit.url;
      node.target = "_blank";
      node.rel = "noreferrer";
    }
    container.append(node);
  }
}

/**
 * @param {Profile} profile
 * @param {City} city
 */
function renderProfileSummary(profile, city) {
  const dl = $("#plan-profile-dl");
  dl.replaceChildren();
  const rows = [
    ["CITY", city.name],
    ["SENSITIVITY", profile.sensitive ? "High (Sensitive)" : "Standard"],
    ["COMMUTE", COMMUTE_LABELS[profile.commute] || profile.commute],
    ["DAILY DISTANCE", `${profile.distance} km`],
    ["AIR PURIFIER", profile.purifier ? "Available" : "None"],
    ["BUDGET", profile.budget === "flexible" ? "Flexible" : "No-cost first"],
    ["EXERCISE", profile.outdoor],
  ];
  for (const [key, value] of rows) {
    const item = el("div");
    item.append(el("dt", "", key), el("dd", "", value));
    dl.append(item);
  }
}

/**
 * @param {{ plan: Plan, completed: Set<string>,
 *   onComplete: (id: string, checked: boolean) => void }} options
 */
function renderPriorities({ plan, completed, onComplete }) {
  const overviewList = $("#priorities");
  const fullList = $("#full-plan");
  overviewList.replaceChildren();
  fullList.replaceChildren();

  /** @type {(id: string, checked: boolean) => void} */
  const toggleAction = (id, checked) => {
    onComplete(id, checked);
    updateCompletion(completed);
    document
      .querySelectorAll(`[data-action-id="${id}"]`)
      .forEach((node) => node.classList.toggle("done", checked));
    document.querySelectorAll(`input[data-action-check="${id}"]`).forEach((box) => {
      /** @type {HTMLInputElement} */ (box).checked = checked;
    });
  };

  for (const card of plan.cards) {
    const isDone = completed.has(card.id);
    overviewList.append(buildOverviewPriorityCard(card, isDone, toggleAction));
    fullList.append(buildFullPlanCard(card, isDone, toggleAction));
  }
  updateCompletion(completed);
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildCheckbox(card, isDone, onToggle) {
  const label = el("label", "check-row");
  const box = el("input");
  box.type = "checkbox";
  box.checked = isDone;
  box.dataset.actionCheck = card.id;
  box.setAttribute("aria-label", `Mark completed: ${card.title}`);
  box.addEventListener("change", () => onToggle(card.id, box.checked));
  label.append(box, document.createTextNode("DONE"));
  return label;
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildOverviewPriorityCard(card, isDone, onToggle) {
  const node = el("article", `priority-card${isDone ? " done" : ""}`);
  node.dataset.actionId = card.id;
  const top = el("div", "priority-card-top");
  top.append(
    el("span", "priority-card-kicker", `${card.kind} · ${card.time}`),
    buildCheckbox(card, isDone, onToggle),
  );
  const foot = el("div", "priority-card-foot");
  const link = el("a", "", "[WHY & DETAILS ↗]");
  link.href = `#plan/${card.id}`;
  link.setAttribute("aria-label", `Explore: ${card.title}`);
  foot.append(el("span", "row-key", card.time), link);
  node.append(top, el("h3", "", card.title), el("p", "", card.action.split(/(?<=\.)\s+/)[0]), foot);
  return node;
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildFullPlanCard(card, isDone, onToggle) {
  const full = el("article", `plan-card${isDone ? " done" : ""}`);
  full.id = `action-${card.id}`;
  full.dataset.actionId = card.id;
  const body = el("div");
  const details = el("details");
  details.append(el("summary", "", "WHY THIS FITS YOUR DAY"), el("p", "", card.why));
  body.append(
    el("span", "plan-card-eyebrow", `${card.kind} · ${card.time}`),
    el("h3", "", card.title),
    el("p", "", card.action),
    details,
    el("div", "plan-impact", `↗ ${card.impact}`),
  );
  full.append(body, buildCheckbox(card, isDone, onToggle));
  return full;
}

/** @param {Set<string>} completed */
function updateCompletion(completed) {
  const count = completed.size;
  $("#completion").textContent = `${count} OF ${TOTAL_ACTIONS} COMPLETED`;
  $("#header-done-count").textContent = String(count);
  $("#brief-progress").textContent = `${count} OF ${TOTAL_ACTIONS} DONE`;
}

/**
 * @param {Air} air
 * @param {Profile} profile
 */
function renderActivityReadiness(air, profile) {
  const container = $("#activity-readiness");
  container.replaceChildren();
  for (const item of activityReadiness(air, profile)) {
    const row = el("div", "readiness-row");
    const head = el("div", "readiness-row-head");
    head.append(el("strong", "", item.label), el("span", `status-tag ${item.tone}`, item.status));
    row.append(head, el("p", "", item.note));
    container.append(row);
  }
}

/** Signal-bar width buckets by number of hours (out of 12). */
const MANY_HOURS = 6;
const SOME_HOURS = 2;

/** @param {number} count */
function barWidthClass(count) {
  if (count > MANY_HOURS) return "bar-w-85";
  if (count > SOME_HOURS) return "bar-w-70";
  return "bar-w-55";
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * @param {Air} air
 * @param {Plan} plan
 * @param {Set<string>} completed
 */
function renderSignals(air, plan, completed) {
  const container = $("#signal-bars");
  container.replaceChildren();
  const hours = air.hourly || [];
  const levels = hours.map((h) => category(h.aqi).level);
  const highHours = levels.filter((lvl) => lvl >= LEVEL.UNHEALTHY).length;
  const modHours = levels.filter((lvl) => lvl === LEVEL.MODERATE || lvl === LEVEL.SENSITIVE).length;
  const goodHours = levels.filter((lvl) => lvl === LEVEL.GOOD).length;

  const items = hours.length
    ? [
        {
          count: pad2(modHours),
          label: "CAUTION HOURS",
          width: barWidthClass(modHours),
          highlight: false,
        },
        {
          count: pad2(highHours),
          label: "HIGH-RISK HOURS",
          width: highHours > 0 ? "bar-w-100" : "bar-w-55",
          highlight: highHours > 0,
        },
        {
          count: pad2(goodHours),
          label: "GOOD-AIR HOURS",
          width: barWidthClass(goodHours),
          highlight: false,
        },
      ]
    : [
        {
          count: pad2(completed.size),
          label: "ACTIONS COMPLETED",
          width: "bar-w-55",
          highlight: false,
        },
        {
          count: formatAqi(air.aqi),
          label: plan.category.label.toUpperCase(),
          width: "bar-w-100",
          highlight: plan.high,
        },
        {
          count: pad2(Math.max(0, TOTAL_ACTIONS - completed.size)),
          label: "ACTIONS REMAINING",
          width: "bar-w-70",
          highlight: false,
        },
      ];

  for (const item of items) {
    const track = el("div", "signal-track");
    const bar = el("div", `signal-bar ${item.width}${item.highlight ? " highlight" : ""}`);
    bar.append(el("strong", "", item.count), el("span", "", item.label));
    track.append(bar);
    container.append(track);
  }
}

/**
 * Render live side-by-side city comparison cards on the Analytics view.
 * @param {Array<{ city: City, aqi: number | null }>} rows
 * @param {string} activeCityId
 * @param {(cityId: string) => void} onPickCity
 */
export function renderCityComparison(rows, activeCityId, onPickCity) {
  const container = $("#city-compare-list");
  container.replaceChildren();
  if (!rows.length) {
    container.append(el("p", "source-caption", "Could not load city comparison right now."));
    return;
  }
  for (const row of rows) {
    const cat = category(row.aqi);
    const btn = el("button", `compare-card${row.city.id === activeCityId ? " current" : ""}`);
    btn.type = "button";
    btn.append(
      el("span", "row-key", row.city.name),
      el("strong", "", isFiniteNumber(row.aqi) ? String(row.aqi) : "—"),
      el("span", `status-tag ${cat.tone}`, cat.label.toUpperCase()),
    );
    btn.addEventListener("click", () => onPickCity(row.city.id));
    container.append(btn);
  }
}
