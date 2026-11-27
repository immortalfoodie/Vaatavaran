import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanText } from "../public/storage.js";
import { currentCity, dayKey } from "../public/state.js";
import { CITIES, demoAir, normalizeProfile } from "../public/engine.js";

const delhi = CITIES.find((c) => c.id === "delhi");
const sensitiveProfile = normalizeProfile({ sensitive: true, commute: "car", distance: 30 });

test("Daily plan export lists the three actions and never names health sensitivity", () => {
  const text = buildPlanText({
    air: demoAir("delhi"),
    profile: sensitiveProfile,
    city: delhi,
    mode: "demo",
    day: "2026-11-27",
  });
  assert.match(text, /New Delhi · 2026-11-27/);
  assert.match(text, /DEMO DATA · US AQI 286 · Very unhealthy/);
  assert.match(text, /^1\. /m);
  assert.match(text, /^3\. /m);
  assert.doesNotMatch(text, /sensitive household|asthma|sensitivity/i);
  assert.match(text, /not medical advice/);
});

test("Community export uses only shared, non-personal actions", () => {
  const text = buildPlanText({
    air: demoAir("delhi"),
    profile: sensitiveProfile,
    city: delhi,
    mode: "demo",
    day: "2026-11-27",
    community: true,
  });
  assert.match(text, /school gates idle-free/);
  assert.doesNotMatch(text, /^1\. /m);
});

test("Station exports never include the numeric station reading", () => {
  const air = {
    aqi: 234,
    source: { kind: "station", name: "WAQI", url: "https://waqi.info/x" },
  };
  const text = buildPlanText({
    air,
    profile: sensitiveProfile,
    city: delhi,
    mode: "live",
    day: "2026-11-27",
  });
  assert.doesNotMatch(text, /234/);
  assert.match(text, /Numeric station data is not exported/);
});

test("Unavailable air is exported as unavailable, not as a number", () => {
  const text = buildPlanText({
    air: { aqi: null },
    profile: sensitiveProfile,
    city: delhi,
    mode: "model",
    day: "2026-11-27",
  });
  assert.match(text, /US AQI unavailable · Unavailable/);
});

test("Active city resolves presets, custom locations and unknown ids safely", () => {
  assert.equal(currentCity({ cityId: "delhi", customCity: null }).name, "New Delhi");
  assert.equal(currentCity({ cityId: "nowhere", customCity: null }).id, CITIES[0].id);
  const custom = currentCity({
    cityId: "custom",
    customCity: { name: "Oslo", lat: 59.9, lon: 10.7 },
  });
  assert.equal(custom.id, "custom");
  assert.equal(custom.zone, "Asia/Kolkata", "missing zones default to India time");
  assert.match(dayKey({ cityId: "delhi", customCity: null }), /^\d{4}-\d{2}-\d{2}$/);
});
