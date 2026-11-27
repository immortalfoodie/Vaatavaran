/**
 * Google Air Quality API (500 m sensor-fused grid) client.
 */
import { category } from "../public/engine.js";
import { usAqiFromPm } from "../public/aqi-scales.js";
import { isRecord } from "../public/guard.js";
import { HOUR_MS, MINUTE_MS } from "../public/time.js";
import { fetchJson } from "./http.mjs";

/** @typedef {import("../public/types.js").City} City */
/** @typedef {import("../public/types.js").Air} Air */

const GOOGLE_AIR_URL = "https://airquality.googleapis.com/v1/currentConditions:lookup";
const MAX_READING_AGE_MS = 6 * HOUR_MS;
const MAX_CLOCK_SKEW_MS = 15 * MINUTE_MS;
const MAX_LABEL_LENGTH = 60;
/** Indexes that are not a regional "local" AQI and must not be shown as one. */
const NON_LOCAL_INDEX_CODES = new Set(["uaqi", "usa_epa"]);

/**
 * Concentration (µg/m³, one decimal) for a pollutant code, or null when missing/invalid.
 * @param {unknown} pollutants Google `pollutants` array.
 * @param {string} code Pollutant code, e.g. "pm25".
 * @returns {number | null}
 */
function readConcentration(pollutants, code) {
  const list = Array.isArray(pollutants) ? pollutants : [];
  const item = list.find((entry) => isRecord(entry) && entry.code === code);
  const concentration = isRecord(item) && isRecord(item.concentration) ? item.concentration : null;
  const value = concentration?.value;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Number(value.toFixed(1))
    : null;
}

/**
 * Regional index (e.g. India NAQI) shown beside US AQI, excluding universal/US indexes.
 * @param {unknown[]} indexes Google `indexes` array.
 * @returns {{ name: string, aqi: number, category: string } | null}
 */
function readLocalIndex(indexes) {
  const local = indexes.find(
    (idx) => isRecord(idx) && typeof idx.code === "string" && !NON_LOCAL_INDEX_CODES.has(idx.code),
  );
  if (!isRecord(local) || typeof local.aqi !== "number" || !Number.isFinite(local.aqi)) return null;
  return {
    name: String(local.displayName || local.code).slice(0, MAX_LABEL_LENGTH),
    aqi: Math.round(local.aqi),
    category: String(local.category || "").slice(0, MAX_LABEL_LENGTH),
  };
}

/**
 * Parse a Google Air Quality `currentConditions:lookup` payload into Vaatavaran's US AQI shape.
 * @param {unknown} payload Raw provider payload.
 * @param {City} city Requested city.
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {Air}
 */
export function parseGoogleAir(payload, city, now = Date.now()) {
  if (!isRecord(payload)) {
    throw new Error("Google Air Quality data unavailable");
  }
  const observed = Date.parse(typeof payload.dateTime === "string" ? payload.dateTime : "");
  if (
    !Number.isFinite(observed) ||
    now - observed > MAX_READING_AGE_MS ||
    observed - now > MAX_CLOCK_SKEW_MS
  ) {
    throw new Error("Google Air Quality reading is missing or stale");
  }
  const pm25 = readConcentration(payload.pollutants, "pm25");
  const pm10 = readConcentration(payload.pollutants, "pm10");
  const indexes = Array.isArray(payload.indexes) ? payload.indexes : [];
  const usaIdx = indexes.find((idx) => isRecord(idx) && idx.code === "usa_epa");
  const usaAqi = isRecord(usaIdx) && typeof usaIdx.aqi === "number" ? usaIdx.aqi : null;
  // Prefer Google's official US EPA NowCast index; otherwise compute it from PM concentrations.
  const aqi =
    usaAqi !== null && Number.isFinite(usaAqi) ? Math.round(usaAqi) : usAqiFromPm(pm25, pm10);

  if (category(aqi).level < 0) throw new Error("Google Air Quality AQI could not be determined");

  return {
    city: city.id,
    mode: "live",
    aqi,
    pm25,
    pm10,
    hourly: [],
    localIndex: readLocalIndex(indexes),
    observedAt: new Date(observed).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    source: {
      kind: "google",
      name: "Google Air Quality API",
      url: "https://developers.google.com/maps/documentation/air-quality",
      resolutionKm: 0.5,
      attributions: [],
    },
  };
}

/**
 * Look up current conditions for one city. The key travels in a header, never in the URL,
 * so it cannot leak into proxy or access logs.
 * @param {typeof fetch} fetcher Injected fetch implementation.
 * @param {string} apiKey Server-side Google Air Quality API key.
 * @param {City} city Requested city.
 * @param {number} now Current time in ms.
 * @returns {Promise<Air>}
 */
export async function fetchGoogleAir(fetcher, apiKey, city, now) {
  const payload = await fetchJson(
    fetcher,
    GOOGLE_AIR_URL,
    "Google Air Quality service unavailable",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        location: { latitude: city.lat, longitude: city.lon },
        extraComputations: ["POLLUTANT_CONCENTRATION", "LOCAL_AQI"],
        customLocalAqis: [{ regionCode: "in", aqi: "usa_epa" }],
        universalAqi: true,
      }),
    },
  );
  return parseGoogleAir(payload, city, now);
}
