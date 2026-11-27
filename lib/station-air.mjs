/**
 * WAQI ground-station client: parses one nearby station and preserves its provenance.
 */
import { category } from "../public/engine.js";
import { HOUR_MS, MINUTE_MS } from "../public/time.js";
import { fetchJson } from "./http.mjs";

/** @typedef {import("../public/types.js").City} City */
/** @typedef {import("../public/types.js").Air} Air */

const EARTH_RADIUS_KM = 6371;
const MAX_STATION_DISTANCE_KM = 75;
const MAX_READING_AGE_MS = 3 * HOUR_MS;
const MAX_CLOCK_SKEW_MS = 15 * MINUTE_MS;
const MAX_TEXT_LENGTH = 200;
const MAX_ATTRIBUTIONS = 10;

/**
 * Accept only http(s) URLs so provider data cannot inject `javascript:` links.
 * @param {unknown} value
 * @returns {string | null}
 */
function safeLink(value) {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Great-circle (haversine) distance between a city and a [lat, lon] pair.
 * @param {{ lat: number, lon: number }} from
 * @param {number[]} to
 * @returns {number} Distance in kilometres.
 */
function distanceKm(from, to) {
  const radians = (/** @type {number} */ degrees) => (degrees * Math.PI) / 180;
  const [lat, lon] = to;
  const a =
    Math.sin(radians(lat - from.lat) / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(lat)) *
      Math.sin(radians(lon - from.lon) / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Validate the headline AQI (WAQI sends numbers or numeric strings, sometimes "-").
 * @param {number | string} raw
 * @returns {number}
 */
function readAqi(raw) {
  const aqi = Number(raw);
  if (category(aqi).level < 0) throw new Error("Station reading is missing, stale or invalid");
  return aqi;
}

/**
 * Validate the reading time: not older than 3 h and not meaningfully in the future.
 * @param {any} time WAQI `time` object ({ iso } or { s, tz }).
 * @param {number} now
 * @returns {number} Observation time in ms.
 */
function readObservedTime(time, now) {
  const fromParts = time?.s && time?.tz ? `${time.s.replace(" ", "T")}${time.tz}` : "";
  const observed = Date.parse(time?.iso || fromParts);
  const fresh = now - observed <= MAX_READING_AGE_MS && observed - now <= MAX_CLOCK_SKEW_MS;
  if (!Number.isFinite(observed) || !fresh) {
    throw new Error("Station reading is missing, stale or invalid");
  }
  return observed;
}

/**
 * Validate station coordinates as a [lat, lon] pair.
 * @param {unknown} geo
 * @returns {number[]}
 */
function readCoordinates(geo) {
  const valid =
    Array.isArray(geo) &&
    geo.length === 2 &&
    geo.every(Number.isFinite) &&
    Math.abs(geo[0]) <= 90 &&
    Math.abs(geo[1]) <= 180;
  if (!valid) throw new Error("Station location unavailable");
  return geo;
}

/**
 * Keep only named attributions with safe links; at least one is required by WAQI's terms.
 * @param {unknown} list
 * @returns {Array<{ name: string, url: string | null }>}
 */
function readAttributions(list) {
  const attributions = (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.name === "string")
    .slice(0, MAX_ATTRIBUTIONS)
    .map((item) => ({ name: item.name.slice(0, MAX_TEXT_LENGTH), url: safeLink(item.url) }));
  if (!attributions.length) throw new Error("Station attribution unavailable");
  return attributions;
}

/**
 * Pollutant sub-index (US AQI) or null; never converted to a concentration.
 * @param {any} iaqi WAQI `iaqi` object.
 * @param {string} key Pollutant code.
 * @returns {number | null}
 */
function readPollutantIndex(iaqi, key) {
  const value = iaqi?.[key]?.v;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Parse a WAQI feed payload. WAQI pollutant fields are individual AQI values, NOT µg/m³.
 * @param {any} payload Raw provider payload.
 * @param {City} city Requested city.
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {Air}
 */
export function parseStationAir(payload, city, now = Date.now()) {
  const data = payload?.data;
  if (payload?.status !== "ok" || !data) throw new Error("Station data unavailable");
  if (!["number", "string"].includes(typeof data.aqi) || String(data.aqi).trim() === "") {
    throw new Error("Station data unavailable");
  }
  const aqi = readAqi(data.aqi);
  const observed = readObservedTime(data.time, now);
  const coordinates = readCoordinates(data.city?.geo);
  const distance = distanceKm(city, coordinates);
  if (distance > MAX_STATION_DISTANCE_KM) throw new Error("No nearby station available");
  const attributions = readAttributions(data.attributions);
  const name =
    typeof data.city.name === "string"
      ? data.city.name.slice(0, MAX_TEXT_LENGTH)
      : "Nearby station";

  return {
    city: city.id,
    mode: "live",
    aqi: Math.round(aqi),
    // Do not relabel sub-indices as mass concentrations or mix model PM into this card.
    pm25: null,
    pm10: null,
    hourly: [],
    pollutantAqi: {
      pm25: readPollutantIndex(data.iaqi, "pm25"),
      pm10: readPollutantIndex(data.iaqi, "pm10"),
    },
    observedAt: new Date(observed).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    source: {
      kind: "station",
      name: "World Air Quality Index",
      station: name,
      url: safeLink(data.city.url),
      coordinates,
      distanceKm: Number(distance.toFixed(1)),
      attributions,
    },
  };
}

/**
 * Fetch the nearest WAQI station for a city. The token is fixed server-side.
 * @param {typeof fetch} fetcher Injected fetch implementation.
 * @param {string} token WAQI API token.
 * @param {City} city Requested city.
 * @param {number} now Current time in ms.
 * @returns {Promise<Air>}
 */
export async function fetchStationAir(fetcher, token, city, now) {
  const url = new URL(`https://api.waqi.info/feed/geo:${city.lat};${city.lon}/`);
  url.searchParams.set("token", token);
  const payload = await fetchJson(fetcher, url, "Station provider unavailable");
  return parseStationAir(payload, city, now);
}
