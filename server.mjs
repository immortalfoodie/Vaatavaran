import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CITIES,
  normalizeProfile,
  makePlan,
  localAnswer,
  isEmergency,
} from "./public/engine.js";

import { createAirService } from "./lib/air-quality.mjs";
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
export function createApp({
  fetcher = fetch,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  stationToken = process.env.WAQI_API_TOKEN || "",
  clock = Date.now,
} = {}) {
  const airFor = createAirService(fetcher, clock, stationToken);
  const clients = new Map();
  return http.createServer(async (req, res) => {
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
        const content = await readFile(new URL(name, PUBLIC));
        res.writeHead(200, { "Content-Type": MIME[name.split(".").at(-1)] });
        return res.end(content);
      }
      if (url.pathname === "/api/health" && req.method === "GET")
        return send(200, { ok: true, ai: Boolean(apiKey), provider: "Gemini", stationData: Boolean(stationToken) });
      if (!url.pathname.startsWith("/api/"))
        return send(404, { error: "Not found" });
      const ip = req.socket.remoteAddress,
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
      if (url.pathname === "/api/air" && req.method === "GET") {
        const city = CITIES.find((c) => c.id === url.searchParams.get("city"));
        if (!city || !["demo", "live", "model"].includes(url.searchParams.get("mode")))
          return send(400, { error: "Choose a supported city and data mode." });
        try {
          return send(200, await airFor(city, url.searchParams.get("mode")));
        } catch {
          return send(503, {
            error:
              "Requested air data is unavailable or stale. Retry or explicitly switch to Regional forecast or Explore demo; no source has been substituted.",
          });
        }
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const expectedOrigin =
          process.env.APP_ORIGIN || `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin)
          return send(403, { error: "Origin not allowed" });
        if (req.headers["sec-fetch-site"] === "cross-site")
          return send(403, { error: "Cross-site request blocked" });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "Use application/json" });
        const body = await readJSON(req);
        const city = CITIES.find((c) => c.id === body?.city);
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
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Vaatavaran running at http://localhost:${port}`),
  );
}
