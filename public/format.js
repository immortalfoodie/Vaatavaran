/**
 * Locale-aware date and time formatting. Pure functions; no DOM access.
 */
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time.js";

const LOCALE = "en-IN";
/** Below this age, "just now" reads better than "0 minutes ago". */
const JUST_NOW_MS = MINUTE_MS;

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/**
 * Units from largest to smallest; the first unit the age reaches is used.
 * @type {ReadonlyArray<[unit: Intl.RelativeTimeFormatUnit, ms: number]>}
 */
const RELATIVE_UNITS = [
  ["day", DAY_MS],
  ["hour", HOUR_MS],
  ["minute", MINUTE_MS],
];

/**
 * Format an ISO timestamp in the city's local time (e.g. "5:30 am").
 * @param {{ zone: string }} city
 * @param {string} time ISO timestamp.
 * @returns {string}
 */
export function formatTime(city, time) {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: city.zone,
  }).format(new Date(time));
}

/**
 * Format an ISO timestamp as a short hour label (e.g. "5 am").
 * @param {{ zone: string }} city
 * @param {string} time ISO timestamp.
 * @returns {string}
 */
export function formatShortHour(city, time) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "numeric", timeZone: city.zone }).format(
    new Date(time),
  );
}

/**
 * Human-readable age of a timestamp, e.g. "just now", "4 minutes ago", "yesterday".
 * Future timestamps (small clock skew between server and device) read as "just now".
 * @param {string | undefined} isoTime ISO timestamp.
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {string | null} Relative age, or null when the timestamp is missing or invalid.
 */
export function formatRelativeAge(isoTime, now = Date.now()) {
  const then = Date.parse(isoTime ?? "");
  if (!Number.isFinite(then)) return null;
  const age = now - then;
  if (age < JUST_NOW_MS) return "just now";
  const [unit, size] =
    RELATIVE_UNITS.find(([, ms]) => age >= ms) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return relativeFormatter.format(-Math.floor(age / size), unit);
}
