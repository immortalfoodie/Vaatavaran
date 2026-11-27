/**
 * Vaatavaran HTTP server & Vercel serverless entrypoint.
 * Zero runtime dependencies; strict static allowlist, CSP, and rate limits.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CITIES, normalizeProfile, makePlan, localAnswer, isEmergency } from "./public/engine.js";
import { normalizeActivities } from "./public/planner.js";
import { createAirService, searchCities } from "./lib/air-quality.mjs";
import { aiFallbackNotice, generateAnswer } from "./lib/assistant.mjs";
import { createDayPlanner } from "./lib/day-plan.mjs";
import { createRateLimiter } from "./lib/rate-limit.mjs";
import { HttpError, getClientIp, readJsonBody, resolveCustomCity } from "./lib/request.mjs";

export { parseAir } from "./lib/air-quality.mjs";

/** @typedef {import("./lib/request.mjs").Request} Request */
/** @typedef {import("node:http").ServerResponse} Response */
/** @typedef {import("./public/types.js").City} City */
/** @typedef {import("./public/types.js").Air} Air */
/** @typedef {import("./public/types.js").DataMode} DataMode */
/** @typedef {(city: City, mode: DataMode) => Promise<Air>} AirResolver */
/** @typedef {import("./lib/rate-limit.mjs").RateBucket} RateBucket */

const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DEFAULT_PORT = 3000;
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const MAX_QUESTION_LEN = 1000;
const STATIC_MAX_AGE_SECONDS = 60;
const HSTS_MAX_AGE_SECONDS = 31_536_000;
/** @type {ReadonlySet<string>} */
const VALID_MODES = new Set(["demo", "live", "model"]);

/** Public files that may be served; everything else (including server source) is a 404. */
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/aqi-scales.js", "aqi-scales.js"],
  ["/api.js", "api.js"],
  ["/charts.js", "charts.js"],
  ["/chat.js", "chat.js"],
  ["/city-search.js", "city-search.js"],
  ["/clean-room.js", "clean-room.js"],
  ["/clean-room-view.js", "clean-room-view.js"],
  ["/dom.js", "dom.js"],
  ["/engine.js", "engine.js"],
  ["/format.js", "format.js"],
  ["/history.js", "history.js"],
  ["/history-view.js", "history-view.js"],
  ["/planner.js", "planner.js"],
  ["/planner-view.js", "planner-view.js"],
  ["/state.js", "state.js"],
  ["/storage.js", "storage.js"],
  ["/theme.js", "theme.js"],
  ["/theme-boot.js", "theme-boot.js"],
  ["/time.js", "time.js"],
  ["/views.js", "views.js"],
  ["/style.css", "style.css"],
  ["/favicon.svg", "favicon.svg"],
]);

/** @type {Record<string, string>} */
const MIME_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

/** Keep in sync with vercel.json, which applies the same policy on Vercel's edge. */
export const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * Send a JSON response with UTF-8 content type.
 * @param {Response} res
 * @param {number} status
 * @param {unknown} data
 */
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Apply baseline security headers to every HTTP response.
 * @param {Request} req
 * @param {Response} res
 */
function applySecurityHeaders(req, res) {
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["x-forwarded-proto"] === "https") {
    res.setHeader(
      "Strict-Transport-Security",
      `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
    );
  }
}

/**
 * Serve an allowlisted static asset from public/ with mtime-based memory caching.
 * @param {string} pathname
 * @param {Response} res
 * @param {Map<string, { mtimeMs: number, content: Buffer }>} staticCache
 */
async function serveStatic(pathname, res, staticCache) {
  const name = /** @type {string} */ (STATIC_FILES.get(pathname));
  const fileUrl = new URL(name, PUBLIC_DIR);
  const info = await stat(fileUrl);
  let entry = staticCache.get(name);
  if (!entry || entry.mtimeMs !== info.mtimeMs) {
    entry = { mtimeMs: info.mtimeMs, content: await readFile(fileUrl) };
    staticCache.set(name, entry);
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[/** @type {string} */ (name.split(".").at(-1))],
    "Cache-Control": `public, max-age=${STATIC_MAX_AGE_SECONDS}`,
  });
  res.end(entry.content);
}

/**
 * Resolve a preset city by id, or a validated custom coordinate city.
 * @param {unknown} cityId
 * @param {{ lat: unknown, lon: unknown, name: unknown, zone: unknown }} custom
 * @returns {City | null}
 */
function resolveCity(cityId, custom) {
  return (
    CITIES.find((c) => c.id === cityId) ||
    resolveCustomCity(custom.lat, custom.lon, custom.name, custom.zone)
  );
}

/**
 * GET /api/geocode?q=...
 * @param {URL} url
 * @param {Response} res
 * @param {typeof fetch} fetcher
 */
async function handleGeocode(url, res, fetcher) {
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return sendJson(res, 400, { error: "Enter at least 2 characters to search." });
  }
  try {
    return sendJson(res, 200, { results: await searchCities(fetcher, query) });
  } catch {
    return sendJson(res, 503, { error: "Location search is temporarily unavailable." });
  }
}

/**
 * GET /api/air?city=...&mode=... (or custom lat/lon/name/zone).
 * @param {URL} url
 * @param {Response} res
 * @param {AirResolver} airFor
 */
async function handleAir(url, res, airFor) {
  const params = url.searchParams;
  const mode = params.get("mode") ?? "";
  const city = resolveCity(params.get("city"), {
    lat: params.get("lat"),
    lon: params.get("lon"),
    name: params.get("name"),
    zone: params.get("zone"),
  });
  if (!city || !VALID_MODES.has(mode)) {
    return sendJson(res, 400, { error: "Choose a supported city and data mode." });
  }
  if (city.id.startsWith("custom:") && mode === "demo") {
    return sendJson(res, 400, { error: "Demo mode is only available for preset cities." });
  }
  try {
    return sendJson(res, 200, await airFor(city, /** @type {DataMode} */ (mode)));
  } catch {
    return sendJson(res, 503, {
      error:
        "Requested air data is unavailable or stale. Retry or explicitly switch to Regional forecast or Explore demo; no source has been substituted.",
    });
  }
}

/**
 * Reject cross-origin or non-JSON POST requests. Returns an error response, or null when allowed.
 * @param {Request} req
 * @returns {{ status: number, error: string } | null}
 */
function rejectUntrustedPost(req) {
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const expectedOrigin = process.env.APP_ORIGIN || `${proto}://${req.headers.host}`;
  if (req.headers.origin && req.headers.origin !== expectedOrigin) {
    return { status: 403, error: "Origin not allowed" };
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    return { status: 403, error: "Cross-site request blocked" };
  }
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return { status: 415, error: "Use application/json" };
  }
  return null;
}

/**
 * @typedef {object} ChatDeps
 * @property {typeof fetch} fetcher
 * @property {AirResolver} airFor
 * @property {string | undefined} apiKey
 * @property {string} model
 */

/**
 * @typedef {object} RequestContext Validated city, data mode and household shared by POST APIs.
 * @property {City} city
 * @property {DataMode} mode
 * @property {import("./public/types.js").Profile} profile
 * @property {boolean} useAI Explicit per-page opt-in to generative AI.
 */

/** @typedef {RequestContext & { question: string }} ChatRequest */

/**
 * Validate the city, mode and household of an untrusted POST body.
 * @param {any} body
 * @returns {RequestContext | null} Null when the city or mode is missing or invalid.
 */
function parseContext(body) {
  if (!body || typeof body !== "object") return null;
  const city = resolveCity(body.city, {
    lat: body.lat,
    lon: body.lon,
    name: body.cityName,
    zone: body.zone,
  });
  if (!city || !VALID_MODES.has(body.mode)) return null;
  // Demo scenarios exist only for preset cities; a custom city must never borrow one.
  if (city.id.startsWith("custom:") && body.mode === "demo") return null;
  return {
    city,
    mode: body.mode,
    profile: normalizeProfile(body.profile),
    useAI: body.useAI === true,
  };
}

/**
 * Validate an untrusted chat body. Returns null when anything is missing or out of bounds.
 * @param {any} body
 * @returns {ChatRequest | null}
 */
function parseChatRequest(body) {
  const context = parseContext(body);
  const question = body?.question;
  const validQuestion =
    typeof question === "string" && question.trim() !== "" && question.length <= MAX_QUESTION_LEN;
  return context && validQuestion ? { ...context, question } : null;
}

/**
 * Answer with Gemini, falling back to the labelled local guide on any provider failure.
 * @param {ChatRequest} chat
 * @param {Air} air Server-verified air data.
 * @param {ChatDeps} deps
 * @returns {Promise<{ answer: string, source: "ai" | "local", mode?: DataMode, notice?: string }>}
 */
async function answerWithAi(chat, air, { fetcher, apiKey = "", model }) {
  const { city, profile, question } = chat;
  try {
    const answer = await generateAnswer({
      fetcher,
      apiKey,
      model,
      context: { city: city.name, air, profile, plan: makePlan(air, profile), question },
    });
    return { answer, source: "ai", mode: air.mode };
  } catch (error) {
    return {
      answer: localAnswer(question, air, profile),
      source: "local",
      mode: air.mode,
      notice: aiFallbackNotice(error),
    };
  }
}

/**
 * POST /api/chat with origin validation, emergency bypass, and Gemini opt-in.
 * @param {Request} req
 * @param {Response} res
 * @param {() => boolean} consumeAi Spend one AI request from the client's quota.
 * @param {ChatDeps} deps
 */
async function handleChat(req, res, consumeAi, deps) {
  const rejection = rejectUntrustedPost(req);
  if (rejection) return sendJson(res, rejection.status, { error: rejection.error });

  const chat = parseChatRequest(await readJsonBody(req));
  if (!chat) return sendJson(res, 400, { error: "Invalid question or context" });
  const { question, profile } = chat;

  // Emergencies never wait on an external provider.
  if (isEmergency(question)) {
    const answer = localAnswer(question, { aqi: null }, profile);
    return sendJson(res, 200, { answer, source: "local", mode: chat.mode });
  }

  /** @type {Air} */
  let air;
  try {
    air = await deps.airFor(chat.city, chat.mode);
  } catch {
    return sendJson(res, 503, {
      error: "Cannot verify current air data. Retry or switch to demo.",
    });
  }

  if (!deps.apiKey || !chat.useAI) {
    const answer = localAnswer(question, air, profile);
    return sendJson(res, 200, { answer, source: "local", mode: air.mode });
  }
  if (!consumeAi()) {
    return sendJson(res, 429, { error: "AI limit reached. Try the local guide or wait a minute." });
  }
  return sendJson(res, 200, await answerWithAi(chat, air, deps));
}

/**
 * POST /api/plan-day: rule-based day plan, optionally chosen and explained by Gemini.
 * @param {Request} req
 * @param {Response} res
 * @param {() => boolean} consumeAi Spend one AI request from the client's quota.
 * @param {ReturnType<typeof createDayPlanner>} planForDay
 */
async function handlePlanDay(req, res, consumeAi, planForDay) {
  const rejection = rejectUntrustedPost(req);
  if (rejection) return sendJson(res, rejection.status, { error: rejection.error });

  const body = await readJsonBody(req);
  const context = parseContext(body);
  const activities = normalizeActivities(body?.activities);
  if (!context || !activities.length) {
    return sendJson(res, 400, { error: "Add at least one activity with a valid time." });
  }
  const result = await planForDay({ ...context, activities, consumeAi });
  return sendJson(res, result.status, result.body);
}

/**
 * @typedef {object} HandlerOptions
 * @property {typeof fetch} [fetcher] Injected fetch (mocked in tests).
 * @property {string} [apiKey] Gemini API key.
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
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  stationToken = process.env.WAQI_API_TOKEN || "",
  googleAirKey = process.env.GOOGLE_AIR_QUALITY_API_KEY || "",
  clock = Date.now,
} = {}) {
  const airFor = createAirService(fetcher, clock, stationToken, googleAirKey);
  const limiter = createRateLimiter(clock);
  const planForDay = createDayPlanner({ airFor, fetcher, apiKey, model });
  /** @type {Map<string, { mtimeMs: number, content: Buffer }>} */
  const staticCache = new Map();

  /**
   * @param {Request} req
   * @param {Response} res
   * @param {URL} url
   */
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
      handleChat(req, res, () => limiter.consumeAi(bucket), { fetcher, airFor, apiKey, model }),
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
        ai: Boolean(apiKey),
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
