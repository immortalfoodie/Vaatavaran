/**
 * Request parsing and validation helpers shared by the HTTP handlers.
 */

/** @typedef {import("node:http").IncomingMessage & { body?: unknown }} Request */
/** @typedef {import("../public/types.js").City} City */

export const MAX_BODY_BYTES = 8192;
const MAX_NAME_LENGTH = 80;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
const TIME_ZONE_PATTERN = /^[A-Za-z_]+\/[A-Za-z0-9_+-]+$/;
/** Demo AQI placeholder required by the City shape; demo mode is rejected for custom cities. */
const CUSTOM_CITY_DEMO_AQI = 120;

/** Structured HTTP error with an explicit, client-safe status code and message. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} message Client-safe message.
   */
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Parse JSON text, mapping syntax errors to a 400.
 * @param {string} text
 * @returns {unknown}
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

/** @param {string} text */
function assertWithinLimit(text) {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
}

/**
 * Parse and size-limit a JSON request body (Node streams and Vercel pre-parsed bodies).
 * @param {Request} req
 * @returns {Promise<any>}
 */
export async function readJsonBody(req) {
  if (typeof req.body === "string") {
    assertWithinLimit(req.body);
    return parseJson(req.body);
  }
  if (req.body !== undefined) {
    if (!req.body || typeof req.body !== "object") throw new HttpError(400, "Invalid JSON");
    assertWithinLimit(JSON.stringify(req.body));
    return req.body;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    assertWithinLimit(body);
  }
  return parseJson(body);
}

/**
 * Validate custom latitude/longitude parameters into a City, or null when invalid.
 * @param {unknown} latParam
 * @param {unknown} lonParam
 * @param {unknown} nameParam
 * @param {unknown} zoneParam
 * @returns {City | null}
 */
export function resolveCustomCity(latParam, lonParam, nameParam, zoneParam) {
  if (latParam === null || latParam === undefined || lonParam === null || lonParam === undefined) {
    return null;
  }
  const lat = Number(latParam);
  const lon = Number(lonParam);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > MAX_LATITUDE ||
    Math.abs(lon) > MAX_LONGITUDE
  ) {
    return null;
  }
  const name =
    typeof nameParam === "string" && nameParam.trim()
      ? nameParam.trim().slice(0, MAX_NAME_LENGTH)
      : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const zone =
    typeof zoneParam === "string" && TIME_ZONE_PATTERN.test(zoneParam) ? zoneParam : "UTC";
  return {
    id: `custom:${lat.toFixed(3)},${lon.toFixed(3)}`,
    name,
    region: "Custom location",
    lat,
    lon,
    zone,
    demo: CUSTOM_CITY_DEMO_AQI,
  };
}

/**
 * Resolve the client IP, trusting `x-forwarded-for` only behind an explicitly configured proxy.
 * @param {Request} req
 * @returns {string}
 */
export function getClientIp(req) {
  const trustProxy = Boolean(process.env.VERCEL || process.env.TRUST_PROXY === "1");
  const forwarded = req.headers["x-forwarded-for"];
  if (trustProxy && typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
