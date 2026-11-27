/**
 * Concentration → index conversions for the two AQI scales the app shows.
 * Pure functions shared by the browser and the server.
 *
 * - US EPA AQI (2024 PM2.5 revision): https://www.airnow.gov/aqi/aqi-basics/
 * - India CPCB National AQI (NAQI, 2014): six bands from Good to Severe.
 *   https://ies.gov.in/arthapedia/concept/national-air-quality-index
 */
import { isFiniteNumber } from "./engine.js";

/** @typedef {[cLow: number, cHigh: number, iLow: number, iHigh: number]} Breakpoint */

const INDEX_CEILING = 500;

/** @type {readonly Breakpoint[]} US EPA PM2.5 (µg/m³, 24 h) → US AQI. */
const US_PM25 = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 400],
  [325.5, 500.4, 401, 500],
];

/** @type {readonly Breakpoint[]} US EPA PM10 (µg/m³, 24 h) → US AQI. */
const US_PM10 = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 504, 301, 400],
  [505, 604, 401, 500],
];

/**
 * CPCB PM2.5 (µg/m³, 24 h) → NAQI. CPCB publishes "250+" for Severe; the 380 upper bound is
 * the convention used by CPCB's AQI calculator so the band can be interpolated.
 * @type {readonly Breakpoint[]}
 */
const NAQI_PM25 = [
  [0, 30, 0, 50],
  [31, 60, 51, 100],
  [61, 90, 101, 200],
  [91, 120, 201, 300],
  [121, 250, 301, 400],
  [251, 380, 401, 500],
];

/**
 * CPCB PM10 (µg/m³, 24 h) → NAQI. "430+" Severe uses the calculator's 510 upper bound.
 * @type {readonly Breakpoint[]}
 */
const NAQI_PM10 = [
  [0, 50, 0, 50],
  [51, 100, 51, 100],
  [101, 250, 101, 200],
  [251, 350, 201, 300],
  [351, 430, 301, 400],
  [431, 510, 401, 500],
];

/**
 * NAQI bands. `tone` reuses the app's six severity colours so both scales read consistently.
 * @type {ReadonlyArray<{ max: number, label: string, tone: string }>}
 */
const NAQI_BANDS = [
  { max: 50, label: "Good", tone: "good" },
  { max: 100, label: "Satisfactory", tone: "moderate" },
  { max: 200, label: "Moderately polluted", tone: "sensitive" },
  { max: 300, label: "Poor", tone: "unhealthy" },
  { max: 400, label: "Very poor", tone: "very" },
  { max: INDEX_CEILING, label: "Severe", tone: "hazardous" },
];

/**
 * Linear interpolation of a concentration onto an index scale.
 * The concentration is truncated to the precision the breakpoints are published at,
 * so values between two bands (e.g. 30.6 on a 0–30 / 31–60 table) fall in the lower band.
 * @param {unknown} value Concentration in µg/m³.
 * @param {readonly Breakpoint[]} breakpoints Ascending rows of [cLow, cHigh, iLow, iHigh].
 * @param {number} [decimals] Truncation precision of the published breakpoints.
 * @returns {number | null} Sub-index (capped at 500), or null for missing/invalid input.
 */
export function subIndex(value, breakpoints, decimals = 0) {
  if (!isFiniteNumber(value) || value < 0) return null;
  const factor = 10 ** decimals;
  const c = Math.floor(value * factor) / factor;
  const row = breakpoints.find(([, cHigh]) => c <= cHigh);
  if (!row) return INDEX_CEILING;
  const [cLow, cHigh, iLow, iHigh] = row;
  return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (Math.max(c, cLow) - cLow) + iLow);
}

/**
 * Overall index as the highest pollutant sub-index, or null if neither pollutant is valid.
 * @param {number | null} a
 * @param {number | null} b
 * @returns {number | null}
 */
function highestSubIndex(a, b) {
  if (a === null && b === null) return null;
  return Math.max(a ?? -1, b ?? -1);
}

/**
 * US EPA AQI from PM2.5 and PM10 concentrations.
 * @param {number | null | undefined} pm25 PM2.5 in µg/m³.
 * @param {number | null | undefined} pm10 PM10 in µg/m³.
 * @returns {number | null}
 */
export function usAqiFromPm(pm25, pm10) {
  return highestSubIndex(subIndex(pm25, US_PM25, 1), subIndex(pm10, US_PM10, 0));
}

/**
 * @typedef {object} NaqiReading
 * @property {number} aqi India NAQI value (0–500).
 * @property {string} label CPCB category name.
 * @property {string} tone Shared severity tone used for styling.
 * @property {"PM2.5" | "PM10"} dominant Pollutant with the highest sub-index.
 */

/**
 * India CPCB National AQI estimated from PM2.5 and PM10 only.
 * Official NAQI uses 24-hour averages and up to eight pollutants, so callers must label
 * this as an estimate when fed hourly or partial data.
 * @param {number | null | undefined} pm25 PM2.5 in µg/m³.
 * @param {number | null | undefined} pm10 PM10 in µg/m³.
 * @returns {NaqiReading | null}
 */
export function indiaNaqiFromPm(pm25, pm10) {
  const pm25Index = subIndex(pm25, NAQI_PM25);
  const pm10Index = subIndex(pm10, NAQI_PM10);
  const aqi = highestSubIndex(pm25Index, pm10Index);
  if (aqi === null) return null;
  const band = NAQI_BANDS.find((b) => aqi <= b.max) ?? NAQI_BANDS[NAQI_BANDS.length - 1];
  return {
    aqi,
    label: band.label,
    tone: band.tone,
    dominant: (pm25Index ?? -1) >= (pm10Index ?? -1) ? "PM2.5" : "PM10",
  };
}
