/**
 * "Your impact this month" panel on the Analytics view.
 */
import { $, el } from "./dom.js";

/** @typedef {import("./history.js").MonthSummary} MonthSummary */

/**
 * Month name for a YYYY-MM key, e.g. "November 2026".
 * @param {string} month
 * @returns {string}
 */
export function monthLabel(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * Stat tiles for a month. Exposure is shown only when at least one plan was followed.
 * @param {MonthSummary} summary
 * @returns {Array<[value: string, label: string]>}
 */
export function impactTiles(summary) {
  const tiles = /** @type {Array<[string, string]>} */ ([
    [String(summary.activeDays), plural(summary.activeDays, "ACTIVE DAY", "ACTIVE DAYS")],
    [
      String(summary.actionsCompleted),
      plural(summary.actionsCompleted, "ACTION COMPLETED", "ACTIONS COMPLETED"),
    ],
    [
      String(summary.activitiesMoved),
      plural(
        summary.activitiesMoved,
        "ACTIVITY MOVED TO CLEANER HOURS",
        "ACTIVITIES MOVED TO CLEANER HOURS",
      ),
    ],
    [summary.co2Kg.toFixed(1), "KG CO₂ AVOIDED (EST.)"],
  ]);
  if (summary.exposureReduction !== null) {
    tiles.push([
      `${Math.round(summary.exposureReduction * 100)}%`,
      "FEWER PARTICLES BREATHED IN PLANNED ACTIVITIES (EST.)",
    ]);
  }
  return tiles;
}

/**
 * Render the monthly totals.
 * @param {MonthSummary} summary
 * @param {string} month YYYY-MM
 */
export function renderMonthlyImpact(summary, month) {
  $("#impact-month").textContent = monthLabel(month).toUpperCase();
  const container = $("#impact-tiles");
  const empty = summary.activeDays === 0;
  $("#impact-empty").hidden = !empty;
  container.hidden = empty;
  container.replaceChildren(
    ...impactTiles(summary).map(([value, label]) => {
      const tile = el("div", "impact-tile");
      tile.append(el("strong", "", value), el("span", "", label));
      return tile;
    }),
  );
}
