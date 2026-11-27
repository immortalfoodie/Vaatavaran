import test from "node:test";
import assert from "node:assert/strict";
import { fetchGoogleAir, parseGoogleAir } from "../lib/google-air.mjs";
import { usAqiFromPm } from "../public/aqi-scales.js";
import { createAirService } from "../lib/air-quality.mjs";
import { CITIES } from "../public/engine.js";

const now = Date.parse("2026-11-26T18:30:00Z");
const mumbai = CITIES.find((c) => c.id === "mumbai");

function sampleGooglePayload() {
  return {
    dateTime: "2026-11-26T18:00:00Z",
    indexes: [
      { code: "uaqi", displayName: "Universal AQI", aqi: 34 },
      {
        code: "ind_cpcb",
        displayName: "NAQI (India)",
        aqi: 210,
        category: "Poor",
      },
    ],
    pollutants: [
      { code: "pm25", concentration: { value: 93.2, units: "PARTS_PER_BILLION" } },
      { code: "pm10", concentration: { value: 121.0, units: "MICROGRAMS_PER_CUBIC_METER" } },
    ],
  };
}

test("US EPA AQI computation from PM2.5 and PM10 matches expected bands", () => {
  assert.equal(usAqiFromPm(8.5, 20), 47);
  assert.equal(usAqiFromPm(93.2, 121), 177);
  assert.equal(usAqiFromPm(null, null), null);
});

test("Google Air Quality parser extracts 500m concentrations and computes US AQI", () => {
  const air = parseGoogleAir(sampleGooglePayload(), mumbai, now);
  assert.equal(air.aqi, 177);
  assert.equal(air.pm25, 93.2);
  assert.equal(air.pm10, 121);
  assert.equal(air.source.kind, "google");
  assert.equal(air.localIndex.aqi, 210);
});

test("Google Air Quality parser rejects stale or empty responses", () => {
  const stale = sampleGooglePayload();
  stale.dateTime = "2026-11-25T00:00:00Z";
  assert.throws(() => parseGoogleAir(stale, mumbai, now));
  assert.throws(() => parseGoogleAir({}, mumbai, now));
});

test("Air service prioritizes Google Air Quality when key is configured and caches 10 min", async () => {
  let calls = 0;
  const service = createAirService(
    async () => {
      calls++;
      return { ok: true, json: async () => sampleGooglePayload() };
    },
    () => now,
    "waqi-token",
    "google-air-key",
  );
  const first = await service(mumbai, "live");
  const second = await service(mumbai, "live");
  assert.equal(first.source.kind, "google");
  assert.equal(first.aqi, 177);
  assert.equal(second.aqi, 177);
  assert.equal(calls, 1);
});

test("Google API key travels in a header and never in the request URL", async () => {
  let seen;
  const fetcher = async (url, init) => {
    seen = { url: String(url), init };
    return { ok: true, json: async () => sampleGooglePayload() };
  };
  await fetchGoogleAir(fetcher, "secret-key", mumbai, now);
  assert.doesNotMatch(seen.url, /secret-key|key=/);
  assert.equal(seen.init.headers["x-goog-api-key"], "secret-key");
  assert.ok(seen.init.signal, "request has a deadline");
});

test("Official usa_epa index is preferred and is never repeated as the local index", () => {
  const payload = sampleGooglePayload();
  payload.indexes = [
    { code: "uaqi", aqi: 34 },
    { code: "usa_epa", displayName: "AQI (US)", aqi: 163 },
  ];
  const air = parseGoogleAir(payload, mumbai, now);
  assert.equal(air.aqi, 163);
  assert.equal(air.localIndex, null);
});

test("Missing or negative Google concentrations are reported as null, not zero", () => {
  const payload = sampleGooglePayload();
  payload.pollutants = [{ code: "pm25", concentration: { value: -1 } }];
  payload.indexes = [{ code: "usa_epa", aqi: 80 }];
  const air = parseGoogleAir(payload, mumbai, now);
  assert.equal(air.pm25, null);
  assert.equal(air.pm10, null);
  assert.equal(air.aqi, 80);
});

test("Google readings from the future beyond clock skew are rejected", () => {
  const payload = sampleGooglePayload();
  payload.dateTime = new Date(now + 60 * 60 * 1000).toISOString();
  assert.throws(() => parseGoogleAir(payload, mumbai, now), /missing or stale/);
});
