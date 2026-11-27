/**
 * Air quality orchestration service: coordinates Google Air (500m), WAQI stations,
 * Open-Meteo / CAMS regional forecasts, geocoding, and 10-minute in-memory caching.
 */
import { category, demoAir } from "../public/engine.js";
import { isRecord } from "../public/guard.js";
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "../public/time.js";
import { createMemo, fetchJson } from "./http.mjs";
import { fetchStationAir } from "./station-air.mjs";
import { fetchGoogleAir } from "./google-air.mjs";

/** @typedef {import("../public/types.js").City} City */
/** @typedef {import("../public/types.js").Air} Air */
/** @typedef {import("../public/types.js").DataMode} DataMode */

const CACHE_TTL_MS = 10 * MINUTE_MS;
const MAX_CACHE_ENTRIES = 200;
const MAX_MODEL_AGE_MS = 2 * HOUR_MS;
/** Hours of forecast returned: 12 for the outlook chart, 24 for day planning. */
const MAX_FORECAST_HOURS = 24;
const MAX_GEOCODE_RESULTS = 6;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const DEFAULT_ZONE = "Asia/Kolkata";
const OPEN_METEO_AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

/** @param {unknown} value */
const isValidAqi = (value) => category(/** @type {number} */ (value)).level >= 0;

/** @param {unknown} n */
const nonNegativeOrNull = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/**
 * Parse an Open-Meteo / CAMS hourly payload into Vaatavaran's air shape.
 * @param {unknown} data Raw provider payload.
 * @param {string} city City identifier echoed into the result.
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {Air}
 */
export function parseAir(data, city, now = Date.now()) {
  const hourly = isRecord(data) && isRecord(data.hourly) ? data.hourly : null;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.us_aqi)) {
    throw new Error("Invalid upstream data");
  }
  const aqiSeries = hourly.us_aqi;
  const pm25Series = Array.isArray(hourly.pm2_5) ? hourly.pm2_5 : [];
  const pm10Series = Array.isArray(hourly.pm10) ? hourly.pm10 : [];
  /** @type {Array<{ time: string, ts: number, aqi: unknown, pm25: unknown, pm10: unknown }>} */
  const rows = hourly.time.map((t, i) => ({
    time: new Date(Number(t) * SECOND_MS).toISOString(),
    ts: Number(t) * SECOND_MS,
    aqi: aqiSeries[i],
    pm25: pm25Series[i],
    pm10: pm10Series[i],
  }));
  const current = rows.filter((r) => r.ts <= now).at(-1);
  if (!current || now - current.ts > MAX_MODEL_AGE_MS || !isValidAqi(current.aqi)) {
    throw new Error("Missing or stale air quality");
  }
  const currentAqi = Math.round(Number(current.aqi));
  const targetYesterday = current.ts - DAY_MS;
  const yesterdayRow = rows.find(
    (r) => Math.abs(r.ts - targetYesterday) <= HOUR_MS && isValidAqi(r.aqi),
  );
  const yesterdayAqi = yesterdayRow ? Math.round(Number(yesterdayRow.aqi)) : null;

  return {
    city,
    mode: "live",
    source: {
      kind: "model",
      name: "Open-Meteo / CAMS",
      url: "https://open-meteo.com/en/docs/air-quality-api",
      resolutionKm: 45,
      pmAqiAveragingHours: 24,
    },
    fetchedAt: new Date(now).toISOString(),
    observedAt: current.time,
    aqi: currentAqi,
    yesterdayAqi,
    delta24h: yesterdayAqi === null ? null : currentAqi - yesterdayAqi,
    pm25: nonNegativeOrNull(current.pm25),
    pm10: nonNegativeOrNull(current.pm10),
    hourly: rows
      .filter((r) => r.ts >= current.ts && isValidAqi(r.aqi))
      .slice(0, MAX_FORECAST_HOURS)
      .map(({ time, aqi, pm25 }) => ({
        time,
        aqi: Math.round(Number(aqi)),
        pm25: nonNegativeOrNull(pm25),
      })),
  };
}

/**
 * Search cities via Open-Meteo Geocoding API (no API key required).
 * @param {typeof fetch} fetcher Injected fetch implementation.
 * @param {unknown} query Free-text place name.
 * @returns {Promise<Array<{ name: string, region: string, lat: number, lon: number, zone: string }>>}
 */
export async function searchCities(fetcher, query) {
  const clean = String(query || "").trim();
  if (clean.length < MIN_QUERY_LENGTH || clean.length > MAX_QUERY_LENGTH) return [];
  const url = new URL(OPEN_METEO_GEOCODE_URL);
  url.search = new URLSearchParams({
    name: clean,
    count: String(MAX_GEOCODE_RESULTS),
    language: "en",
    format: "json",
  }).toString();
  const data = await fetchJson(fetcher, url, "Location search unavailable");
  if (!isRecord(data) || !Array.isArray(data.results)) return [];
  return data.results
    .filter(
      (r) =>
        isRecord(r) &&
        typeof r.name === "string" &&
        typeof r.latitude === "number" &&
        Number.isFinite(r.latitude) &&
        typeof r.longitude === "number" &&
        Number.isFinite(r.longitude),
    )
    .slice(0, MAX_GEOCODE_RESULTS)
    .map((r) => ({
      name: String(r.name).slice(0, MAX_QUERY_LENGTH),
      region: [r.admin1, r.country].filter(Boolean).join(", ").slice(0, 100),
      lat: Number(Number(r.latitude).toFixed(4)),
      lon: Number(Number(r.longitude).toFixed(4)),
      zone: typeof r.timezone === "string" ? r.timezone : DEFAULT_ZONE,
    }));
}

/**
 * Fetch and parse the Open-Meteo / CAMS regional model for one city.
 * @param {typeof fetch} fetcher
 * @param {City} city
 * @param {number} now
 * @returns {Promise<Air>}
 */
async function fetchModelAir(fetcher, city, now) {
  const url = new URL(OPEN_METEO_AIR_URL);
  url.search = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    hourly: "us_aqi,pm2_5,pm10",
    timezone: "GMT",
    timeformat: "unixtime",
    past_days: "1",
    forecast_days: "2",
  }).toString();
  const data = await fetchJson(fetcher, url, "Air service unavailable");
  return parseAir(data, city.id, now);
}

/** @param {City} city */
const coordKey = (city) => `${city.id}:${city.lat.toFixed(3)},${city.lon.toFixed(3)}`;

/**
 * Build the air-data resolver used by the HTTP handlers.
 * Fetches, validates and caches one response per source/city; concurrent callers share work.
 * @param {typeof fetch} fetcher Injected fetch implementation.
 * @param {() => number} clock Injected clock.
 * @param {string} [stationToken] Optional WAQI token.
 * @param {string} [googleAirKey] Optional Google Air Quality API key.
 * @returns {(city: City, mode: DataMode) => Promise<Air>}
 */
export function createAirService(fetcher, clock, stationToken = "", googleAirKey = "") {
  const memo = createMemo(clock, { ttlMs: CACHE_TTL_MS, maxEntries: MAX_CACHE_ENTRIES });

  return async function airFor(city, mode) {
    if (mode === "demo") return demoAir(city.id, clock());
    if (mode === "live" && googleAirKey) {
      return memo(`google:${coordKey(city)}`, () =>
        fetchGoogleAir(fetcher, googleAirKey, city, clock()),
      );
    }
    // Station failures stay failures: never silently replace them with a forecast.
    // Station data is fetched fresh and is not persisted or redistributed as a cache.
    if (mode === "live" && stationToken) {
      return fetchStationAir(fetcher, stationToken, city, clock());
    }
    const data = await memo(`model:${coordKey(city)}`, () => fetchModelAir(fetcher, city, clock()));
    return { ...data, mode };
  };
}
