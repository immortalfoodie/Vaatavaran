/**
 * Allowlisted static asset delivery and baseline HTTP security headers.
 * Anything not listed in STATIC_FILES (including .env and server source) returns 404.
 */
import { readFile, stat } from "node:fs/promises";

/** @typedef {import("./request.mjs").Request} Request */
/** @typedef {import("node:http").ServerResponse} Response */

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const STATIC_MAX_AGE_SECONDS = 60;
const HSTS_MAX_AGE_SECONDS = 31_536_000;

/** Public files that may be served; everything else (including server source) is a 404. */
export const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/air-card-view.js", "air-card-view.js"],
  ["/air-loader.js", "air-loader.js"],
  ["/api.js", "api.js"],
  ["/app.js", "app.js"],
  ["/aqi-scales.js", "aqi-scales.js"],
  ["/charts.js", "charts.js"],
  ["/chat.js", "chat.js"],
  ["/cities.js", "cities.js"],
  ["/city-search.js", "city-search.js"],
  ["/clean-room-view.js", "clean-room-view.js"],
  ["/clean-room.js", "clean-room.js"],
  ["/dialogs.js", "dialogs.js"],
  ["/dom.js", "dom.js"],
  ["/engine.js", "engine.js"],
  ["/format.js", "format.js"],
  ["/guard.js", "guard.js"],
  ["/history-view.js", "history-view.js"],
  ["/history.js", "history.js"],
  ["/local-guide.js", "local-guide.js"],
  ["/planner-view.js", "planner-view.js"],
  ["/planner.js", "planner.js"],
  ["/priorities-view.js", "priorities-view.js"],
  ["/state.js", "state.js"],
  ["/storage.js", "storage.js"],
  ["/theme-boot.js", "theme-boot.js"],
  ["/theme.js", "theme.js"],
  ["/time.js", "time.js"],
  ["/views.js", "views.js"],
  ["/style.css", "style.css"],
  ["/overview.css", "overview.css"],
  ["/features.css", "features.css"],
  ["/dialogs.css", "dialogs.css"],
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
export function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Apply baseline security headers to every HTTP response.
 * @param {Request} req
 * @param {Response} res
 */
export function applySecurityHeaders(req, res) {
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
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
export async function serveStatic(pathname, res, staticCache) {
  const name = /** @type {string} */ (STATIC_FILES.get(pathname));
  const fileUrl = new URL(name, PUBLIC_DIR);
  const info = await stat(fileUrl);
  let entry = staticCache.get(name);
  if (!entry || entry.mtimeMs !== info.mtimeMs) {
    entry = { mtimeMs: info.mtimeMs, content: await readFile(fileUrl) };
    staticCache.set(name, entry);
  }
  const ext = /** @type {string} */ (name.split(".").at(-1));
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext],
    "Cache-Control": `public, max-age=${STATIC_MAX_AGE_SECONDS}`,
  });
  res.end(entry.content);
}
