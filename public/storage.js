/**
 * Browser-local persistence and plain-text plan export / clipboard helpers.
 */
import { makePlan } from "./engine.js";
import { el } from "./dom.js";
import { isRecord } from "./guard.js";
import { SECOND_MS } from "./time.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Profile} Profile */
/** @typedef {import("./types.js").DataMode} DataMode */

const STORAGE_KEY = "vaatavaran-v1";
/** Keep the object URL alive long enough for the browser to start the download. */
const DOWNLOAD_URL_TTL_MS = SECOND_MS;
const COMMUNITY_ACTIONS = [
  "• Keep school gates idle-free.",
  "• Combine essential journeys and share rides where practical.",
  "• Avoid outdoor burning; follow local advisories.",
  "• Help neighbours identify cleaner indoor public spaces.",
];

/**
 * Read a JSON value from localStorage.
 * @param {string} key
 * @returns {unknown} Parsed value, or null when missing, corrupt or storage is unavailable.
 */
export function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Write a JSON value to localStorage.
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} False when storage is unavailable (private mode, quota, disabled).
 */
export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a key from localStorage, ignoring disabled storage.
 * @param {string} key
 */
export function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}

/**
 * Saved app state (preferences, city, today's checklist).
 * @returns {Record<string, unknown>} Saved object, or {} when missing, corrupt or unavailable.
 */
export function loadSavedState() {
  const value = loadJson(STORAGE_KEY);
  return isRecord(value) ? value : {};
}

/**
 * Persist a state snapshot.
 * @param {Record<string, unknown>} snapshot
 * @returns {boolean} False when storage is unavailable.
 */
export const saveState = (snapshot) => saveJson(STORAGE_KEY, snapshot);

/** Clear saved preferences and daily completion. */
export const clearSavedState = () => removeKey(STORAGE_KEY);

/**
 * Format a privacy-safe plain-text daily or community checklist.
 * Explicit health preferences (sensitivity) are never written to the export.
 * @param {object} options
 * @param {Air} options.air
 * @param {Profile} options.profile
 * @param {City} options.city
 * @param {DataMode} options.mode
 * @param {string} options.day Local date key (YYYY-MM-DD).
 * @param {boolean} [options.community] Export the shareable community checklist instead.
 * @returns {string}
 */
export function buildPlanText({ air, profile, city, mode, day, community = false }) {
  const plan = makePlan(air, profile);
  const station = air.source?.kind === "station";
  return [
    "VAATAVARAN · DAILY CLEANER-AIR PLAN",
    `${city.name} · ${day}`,
    station
      ? "Based on current station guidance. Check the source for the latest numeric reading."
      : `${mode.toUpperCase()} DATA · US AQI ${air.aqi ?? "unavailable"} · ${plan.category.label}`,
    "",
    ...(community
      ? COMMUNITY_ACTIONS
      : plan.cards.flatMap((c, i) => [`${i + 1}. ${c.title}`, c.action, ""])),
    "",
    station
      ? `Station source: ${air.source?.url || "https://waqi.info"}. Numeric station data is not exported.`
      : "Demo data is illustrative. Live readings reflect the selected air-quality provider.",
    "US AQI differs from India AQI. General educational guidance, not medical advice.",
  ].join("\n");
}

/**
 * Trigger a client-side .txt download of the formatted checklist.
 * @param {string} text
 * @param {boolean} [community]
 */
export function downloadPlanText(text, community = false) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = el("a");
  link.href = url;
  link.download = `vaatavaran-${community ? "community" : "daily"}-plan.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_TTL_MS);
}
