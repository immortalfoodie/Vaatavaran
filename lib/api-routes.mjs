/**
 * HTTP API route handlers for geocode, air quality, chat, and day planning.
 */
import { CITIES, normalizeProfile, makePlan, localAnswer, isEmergency } from "../public/engine.js";
import { isRecord } from "../public/guard.js";
import { normalizeActivities } from "../public/planner.js";
import { searchCities } from "./air-quality.mjs";
import { aiFallbackNotice, generateAnswer } from "./assistant.mjs";
import { readJsonBody, resolveCustomCity } from "./request.mjs";
import { sendJson } from "./static.mjs";

/** @typedef {import("./request.mjs").Request} Request */
/** @typedef {import("node:http").ServerResponse} Response */
/** @typedef {import("../public/types.js").City} City */
/** @typedef {import("../public/types.js").Air} Air */
/** @typedef {import("../public/types.js").Profile} Profile */
/** @typedef {import("../public/types.js").DataMode} DataMode */
/** @typedef {(city: City, mode: DataMode) => Promise<Air>} AirResolver */
/** @typedef {ReturnType<typeof import("./day-plan.mjs").createDayPlanner>} DayPlanner */

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const MAX_QUESTION_LEN = 1000;
/** @type {ReadonlySet<string>} */
const VALID_MODES = new Set(["demo", "live", "model"]);

/**
 * @typedef {object} ChatDeps
 * @property {typeof fetch} fetcher
 * @property {AirResolver} airFor
 * @property {string[]} apiKeys Gemini keys in priority order (empty: AI disabled).
 * @property {string} model
 */

/**
 * @typedef {object} RequestContext Validated city, data mode and household shared by POST APIs.
 * @property {City} city
 * @property {DataMode} mode
 * @property {Profile} profile
 * @property {boolean} useAI Explicit per-page opt-in to generative AI.
 */

/** @typedef {RequestContext & { question: string }} ChatRequest */

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
 * Validate the city, mode and household of an untrusted POST body.
 * @param {unknown} body
 * @returns {RequestContext | null} Null when the city or mode is missing or invalid.
 */
function parseContext(body) {
  if (!isRecord(body)) return null;
  const city = resolveCity(body.city, {
    lat: body.lat,
    lon: body.lon,
    name: body.cityName,
    zone: body.zone,
  });
  if (!city || typeof body.mode !== "string" || !VALID_MODES.has(body.mode)) return null;
  // Demo scenarios exist only for preset cities; a custom city must never borrow one.
  if (city.id.startsWith("custom:") && body.mode === "demo") return null;
  return {
    city,
    mode: /** @type {DataMode} */ (body.mode),
    profile: normalizeProfile(body.profile),
    useAI: body.useAI === true,
  };
}

/**
 * Validate an untrusted chat body. Returns null when anything is missing or out of bounds.
 * @param {unknown} body
 * @returns {ChatRequest | null}
 */
function parseChatRequest(body) {
  const context = parseContext(body);
  const question = isRecord(body) ? body.question : null;
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
async function answerWithAi(chat, air, { fetcher, apiKeys, model }) {
  const { city, profile, question } = chat;
  try {
    const answer = await generateAnswer({
      fetcher,
      apiKeys,
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
 * GET /api/geocode?q=...
 * @param {URL} url
 * @param {Response} res
 * @param {typeof fetch} fetcher
 */
export async function handleGeocode(url, res, fetcher) {
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
export async function handleAir(url, res, airFor) {
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
 * POST /api/chat with origin validation, emergency bypass, and Gemini opt-in.
 * @param {Request} req
 * @param {Response} res
 * @param {() => boolean} consumeAi Spend one AI request from the client's quota.
 * @param {ChatDeps} deps
 */
export async function handleChat(req, res, consumeAi, deps) {
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

  if (!deps.apiKeys.length || !chat.useAI) {
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
 * @param {DayPlanner} planForDay
 */
export async function handlePlanDay(req, res, consumeAi, planForDay) {
  const rejection = rejectUntrustedPost(req);
  if (rejection) return sendJson(res, rejection.status, { error: rejection.error });

  const body = await readJsonBody(req);
  const context = parseContext(body);
  const activities = normalizeActivities(isRecord(body) ? body.activities : null);
  if (!context || !activities.length) {
    return sendJson(res, 400, { error: "Add at least one activity with a valid time." });
  }
  const result = await planForDay({ ...context, activities, consumeAi });
  return sendJson(res, result.status, result.body);
}
