/**
 * Browser API client: the only module that talks to the Vaatavaran server.
 * Every call has a deadline and surfaces the server's client-safe error message.
 */
import { SECOND_MS } from "./time.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").DataMode} DataMode */

const AIR_TIMEOUT_MS = 10 * SECOND_MS;
const SEARCH_TIMEOUT_MS = 8 * SECOND_MS;
const CHAT_TIMEOUT_MS = 30 * SECOND_MS;
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
 * @param {string} url
 * @param {{ timeoutMs: number, fallbackError: string, init?: RequestInit }} options
 * @returns {Promise<any>}
 */
async function requestJson(url, { timeoutMs, fallbackError, init = {} }) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || fallbackError);
  return data;
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
  const data = await requestJson(`/api/geocode?${new URLSearchParams({ q: query })}`, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    fallbackError: "Search unavailable",
  });
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * @param {Record<string, unknown>} context City, mode, profile, question and AI opt-in.
 * @returns {Promise<ChatReply>}
 */
export function postChat(context) {
  return requestJson("/api/chat", {
    timeoutMs: CHAT_TIMEOUT_MS,
    fallbackError: "The assistant is unavailable.",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    },
  });
}

/** @returns {Promise<Health>} */
export function fetchHealth() {
  return requestJson("/api/health", {
    timeoutMs: HEALTH_TIMEOUT_MS,
    fallbackError: "Health check failed",
  });
}
