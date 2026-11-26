/**
 * Stateless dashboard view renderers.
 * Receives normalized data and callbacks; never fetches or persists state.
 */
import { category, makePlan, activityReadiness } from "./engine.js";
import {
  el,
  formatTime,
  renderForecast,
  renderExposureMatrix,
  renderImpact,
} from "./charts.js";

export { el, renderForecast, renderImpact };

const $ = (selector) => document.querySelector(selector);
const WHO_PM25_24H_UG_M3 = 15;
const METER_SEGMENTS = 20;
const METER_MAX_AQI = 350;

const COMMUTE_LABELS = {
  car: "Solo car",
  transit: "Public transit",
  walk: "Walk / cycle",
  home: "Work from home",
};

/** Return human-readable display strings for the active air-quality source. */
function describeSource(mode, air, city) {
  const kind = air.source?.kind || "model";
  const hasReading = Number.isFinite(air.aqi);

  if (mode === "demo") {
    return {
      heading: hasReading ? "DEMO SCENARIO" : "AIR DATA UNAVAILABLE",
      typeMain: "Demo ",
      typeSub: "scenario",
      badge: hasReading ? "DEMO DATA" : "CHECKING DATA",
      description: "Illustrative winter-smog scenario · not current conditions",
      observed: "Demo scenario · switch to live source for current data",
      warning: "Illustrative scenario. Do not use these numbers as current conditions.",
    };
  }

  const formattedObs = air.observedAt
    ? new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: city.zone,
    }).format(new Date(air.observedAt))
    : null;
  const fetched = air.fetchedAt ? formatTime(city, air.fetchedAt) : "";

  if (kind === "google") {
    const localNote = air.localIndex
      ? ` · ${air.localIndex.name}: ${air.localIndex.aqi}`
      : "";
    return {
      heading: hasReading ? "GOOGLE AIR QUALITY (500M)" : "AIR DATA UNAVAILABLE",
      typeMain: "Google ",
      typeSub: "500m live",
      badge: hasReading ? "GOOGLE 500M LIVE" : "CHECKING DATA",
      description: `Google Air Quality · 500 m sensor-fused grid${localNote}`,
      observed: formattedObs
        ? `Google updated ${formattedObs} · fetched ${fetched}`
        : "No valid reading for the selected source",
      warning:
        "Official US EPA NowCast AQI from Google Air Quality (500 m sensor-fused grid). Hourly PM2.5/PM10 shown separately.",
    };
  }

  if (kind === "station") {
    return {
      heading: hasReading ? "STATION-REPORTED AQI" : "AIR DATA UNAVAILABLE",
      typeMain: "Station ",
      typeSub: "report",
      badge: hasReading ? "STATION LIVE" : "CHECKING DATA",
      description: `WAQI · station ${air.source.distanceKm} km from city centre`,
      observed: formattedObs
        ? `Station reported ${formattedObs} · fetched ${fetched}`
        : "No valid reading for the selected source",
      warning:
        "PM values are pollutant-specific US AQI, not concentrations (µg/m³). One nearby station, not a city-wide average. Data is provisional.",
    };
  }

  return {
    heading: hasReading ? "REGIONAL FORECAST ESTIMATE" : "AIR DATA UNAVAILABLE",
    typeMain: "Model ",
    typeSub: "forecast",
    badge: hasReading ? "MODEL LIVE" : "CHECKING DATA",
    description: "Copernicus CAMS global model · ~45 km resolution",
    observed: formattedObs
      ? `Model valid ${formattedObs} · fetched ${fetched}`
      : "No valid reading for the selected source",
    warning: "Not a street-level sensor reading. Local pollution may differ substantially.",
  };
}

function getSourceLabel(mode, kind) {
  if (mode === "demo") return "Demo scenario";
  if (kind === "google") return "Google Air Quality (500m)";
  if (kind === "station") return "Station-reported AQI";
  return "Regional forecast estimate";
}

/** Coordinate all dashboard sections from current state. */
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

function renderHeaderMeta({ air, plan, profile, city }) {
  const hasReading = Number.isFinite(air.aqi);
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
  $("#header-aqi-count").textContent = hasReading ? String(Math.round(air.aqi)) : "—";
  $("#header-aqi-label").textContent = plan.category.label.toUpperCase();
}

function renderAirCard({ air, forecastAir, plan, city, mode, station }) {
  const hasReading = Number.isFinite(air.aqi);
  const meta = describeSource(mode, air, city);

  $("#air-heading").textContent = meta.heading;
  $("#air-location").textContent = station ? air.source.station : `${city.name} · ${city.region}`;
  $("#aqi").textContent = hasReading ? String(Math.round(air.aqi)) : "—";
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

  for (const [id, value] of [
    ["pm25", station ? air.pollutantAqi?.pm25 : air.pm25],
    ["pm10", station ? air.pollutantAqi?.pm10 : air.pm10],
  ]) {
    if (Number.isFinite(value)) {
      $("#" + id).replaceChildren(
        document.createTextNode(`${Math.round(value)} `),
        el("small", "", station ? "US AQI" : "µg/m³"),
      );
    } else {
      $("#" + id).replaceChildren(el("small", "", "Not reported"));
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

function resolveDelta24h(air, forecastAir) {
  if (Number.isFinite(air.delta24h)) {
    return { value: air.delta24h, suffix: "VS YESTERDAY" };
  }
  if (Number.isFinite(forecastAir?.delta24h)) {
    return { value: forecastAir.delta24h, suffix: "MODEL 24H" };
  }
  return null;
}

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

function renderWhoContext(air, station) {
  const whoEl = $("#who-context");
  if (!station && Number.isFinite(air.pm25) && air.pm25 > 0) {
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

function renderSegmentedMeter(aqi) {
  const container = $("#aqi-meter");
  container.replaceChildren();
  const filled = Number.isFinite(aqi)
    ? Math.max(1, Math.min(METER_SEGMENTS, Math.round((aqi / METER_MAX_AQI) * METER_SEGMENTS)))
    : 0;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    container.append(el("span", i < filled ? "seg-block filled" : "seg-block"));
  }
}

function renderAttribution(air, mode) {
  const container = $("#source-attribution");
  container.replaceChildren();
  if (mode === "demo" || !air.source) return;
  const credits = [{ name: air.source.name, url: air.source.url }, ...(air.source.attributions || [])];
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

function renderPriorities({ plan, completed, onComplete }) {
  const overviewList = $("#priorities");
  const fullList = $("#full-plan");
  overviewList.replaceChildren();
  fullList.replaceChildren();

  const toggleAction = (id, checked) => {
    onComplete(id, checked);
    updateCompletion(completed);
    document.querySelectorAll(`[data-action-id="${id}"]`).forEach((node) => node.classList.toggle("done", checked));
    document.querySelectorAll(`input[data-action-check="${id}"]`).forEach((box) => {
      box.checked = checked;
    });
  };

  for (const card of plan.cards) {
    const isDone = completed.has(card.id);
    overviewList.append(buildOverviewPriorityCard(card, isDone, toggleAction));
    fullList.append(buildFullPlanCard(card, isDone, toggleAction));
  }
  updateCompletion(completed);
}

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

function buildOverviewPriorityCard(card, isDone, onToggle) {
  const node = el("article", `priority-card${isDone ? " done" : ""}`);
  node.dataset.actionId = card.id;
  const top = el("div", "priority-card-top");
  top.append(el("span", "priority-card-kicker", `${card.kind} · ${card.time}`), buildCheckbox(card, isDone, onToggle));
  const foot = el("div", "priority-card-foot");
  const link = el("a", "", "[WHY & DETAILS ↗]");
  link.href = `#plan/${card.id}`;
  link.setAttribute("aria-label", `Explore: ${card.title}`);
  foot.append(el("span", "row-key", card.time), link);
  node.append(top, el("h3", "", card.title), el("p", "", card.action.split(/(?<=\.)\s+/)[0]), foot);
  return node;
}

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
    el("div", "plan-impact", "↗ " + card.impact),
  );
  full.append(body, buildCheckbox(card, isDone, onToggle));
  return full;
}

function updateCompletion(completed) {
  const count = completed.size;
  $("#completion").textContent = `${count} OF 3 COMPLETED`;
  $("#header-done-count").textContent = String(count);
  $("#brief-progress").textContent = `${count} OF 3 DONE`;
}

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

function barWidthClass(count) {
  if (count > 6) return "bar-w-85";
  if (count > 2) return "bar-w-70";
  return "bar-w-55";
}

function renderSignals(air, plan, completed) {
  const container = $("#signal-bars");
  container.replaceChildren();
  const hours = air.hourly || [];
  const highHours = hours.filter((h) => category(h.aqi).level >= 3).length;
  const modHours = hours.filter((h) => [1, 2].includes(category(h.aqi).level)).length;
  const goodHours = hours.filter((h) => category(h.aqi).level === 0).length;

  const items = hours.length
    ? [
      { count: String(modHours).padStart(2, "0"), label: "CAUTION HOURS", width: barWidthClass(modHours), highlight: false },
      { count: String(highHours).padStart(2, "0"), label: "HIGH-RISK HOURS", width: highHours > 0 ? "bar-w-100" : "bar-w-55", highlight: highHours > 0 },
      { count: String(goodHours).padStart(2, "0"), label: "GOOD-AIR HOURS", width: barWidthClass(goodHours), highlight: false },
    ]
    : [
      { count: String(completed.size).padStart(2, "0"), label: "ACTIONS COMPLETED", width: "bar-w-55", highlight: false },
      { count: Number.isFinite(air.aqi) ? String(Math.round(air.aqi)) : "—", label: plan.category.label.toUpperCase(), width: "bar-w-100", highlight: plan.high },
      { count: String(Math.max(0, 3 - completed.size)).padStart(2, "0"), label: "ACTIONS REMAINING", width: "bar-w-70", highlight: false },
    ];

  for (const item of items) {
    const track = el("div", "signal-track");
    const bar = el("div", `signal-bar ${item.width}${item.highlight ? " highlight" : ""}`);
    bar.append(el("strong", "", item.count), el("span", "", item.label));
    track.append(bar);
    container.append(track);
  }
}

/** Render live side-by-side city comparison cards on the Analytics view. */
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
      el("strong", "", Number.isFinite(row.aqi) ? String(row.aqi) : "—"),
      el("span", `status-tag ${cat.tone}`, cat.label.toUpperCase()),
    );
    btn.addEventListener("click", () => onPickCity(row.city.id));
    container.append(btn);
  }
}
