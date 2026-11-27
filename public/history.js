/**
 * Personal impact over time, kept only in this browser.
 *
 * The pure functions take and return plain history objects so they are easy to test; the
 * small storage wrappers at the end are the only code that touches localStorage.
 */
import { loadJson, removeKey, saveJson } from "./storage.js";

const HISTORY_KEY = "vaatavaran-history";
/** Days kept on the device; older entries are dropped on every write. */
export const RETENTION_DAYS = 120;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_IDS = new Set(["move", "commute", "home"]);
const MAX_CO2_KG_PER_DAY = 100;

/**
 * @typedef {object} PlanRecord Totals from a day plan the household chose to follow.
 * @property {number} moved
 * @property {number} indoors
 * @property {number} baselineDose
 * @property {number} plannedDose
 */

/**
 * @typedef {object} DayRecord
 * @property {string[]} completed Checklist action ids completed that day.
 * @property {number} co2Kg Illustrative CO₂ avoided by the completed commute action.
 * @property {PlanRecord | null} plan
 */

/** @typedef {{ days: Record<string, DayRecord> }} History */

/**
 * @typedef {object} MonthSummary
 * @property {number} activeDays Days with at least one action or followed plan.
 * @property {number} actionsCompleted
 * @property {number} co2Kg
 * @property {number} activitiesMoved
 * @property {number} movedIndoors
 * @property {number | null} exposureReduction Fraction of particles avoided across followed
 *   plans (0–1), or null when no plan was followed.
 */

/** @returns {History} */
export const emptyHistory = () => ({ days: {} });

/** @param {unknown} n */
const nonNegative = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);

/**
 * @param {any} raw
 * @returns {PlanRecord | null}
 */
function normalizePlanRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    moved: nonNegative(raw.moved),
    indoors: nonNegative(raw.indoors),
    baselineDose: nonNegative(raw.baselineDose),
    plannedDose: nonNegative(raw.plannedDose),
  };
}

/**
 * Coerce stored (possibly corrupted or tampered) data into a valid history.
 * @param {unknown} raw
 * @returns {History}
 */
export function normalizeHistory(raw) {
  const days = /** @type {any} */ (raw)?.days;
  if (!days || typeof days !== "object") return emptyHistory();
  /** @type {Record<string, DayRecord>} */
  const clean = {};
  for (const [day, record] of Object.entries(days)) {
    if (!DAY_KEY_PATTERN.test(day) || !record || typeof record !== "object") continue;
    clean[day] = {
      completed: Array.isArray(record.completed)
        ? [...new Set(record.completed.filter((/** @type {string} */ id) => ACTION_IDS.has(id)))]
        : [],
      co2Kg: Math.min(MAX_CO2_KG_PER_DAY, nonNegative(record.co2Kg)),
      plan: normalizePlanRecord(record.plan),
    };
  }
  return { days: clean };
}

/**
 * Keep only the most recent RETENTION_DAYS entries.
 * @param {History} history
 * @returns {History}
 */
function prune(history) {
  const recent = Object.keys(history.days).sort().slice(-RETENTION_DAYS);
  return { days: Object.fromEntries(recent.map((day) => [day, history.days[day]])) };
}

/**
 * @param {History} history
 * @param {string} day
 * @returns {DayRecord}
 */
const dayRecord = (history, day) => history.days[day] ?? { completed: [], co2Kg: 0, plan: null };

/**
 * Record today's checklist state (replaces, so unticking an action removes it).
 * @param {History} history
 * @param {string} day YYYY-MM-DD in the city's time zone.
 * @param {{ completed: Iterable<string>, co2Kg: number }} entry
 * @returns {History}
 */
export function recordChecklist(history, day, { completed, co2Kg }) {
  const record = {
    ...dayRecord(history, day),
    completed: [...completed].filter((id) => ACTION_IDS.has(id)),
    co2Kg: Math.min(MAX_CO2_KG_PER_DAY, nonNegative(co2Kg)),
  };
  return prune({ days: { ...history.days, [day]: record } });
}

/**
 * Record a followed day plan (replaces any earlier plan that day, so re-planning never
 * double counts).
 * @param {History} history
 * @param {string} day
 * @param {PlanRecord} plan
 * @returns {History}
 */
export function recordPlan(history, day, plan) {
  const record = { ...dayRecord(history, day), plan: normalizePlanRecord(plan) };
  return prune({ days: { ...history.days, [day]: record } });
}

/**
 * Totals for one calendar month.
 * @param {History} history
 * @param {string} month YYYY-MM.
 * @returns {MonthSummary}
 */
export function summarizeMonth(history, month) {
  const records = Object.entries(history.days)
    .filter(([day]) => day.startsWith(`${month}-`))
    .map(([, record]) => record);
  const plans = records.flatMap((r) => (r.plan ? [r.plan] : []));
  const baseline = plans.reduce((t, p) => t + p.baselineDose, 0);
  const planned = plans.reduce((t, p) => t + p.plannedDose, 0);
  return {
    activeDays: records.filter((r) => r.completed.length > 0 || r.plan).length,
    actionsCompleted: records.reduce((t, r) => t + r.completed.length, 0),
    co2Kg: Number(records.reduce((t, r) => t + r.co2Kg, 0).toFixed(2)),
    activitiesMoved: plans.reduce((t, p) => t + p.moved, 0),
    movedIndoors: plans.reduce((t, p) => t + p.indoors, 0),
    exposureReduction: baseline > 0 ? Math.max(0, 1 - planned / baseline) : null,
  };
}

/** @returns {History} */
export const loadHistory = () => normalizeHistory(loadJson(HISTORY_KEY));

/**
 * @param {History} history
 * @returns {boolean} False when browser storage is unavailable.
 */
export const saveHistory = (history) => saveJson(HISTORY_KEY, history);

/** Delete all stored history. */
export const clearHistory = () => removeKey(HISTORY_KEY);
