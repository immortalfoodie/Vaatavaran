import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleAir, usAqiFromPm } from "../lib/google-air.mjs";
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
