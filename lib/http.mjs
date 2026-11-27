/**
 * Shared upstream HTTP helpers: one timeout policy and one error contract for every provider.
 */
import { SECOND_MS } from "../public/time.js";

/** Deadline for any single upstream provider request. */
export const UPSTREAM_TIMEOUT_MS = 8 * SECOND_MS;

/**
 * Fetch JSON from a fixed upstream URL with a deadline.
 * Provider error bodies are never relayed: callers receive only `errorMessage`.
 * @param {typeof fetch} fetcher Injected fetch implementation (mocked in tests).
 * @param {string | URL} url Fixed provider endpoint.
 * @param {string} errorMessage Message thrown when the provider responds with a non-2xx status.
 * @param {RequestInit} [init] Optional method, headers and body.
 * @returns {Promise<any>} Parsed JSON payload (validated by the caller).
 */
export async function fetchJson(fetcher, url, errorMessage, init = {}) {
  const response = await fetcher(url, {
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(errorMessage);
  return response.json();
}

/**
 * Create a TTL cache whose concurrent callers for the same key share one in-flight request.
 * @param {() => number} clock Injected clock (milliseconds since epoch).
 * @param {{ ttlMs: number, maxEntries: number }} limits Freshness window and size bound.
 * @returns {<T>(key: string, loader: () => Promise<T>) => Promise<T>} Memoized loader.
 */
export function createMemo(clock, { ttlMs, maxEntries }) {
  /** @type {Map<string, { data: any, saved: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<any>>} */
  const pending = new Map();

  return async function memo(key, loader) {
    const cached = cache.get(key);
    if (cached && clock() - cached.saved < ttlMs) return cached.data;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const operation = (async () => {
      const data = await loader();
      if (cache.size >= maxEntries) cache.clear();
      cache.set(key, { data, saved: clock() });
      return data;
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };
}
