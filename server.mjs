/**
 * Vaatavaran HTTP server & Vercel serverless entrypoint.
 * Zero runtime dependencies; strict static allowlist, CSP, and rate limits.
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createAirService } from "./lib/air-quality.mjs";
import { handleAir, handleChat, handleGeocode, handlePlanDay } from "./lib/api-routes.mjs";
import { createDayPlanner } from "./lib/day-plan.mjs";
import { createRateLimiter } from "./lib/rate-limit.mjs";
import { HttpError, getClientIp } from "./lib/request.mjs";
import { STATIC_FILES, applySecurityHeaders, sendJson, serveStatic } from "./lib/static.mjs";

export { parseAir } from "./lib/air-quality.mjs";
export { CSP_HEADER } from "./lib/static.mjs";

/** @typedef {import("./lib/request.mjs").Request} Request */
/** @typedef {import("node:http").ServerResponse} Response */
/** @typedef {import("./lib/rate-limit.mjs").RateBucket} RateBucket */

const DEFAULT_PORT = 3000;
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * @typedef {object} HandlerOptions
 * @property {typeof fetch} [fetcher] Injected fetch (mocked in tests).
 * @property {string} [apiKey] Primary Gemini API key.
 * @property {string} [fallbackApiKey] Second Gemini key, used when the primary is rate-limited,
 *   out of quota, invalid or revoked.
 * @property {string} [model] Gemini model name.
 * @property {string} [stationToken] WAQI token.
 * @property {string} [googleAirKey] Google Air Quality API key.
 * @property {() => number} [clock] Injected clock.
 */

/**
 * Create a Node/Vercel-compatible HTTP request handler.
 * @param {HandlerOptions} [options]
 * @returns {(req: Request, res: Response) => Promise<void>}
 */
export function createHandler({
  fetcher = fetch,
  apiKey = process.env.GEMINI_API_KEY,
  fallbackApiKey = process.env.GEMINI_FALLBACK_API_KEY,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  stationToken = process.env.WAQI_API_TOKEN || "",
  googleAirKey = process.env.GOOGLE_AIR_QUALITY_API_KEY || "",
  clock = Date.now,
} = {}) {
  const airFor = createAirService(fetcher, clock, stationToken, googleAirKey);
  const limiter = createRateLimiter(clock);
  /** Gemini keys in priority order; blanks and duplicates are dropped. */
  const apiKeys = [...new Set([apiKey, fallbackApiKey].flatMap((key) => (key ? [key] : [])))];
  const planForDay = createDayPlanner({ airFor, fetcher, apiKeys, model });
  /** @type {Map<string, { mtimeMs: number, content: Buffer }>} */
  const staticCache = new Map();

  /**
   * Rate-limited API endpoints, keyed by "METHOD /path".
   * @type {Record<string, (req: Request, res: Response, url: URL, bucket: RateBucket) => Promise<void>>}
   */
  const apiRoutes = {
    "GET /api/geocode": (_req, res, url) => handleGeocode(url, res, fetcher),
    "GET /api/air": (_req, res, url) => handleAir(url, res, airFor),
    "POST /api/plan-day": (req, res, _url, bucket) =>
      handlePlanDay(req, res, () => limiter.consumeAi(bucket), planForDay),
    "POST /api/chat": (req, res, _url, bucket) =>
      handleChat(req, res, () => limiter.consumeAi(bucket), { fetcher, airFor, apiKeys, model }),
  };

  /**
   * @param {Request} req
   * @param {Response} res
   * @param {URL} url
   */
  async function route(req, res, url) {
    if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
      return serveStatic(url.pathname, res, staticCache);
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        ai: apiKeys.length > 0,
        provider: "Gemini",
        stationData: Boolean(stationToken),
        googleAir: Boolean(googleAirKey),
      });
    }
    if (!url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });

    const limit = limiter.check(getClientIp(req));
    if (!limit.ok) return sendJson(res, limit.status, { error: limit.error });

    const endpoint = apiRoutes[`${req.method} ${url.pathname}`];
    if (!endpoint) return sendJson(res, 404, { error: "Not found" });
    return endpoint(req, res, url, limit.bucket);
  }

  return async (req, res) => {
    applySecurityHeaders(req, res);
    try {
      await route(req, res, new URL(req.url || "/", "http://localhost"));
    } catch (error) {
      if (res.headersSent) {
        res.end();
      } else if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        sendJson(res, 500, { error: "Something went wrong. Please retry." });
      }
    }
  };
}

/**
 * Create an http.Server wrapping createHandler().
 * @param {HandlerOptions} [options]
 * @returns {http.Server}
 */
export function createApp(options) {
  return http.createServer(createHandler(options));
}

/** @type {ReturnType<typeof createHandler> | undefined} */
let defaultHandler;

/**
 * Default export for the Vercel serverless root entrypoint.
 * @param {Request} req
 * @param {Response} res
 */
export default function handler(req, res) {
  defaultHandler ||= createHandler();
  return defaultHandler(req, res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Vaatavaran running at http://localhost:${port}`),
  );
}
