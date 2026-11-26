/**
 * Vaatavaran HTTP server & Vercel serverless entrypoint.
 * Zero runtime dependencies; strict static allowlist, CSP, and rate limits.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CITIES,
  normalizeProfile,
  makePlan,
  localAnswer,
  isEmergency,
} from "./public/engine.js";
import { createAirService, searchCities } from "./lib/air-quality.mjs";
import { generateAnswer } from "./lib/assistant.mjs";

export { parseAir } from "./lib/air-quality.mjs";

const PUBLIC_DIR = new URL("./public/", import.meta.url);
const MAX_BODY_BYTES = 8192;
const MAX_QUESTION_LEN = 1000;
const RATE_WINDOW_MS = 60_000;
const MAX_CLIENT_BUCKETS = 1000;
const MAX_REQUESTS_PER_MIN = 60;
const MAX_AI_REQUESTS_PER_MIN = 8;
const VALID_MODES = new Set(["demo", "live", "model"]);

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/charts.js", "charts.js"],
  ["/engine.js", "engine.js"],
  ["/storage.js", "storage.js"],
  ["/views.js", "views.js"],
  ["/style.css", "style.css"],
  ["/favicon.svg", "favicon.svg"],
]);

const MIME_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/** Send a JSON response with UTF-8 content type. */
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/** Apply baseline security headers to every HTTP response. */
function applySecurityHeaders(req, res) {
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

/** Structured HTTP error with explicit status code. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Parse and size-limit JSON request bodies (supports Node streams and Vercel pre-parsed bodies). */
async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) {
        throw new HttpError(413, "Request too large");
      }
      try {
        return JSON.parse(req.body);
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }
    }
    if (req.body && typeof req.body === "object") {
      if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) {
        throw new HttpError(413, "Request too large");
      }
      return req.body;
    }
    throw new HttpError(400, "Invalid JSON");
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request too large");
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

/** Validate and normalize custom latitude/longitude query parameters. */
function resolveCustomCity(latParam, lonParam, nameParam, zoneParam) {
  if (latParam === null || lonParam === null) return null;
  const lat = Number(latParam);
  const lon = Number(lonParam);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return null;
  }
  const name =
    typeof nameParam === "string" && nameParam.trim()
      ? nameParam.trim().slice(0, 80)
      : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const zone =
    typeof zoneParam === "string" && /^[A-Za-z_]+\/[A-Za-z0-9_+-]+$/.test(zoneParam)
      ? zoneParam
      : "UTC";
  return {
    id: `custom:${lat.toFixed(3)},${lon.toFixed(3)}`,
    name,
    region: "Custom location",
    lat,
    lon,
    zone,
    demo: 120,
  };
}

/** Resolve client IP, trusting x-forwarded-for only behind an explicitly configured proxy. */
function getClientIp(req) {
  const trustProxy = Boolean(process.env.VERCEL || process.env.TRUST_PROXY === "1");
  if (trustProxy && typeof req.headers["x-forwarded-for"] === "string") {
    return req.headers["x-forwarded-for"].split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Enforce per-IP sliding-window API rate limits. */
function checkRateLimit(clients, ip, now) {
  for (const [key, value] of clients) {
    if (now - value.start > RATE_WINDOW_MS) clients.delete(key);
  }
  const bucket = clients.get(ip) || { start: now, requests: 0, ai: 0 };
  if (clients.size > MAX_CLIENT_BUCKETS && !clients.has(ip)) {
    return { status: 429, error: "Server busy. Try again shortly." };
  }
  clients.set(ip, bucket);
  if (++bucket.requests > MAX_REQUESTS_PER_MIN) {
    return { status: 429, error: "Too many requests. Try again in a minute." };
  }
  return { bucket };
}

/** Serve allowlisted static assets from public/ with mtime-based memory caching. */
async function serveStatic(pathname, res, staticCache) {
  const name = STATIC_FILES.get(pathname);
  const fileUrl = new URL(name, PUBLIC_DIR);
  const info = await stat(fileUrl);
  let entry = staticCache.get(name);
  if (!entry || entry.mtimeMs !== info.mtimeMs) {
    entry = { mtimeMs: info.mtimeMs, content: await readFile(fileUrl) };
    staticCache.set(name, entry);
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[name.split(".").at(-1)],
    "Cache-Control": "public, max-age=60",
  });
  res.end(entry.content);
}

/** Handle GET /api/geocode?q=... */
async function handleGeocode(url, res, fetcher) {
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2 || query.length > 80) {
    return sendJson(res, 400, { error: "Enter at least 2 characters to search." });
  }
  try {
    return sendJson(res, 200, { results: await searchCities(fetcher, query) });
  } catch {
    return sendJson(res, 503, { error: "Location search is temporarily unavailable." });
  }
}

/** Handle GET /api/air?city=...&mode=... (or custom lat/lon). */
async function handleAir(url, res, airFor) {
  const modeParam = url.searchParams.get("mode");
  const city =
    CITIES.find((c) => c.id === url.searchParams.get("city")) ||
    resolveCustomCity(
      url.searchParams.get("lat"),
      url.searchParams.get("lon"),
      url.searchParams.get("name"),
      url.searchParams.get("zone"),
    );
  if (!city || !VALID_MODES.has(modeParam)) {
    return sendJson(res, 400, { error: "Choose a supported city and data mode." });
  }
  if (city.id.startsWith("custom:") && modeParam === "demo") {
    return sendJson(res, 400, { error: "Demo mode is only available for preset cities." });
  }
  try {
    return sendJson(res, 200, await airFor(city, modeParam));
  } catch {
    return sendJson(res, 503, {
      error:
        "Requested air data is unavailable or stale. Retry or explicitly switch to Regional forecast or Explore demo; no source has been substituted.",
    });
  }
}

/** Handle POST /api/chat with origin validation, emergency bypass, and Gemini opt-in. */
async function handleChat(req, res, bucket, { fetcher, airFor, apiKey, model }) {
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const expectedOrigin = process.env.APP_ORIGIN || `${proto}://${req.headers.host}`;
  if (req.headers.origin && req.headers.origin !== expectedOrigin) {
    return sendJson(res, 403, { error: "Origin not allowed" });
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    return sendJson(res, 403, { error: "Cross-site request blocked" });
  }
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return sendJson(res, 415, { error: "Use application/json" });
  }

  const body = await readJsonBody(req);
  const city =
    CITIES.find((c) => c.id === body?.city) ||
    resolveCustomCity(body?.lat, body?.lon, body?.cityName, body?.zone);
  if (
    !city ||
    !VALID_MODES.has(body.mode) ||
    typeof body.question !== "string" ||
    !body.question.trim() ||
    body.question.length > MAX_QUESTION_LEN
  ) {
    return sendJson(res, 400, { error: "Invalid question or context" });
  }

  const profile = normalizeProfile(body.profile);
  if (isEmergency(body.question)) {
    return sendJson(res, 200, {
      answer: localAnswer(body.question, { aqi: null }, profile),
      source: "local",
      mode: body.mode,
    });
  }

  let air;
  try {
    air = await airFor(city, body.mode);
  } catch {
    return sendJson(res, 503, {
      error: "Cannot verify current air data. Retry or switch to demo.",
    });
  }

  const fallback = localAnswer(body.question, air, profile);
  if (!apiKey || body.useAI !== true) {
    return sendJson(res, 200, { answer: fallback, source: "local", mode: air.mode });
  }
  if (++bucket.ai > MAX_AI_REQUESTS_PER_MIN) {
    return sendJson(res, 429, {
      error: "AI limit reached. Try the local guide or wait a minute.",
    });
  }

  try {
    const answer = await generateAnswer({
      fetcher,
      apiKey,
      model,
      context: {
        city: city.name,
        air,
        profile,
        plan: makePlan(air, profile),
        question: body.question,
      },
    });
    return sendJson(res, 200, { answer, source: "ai", mode: air.mode });
  } catch (error) {
    return sendJson(res, 200, {
      answer: fallback,
      source: "local",
      mode: air.mode,
      notice: error.quota
        ? "Gemini’s free-tier quota is temporarily exhausted. The local guide answered instead; try AI later."
        : "AI is unavailable; the local guide answered instead.",
    });
  }
}

/**
 * Create a Node/Vercel-compatible HTTP request handler.
 * @param {object} [options]
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>}
 */
export function createHandler({
  fetcher = fetch,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  stationToken = process.env.WAQI_API_TOKEN || "",
  googleAirKey = process.env.GOOGLE_AIR_QUALITY_API_KEY || "",
  clock = Date.now,
} = {}) {
  const airFor = createAirService(fetcher, clock, stationToken, googleAirKey);
  const clients = new Map();
  const staticCache = new Map();

  return async (req, res) => {
    applySecurityHeaders(req, res);
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
        return await serveStatic(url.pathname, res, staticCache);
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
      if (!url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: "Not found" });
      }

      const limit = checkRateLimit(clients, getClientIp(req), clock());
      if (limit.error) return sendJson(res, limit.status, { error: limit.error });

      if (url.pathname === "/api/geocode" && req.method === "GET") {
        return await handleGeocode(url, res, fetcher);
      }
      if (url.pathname === "/api/air" && req.method === "GET") {
        return await handleAir(url, res, airFor);
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        return await handleChat(req, res, limit.bucket, {
          fetcher,
          airFor,
          apiKey,
          model,
        });
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error.status || 500, {
          error: error.status
            ? error.message
            : "Something went wrong. Please retry.",
        });
      } else {
        res.end();
      }
    }
  };
}

/** Create an http.Server instance wrapping createHandler(). */
export function createApp(options) {
  return http.createServer(createHandler(options));
}

let defaultHandler;
/** Default export for Vercel serverless root entrypoint. */
export default function handler(req, res) {
  return (defaultHandler ||= createHandler())(req, res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Vaatavaran running at http://localhost:${port}`),
  );
}
