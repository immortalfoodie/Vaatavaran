/**
 * Stateless dashboard view coordinator.
 * Delegates the Air Quality card to air-card-view.js and priorities to priorities-view.js.
 */
import { category, makePlan, activityReadiness, isFiniteNumber, LEVEL } from "./engine.js";
import { renderForecast, renderExposureMatrix, renderImpact } from "./charts.js";
import { formatTime } from "./format.js";
import { $, $input, el } from "./dom.js";
import { formatAqi, getSourceLabel, renderAirCard, renderFreshness } from "./air-card-view.js";
import { TOTAL_ACTIONS, renderPriorities, renderProfileSummary } from "./priorities-view.js";

export { renderFreshness };

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").Profile} Profile */
/** @typedef {import("./types.js").DataMode} DataMode */

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
  renderAirCard({ air, forecastAir, plan, city, mode, station });
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
  $input("#impact-distance").value = String(profile.distance);
  renderImpact(profile.distance);
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
