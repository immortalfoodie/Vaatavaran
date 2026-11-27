/**
 * Browser API client: the only module that talks to the Vaatavaran server.
 * Every call has a deadline and surfaces the server's client-safe error message.
 */
import { isRecord } from "./guard.js";
import { SECOND_MS } from "./time.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").DataMode} DataMode */

const AIR_TIMEOUT_MS = 10 * SECOND_MS;
const SEARCH_TIMEOUT_MS = 8 * SECOND_MS;
const CHAT_TIMEOUT_MS = 30 * SECOND_MS;
const PLAN_TIMEOUT_MS = 30 * SECOND_MS;
const HEALTH_TIMEOUT_MS = 5 * SECOND_MS;

/**
 * @typedef {object} Health
 * @property {boolean} ai Gemini key configured on the server.
 * @property {boolean} stationData WAQI token configured.
 * @property {boolean} googleAir Google Air Quality key configured.
 */

/**
 * @typedef {object} ChatReply
 * @property {string} answer
 * @property {"ai" | "local"} source
 * @property {DataMode} [mode]
 * @property {string} [notice]
 */

/**
 * Fetch JSON with a deadline; throws an Error carrying the server's message on failure.
 * @template T
 * @param {string} url
 * @param {{ timeoutMs: number, fallbackError: string, init?: RequestInit }} options
 * @returns {Promise<T>}
 */
async function requestJson(url, { timeoutMs, fallbackError, init = {} }) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  /** @type {unknown} */
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serverError = isRecord(data) && typeof data.error === "string" ? data.error : "";
    throw new Error(serverError || fallbackError);
  }
  return /** @type {T} */ (data);
}

/**
 * Build the /api/air URL for a preset or custom city.
 * @param {City} city
 * @param {DataMode} mode
 * @returns {string}
 */
export function airQueryUrl(city, mode) {
  if (city.id === "custom") {
    const params = new URLSearchParams({
      lat: String(city.lat),
      lon: String(city.lon),
      name: city.name,
      zone: city.zone,
      mode,
    });
    return `/api/air?${params}`;
  }
  return `/api/air?${new URLSearchParams({ city: city.id, mode })}`;
}

/**
 * @param {City} city
 * @param {DataMode} mode
 * @returns {Promise<Air>}
 */
export function fetchAir(city, mode) {
  return requestJson(airQueryUrl(city, mode), {
    timeoutMs: AIR_TIMEOUT_MS,
    fallbackError: "Air data unavailable",
  });
}

/**
 * @param {string} query
 * @returns {Promise<Array<{ name: string, region: string, lat: number, lon: number, zone: string }>>}
 */
export async function searchLocations(query) {
  /** @type {{ results?: Array<{ name: string, region: string, lat: number, lon: number, zone: string }> }} */
  const data = await requestJson(`/api/geocode?${new URLSearchParams({ q: query })}`, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    fallbackError: "Search unavailable",
  });
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * @typedef {object} PlanReply
 * @property {import("./planner.js").DayPlan} plan
 * @property {"ai" | "rules"} source Whether Gemini chose and explained the plan.
 * @property {{ mode: DataMode, source: string }} forecast Which data the forecast came from.
 * @property {string} [narrative] Gemini's one-paragraph summary.
 * @property {string} [notice] Why AI was not used, when it was requested.
 */

/**
 * Fields the server needs to identify the city: a preset id, or custom coordinates.
 * @param {string} cityId Preset id or "custom".
 * @param {City} city
 * @returns {Record<string, unknown>}
 */
export function cityContext(cityId, city) {
  if (city.id !== "custom") return { city: cityId };
  return { city: cityId, lat: city.lat, lon: city.lon, cityName: city.name, zone: city.zone };
}

/**
 * POST a JSON body with a deadline.
 * @template T
 * @param {string} url
 * @param {Record<string, unknown>} body
 * @param {{ timeoutMs: number, fallbackError: string }} options
 * @returns {Promise<T>}
 */
function postJson(url, body, options) {
  return requestJson(url, {
    ...options,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  });
}

/**
 * @param {Record<string, unknown>} context City, mode, profile, question and AI opt-in.
 * @returns {Promise<ChatReply>}
 */
export function postChat(context) {
  return postJson("/api/chat", context, {
    timeoutMs: CHAT_TIMEOUT_MS,
    fallbackError: "The assistant is unavailable.",
  });
}

/**
 * @param {Record<string, unknown>} context City, mode, profile, activities and AI opt-in.
 * @returns {Promise<PlanReply>}
 */
export function postDayPlan(context) {
  return postJson("/api/plan-day", context, {
    timeoutMs: PLAN_TIMEOUT_MS,
    fallbackError: "The day planner is unavailable.",
  });
}

/** @returns {Promise<Health>} */
export function fetchHealth() {
  return requestJson("/api/health", {
    timeoutMs: HEALTH_TIMEOUT_MS,
    fallbackError: "Health check failed",
  });
}
