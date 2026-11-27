/**
 * In-memory fixed-window rate limiter, bounded in memory and swept at most once per window.
 */
import { MINUTE_MS } from "../public/time.js";

export const RATE_WINDOW_MS = MINUTE_MS;
export const MAX_REQUESTS_PER_WINDOW = 60;
export const MAX_AI_REQUESTS_PER_WINDOW = 8;
const MAX_CLIENT_BUCKETS = 1000;

/**
 * @typedef {object} RateBucket
 * @property {number} start Window start (ms).
 * @property {number} requests API requests in this window.
 * @property {number} ai AI requests in this window.
 */

/**
 * @typedef {{ ok: true, bucket: RateBucket } | { ok: false, status: number, error: string }} RateDecision
 */

/**
 * Create a per-client limiter.
 * @param {() => number} clock Injected clock (ms).
 * @returns {{ check: (clientId: string) => RateDecision, consumeAi: (bucket: RateBucket) => boolean }}
 */
export function createRateLimiter(clock) {
  /** @type {Map<string, RateBucket>} */
  const clients = new Map();
  let lastSweep = clock();

  /**
   * Drop expired buckets; runs at most once per window so each request stays O(1).
   * @param {number} now
   */
  function sweep(now) {
    if (now - lastSweep < RATE_WINDOW_MS) return;
    lastSweep = now;
    for (const [key, bucket] of clients) {
      if (now - bucket.start > RATE_WINDOW_MS) clients.delete(key);
    }
  }

  return {
    check(clientId) {
      const now = clock();
      sweep(now);
      let bucket = clients.get(clientId);
      if (bucket && now - bucket.start > RATE_WINDOW_MS) bucket = undefined;
      if (!bucket) {
        if (clients.size >= MAX_CLIENT_BUCKETS && !clients.has(clientId)) {
          return { ok: false, status: 429, error: "Server busy. Try again shortly." };
        }
        bucket = { start: now, requests: 0, ai: 0 };
        clients.set(clientId, bucket);
      }
      if (++bucket.requests > MAX_REQUESTS_PER_WINDOW) {
        return { ok: false, status: 429, error: "Too many requests. Try again in a minute." };
      }
      return { ok: true, bucket };
    },
    consumeAi(bucket) {
      bucket.ai += 1;
      return bucket.ai <= MAX_AI_REQUESTS_PER_WINDOW;
    },
  };
}
