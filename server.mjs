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

const PUBLIC = new URL("./public/", import.meta.url);
const STATIC = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/engine.js", "engine.js"],
  ["/views.js", "views.js"],
  ["/style.css", "style.css"],
  ["/favicon.svg", "favicon.svg"],
]);
const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};
async function readJSON(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body) > 8192)
        throw Object.assign(new Error("Request too large"), { status: 413 });
      try {
        return JSON.parse(req.body);
      } catch {
        throw Object.assign(new Error("Invalid JSON"), { status: 400 });
      }
    }
    if (req.body && typeof req.body === "object") {
      if (Buffer.byteLength(JSON.stringify(req.body)) > 8192)
        throw Object.assign(new Error("Request too large"), { status: 413 });
      return req.body;
    }
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192)
      throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
function resolveCustomCity(latParam, lonParam, nameParam, zoneParam) {
  if (latParam === null || lonParam === null) return null;
  const lat = Number(latParam);
  const lon = Number(lonParam);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null;
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
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && STATIC.has(url.pathname)) {
        const name = STATIC.get(url.pathname);
        const fileUrl = new URL(name, PUBLIC);
        const info = await stat(fileUrl);
        let entry = staticCache.get(name);
        if (!entry || entry.mtimeMs !== info.mtimeMs) {
          entry = { mtimeMs: info.mtimeMs, content: await readFile(fileUrl) };
          staticCache.set(name, entry);
        }
        res.writeHead(200, {
          "Content-Type": MIME[name.split(".").at(-1)],
          "Cache-Control": "public, max-age=60",
        });
        return res.end(entry.content);
      }
      if (url.pathname === "/api/health" && req.method === "GET")
        return send(200, {
          ok: true,
          ai: Boolean(apiKey),
          provider: "Gemini",
          stationData: Boolean(stationToken),
          googleAir: Boolean(googleAirKey),
        });
      if (!url.pathname.startsWith("/api/"))
        return send(404, { error: "Not found" });
      const ip =
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "unknown",
        now = clock();
      for (const [key, value] of clients)
        if (now - value.start > 60000) clients.delete(key);
      const bucket = clients.get(ip) || { start: now, requests: 0, ai: 0 };
      if (clients.size > 1000 && !clients.has(ip))
        return send(429, { error: "Server busy. Try again shortly." });
      clients.set(ip, bucket);
      if (++bucket.requests > 60)
        return send(429, {
          error: "Too many requests. Try again in a minute.",
        });
      if (url.pathname === "/api/geocode" && req.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 2 || q.length > 80)
          return send(400, { error: "Enter at least 2 characters to search." });
        try {
          return send(200, { results: await searchCities(fetcher, q) });
        } catch {
          return send(503, { error: "Location search is temporarily unavailable." });
        }
      }
      if (url.pathname === "/api/air" && req.method === "GET") {
        const modeParam = url.searchParams.get("mode");
        const city =
          CITIES.find((c) => c.id === url.searchParams.get("city")) ||
          resolveCustomCity(
            url.searchParams.get("lat"),
            url.searchParams.get("lon"),
            url.searchParams.get("name"),
            url.searchParams.get("zone"),
          );
        if (!city || !["demo", "live", "model"].includes(modeParam))
          return send(400, { error: "Choose a supported city and data mode." });
        if (city.id.startsWith("custom:") && modeParam === "demo")
          return send(400, { error: "Demo mode is only available for preset cities." });
        try {
          return send(200, await airFor(city, modeParam));
        } catch {
          return send(503, {
            error:
              "Requested air data is unavailable or stale. Retry or explicitly switch to Regional forecast or Explore demo; no source has been substituted.",
          });
        }
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const proto =
          req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
        const expectedOrigin =
          process.env.APP_ORIGIN || `${proto}://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin)
          return send(403, { error: "Origin not allowed" });
        if (req.headers["sec-fetch-site"] === "cross-site")
          return send(403, { error: "Cross-site request blocked" });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "Use application/json" });
        const body = await readJSON(req);
        const city =
          CITIES.find((c) => c.id === body?.city) ||
          resolveCustomCity(body?.lat, body?.lon, body?.cityName, body?.zone);
        if (
          !city ||
          !["demo", "live", "model"].includes(body.mode) ||
          typeof body.question !== "string" ||
          !body.question.trim() ||
          body.question.length > 1000
        )
          return send(400, { error: "Invalid question or context" });
        const profile = normalizeProfile(body.profile);
        if (isEmergency(body.question))
          return send(200, {
            answer: localAnswer(body.question, { aqi: null }, profile),
            source: "local",
            mode: body.mode,
          });
        let air;
        try {
          air = await airFor(city, body.mode);
        } catch {
          return send(503, {
            error: "Cannot verify current air data. Retry or switch to demo.",
          });
        }
        const fallback = localAnswer(body.question, air, profile);
        if (!apiKey || body.useAI !== true)
          return send(200, {
            answer: fallback,
            source: "local",
            mode: air.mode,
          });
        if (++bucket.ai > 8)
          return send(429, {
            error: "AI limit reached. Try the local guide or wait a minute.",
          });
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
          return send(200, {
            answer,
            source: "ai",
            mode: air.mode,
          });
        } catch (error) {
          return send(200, {
            answer: fallback,
            source: "local",
            mode: air.mode,
            notice: error.quota
              ? "Gemini’s free-tier quota is temporarily exhausted. The local guide answered instead; try AI later."
              : "AI is unavailable; the local guide answered instead.",
          });
        }
      }
      return send(404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent)
        send(error.status || 500, {
          error: error.status
            ? error.message
            : "Something went wrong. Please retry.",
        });
      else res.end();
    }
  };
}
export function createApp(options) {
  return http.createServer(createHandler(options));
}
let defaultHandler;
export default function handler(req, res) {
  return (defaultHandler ||= createHandler())(req, res);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Vaatavaran running at http://localhost:${port}`),
  );
}
