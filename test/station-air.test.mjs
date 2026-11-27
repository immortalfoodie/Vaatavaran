import test from "node:test";
import assert from "node:assert/strict";
import { parseStationAir } from "../lib/station-air.mjs";
import { createAirService } from "../lib/air-quality.mjs";
import { CITIES } from "../public/engine.js";

const now = Date.parse("2026-11-17T18:00:00Z");
const city = CITIES[0];
function reading() {
  return {
    status: "ok",
    data: {
      aqi: 234,
      time: { iso: "2026-11-17T23:00:00+05:30" },
      city: { name: "Test station", geo: [city.lat, city.lon], url: "https://aqicn.org/city/test" },
      attributions: [{ name: "Monitoring agency", url: "https://example.org" }],
      iaqi: { pm25: { v: 234 }, pm10: { v: 170 } },
    },
  };
}

test("Station reading retains provenance and never mislabels pollutant subindices", () => {
  const air = parseStationAir(reading(), city, now);
  assert.equal(air.aqi, 234);
  assert.equal(air.source.kind, "station");
  assert.equal(air.source.station, "Test station");
  assert.equal(air.source.distanceKm, 0);
  assert.equal(air.pm25, null);
  assert.equal(air.pm10, null);
  assert.deepEqual(air.pollutantAqi, { pm25: 234, pm10: 170 });
  assert.deepEqual(air.hourly, []);
});

test("Missing or invalid pollutant indices are not invented", () => {
  for (const value of [undefined, null, "84", -1, NaN]) {
    const payload = reading();
    payload.data.iaqi = { pm25: { v: value } };
    assert.deepEqual(parseStationAir(payload, city, now).pollutantAqi, { pm25: null, pm10: null });
  }
});

test("Station parser rejects stale, future, distant and invalid readings", () => {
  for (const mutate of [
    (d) => {
      d.aqi = false;
    },
    (d) => {
      d.aqi = " ";
    },
    (d) => {
      d.aqi = "-";
    },
    (d) => {
      d.time.iso = "2026-11-16T18:00:00Z";
    },
    (d) => {
      d.time.iso = "2026-11-18T18:00:00Z";
    },
    (d) => {
      d.city.geo = [0, 0];
    },
    (d) => {
      d.city.geo = null;
    },
    (d) => {
      d.attributions = [];
    },
  ]) {
    const payload = reading();
    mutate(payload.data);
    assert.throws(() => parseStationAir(payload, city, now));
  }
});

test("Station attribution cannot introduce executable links", () => {
  const payload = reading();
  payload.data.attributions[0].url = "javascript:alert(1)";
  assert.equal(parseStationAir(payload, city, now).source.attributions[0].url, null);
});

test("Station requests stay fresh while explicit model mode stays separate", async () => {
  const hosts = [];
  const service = createAirService(
    async (url) => {
      hosts.push(url.hostname);
      return {
        ok: true,
        json: async () =>
          url.hostname === "api.waqi.info"
            ? reading()
            : {
                hourly: { time: [now / 1000], us_aqi: [153], pm2_5: [84], pm10: [85] },
              },
      };
    },
    () => now,
    "test-token",
  );
  assert.equal((await service(city, "live")).aqi, 234);
  await service(city, "live");
  const model = await service(city, "model");
  assert.equal(model.aqi, 153);
  assert.equal(model.source.kind, "model");
  assert.equal(model.mode, "model");
  assert.deepEqual(hosts, ["api.waqi.info", "api.waqi.info", "air-quality-api.open-meteo.com"]);
});

test("Station failure does not silently substitute a model forecast", async () => {
  let calls = 0;
  const service = createAirService(
    async () => {
      calls++;
      throw new Error("Offline");
    },
    () => now,
    "test-token",
  );
  await assert.rejects(service(city, "live"));
  assert.equal(calls, 1);
});
