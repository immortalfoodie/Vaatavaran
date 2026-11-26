import test from "node:test";
import assert from "node:assert/strict";
import {
  category,
  demoAir,
  makePlan,
  normalizeProfile,
  impact,
  bestWindow,
  localAnswer,
  activityReadiness,
  CITIES,
  DEFAULT_PROFILE,
} from "../public/engine.js";

for (const [aqi, label] of [
  [0, "Good"],
  [50, "Good"],
  [51, "Moderate"],
  [100, "Moderate"],
  [101, "Unhealthy for sensitive groups"],
  [150, "Unhealthy for sensitive groups"],
  [151, "Unhealthy"],
  [200, "Unhealthy"],
  [201, "Very unhealthy"],
  [300, "Very unhealthy"],
  [301, "Hazardous"],
  [500, "Hazardous"],
]) {
  test(`US AQI boundary ${aqi} is ${label}`, () =>
    assert.equal(category(aqi).label, label));
}
test("Invalid and missing values are never reported as good air", () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 501, "50"])
    assert.equal(category(value).level, -1);
});
test("Sensitive household gets stricter advice at AQI 101", () => {
  const air = { aqi: 101, hourly: [] };
  assert.equal(makePlan(air, { sensitive: true }).high, true);
  assert.equal(makePlan(air, { sensitive: false }).high, false);
});
test("Severe pollution never recommends walking as the clean commute", () => {
  for (const commute of ["car", "transit", "walk"]) {
    const plan = makePlan({ aqi: 310 }, { commute });
    assert.match(plan.cards[0].action, /Postpone strenuous/);
    assert.equal(plan.cards[1].title, "Postpone nonessential trips");
  }
});
test("No-data state prompts monitoring instead of exercise advice", () => {
  const plan = makePlan({ aqi: null }, DEFAULT_PROFILE);
  assert.match(plan.cards[0].action, /data is missing/);
  assert.equal(plan.category.label, "Unavailable");
});
test("Home recommendations respect budget and existing equipment", () => {
  const air = demoAir("delhi");
  assert.match(
    makePlan(air, { purifier: false, budget: "low" }).cards[2].action,
    /Damp-dust/,
  );
  assert.match(
    makePlan(air, { purifier: true }).cards[2].action,
    /Run your particle/,
  );
  assert.match(
    makePlan(air, { budget: "flexible" }).cards[2].action,
    /avoid ozone/,
  );
});
test("Profile validation constrains untrusted values", () => {
  assert.deepEqual(
    normalizeProfile({
      distance: -200,
      commute: "<script>",
      sensitive: "true",
      purifier: 1,
      budget: "expensive",
    }),
    {
      sensitive: false,
      distance: 0,
      commute: "car",
      purifier: false,
      budget: "low",
      outdoor: "morning",
    },
  );
  assert.equal(normalizeProfile({ distance: 900 }).distance, 100);
  assert.equal(normalizeProfile({ distance: "nope" }).distance, 12);
});
test("Carbon estimate uses total daily km without double counting", () => {
  assert.equal(impact({ commute: "car", distance: 12 }).savedKg, 1.32);
  assert.equal(impact({ commute: "transit", distance: 12 }).savedKg, 0);
  assert.equal(impact({ commute: "car", distance: 0 }).savedKg, 0);
});
test("Minimum forecast ignores invalid values and can remain unhealthy", () => {
  assert.equal(bestWindow({ hourly: [] }), null);
  assert.equal(
    bestWindow({ hourly: [{ aqi: null }, { aqi: 240 }, { aqi: 230 }] }).aqi,
    230,
  );
});
test("Demo scenarios are explicit, reproducible and city-specific", () => {
  for (const c of CITIES) {
    const data = demoAir(c.id, 1794902400000);
    assert.equal(data.mode, "demo");
    assert.equal(data.aqi, c.demo);
    assert.equal(data.hourly.length, 12);
    assert.equal(data.hourly[0].aqi, data.aqi);
  }
});
test("Local assistant handles emergency, masks, school and ventilation", () => {
  const air = demoAir("delhi");
  assert.match(
    localAnswer("I have chest pain", air, DEFAULT_PROFILE),
    /urgent medical/,
  );
  assert.match(
    localAnswer("Which mask?", air, DEFAULT_PROFILE),
    /does not filter all gases/,
  );
  assert.match(
    localAnswer("School for my child?", air, DEFAULT_PROFILE),
    /Do not change medication/,
  );
  assert.match(
    localAnswer("Open a window?", air, DEFAULT_PROFILE),
    /combustion fumes/,
  );
  assert.match(
    localAnswer("indoor plants?", air, DEFAULT_PROFILE),
    /not a substitute/,
  );
});

test("A question about a child applies sensitive precautions even with a general profile", () => {
  assert.match(
    localAnswer(
      "Can my child play outdoors?",
      { aqi: 125 },
      { sensitive: false },
    ),
    /Postpone strenuous/,
  );
});

test("Unknown air data never produces an unqualified travel recommendation", () => {
  assert.match(
    makePlan({ aqi: null }, { commute: "car" }).cards[1].action,
    /unavailable/,
  );
});

test("Activity readiness reflects AQI severity, sensitivity, and missing data", () => {
  const unknown = activityReadiness({ aqi: null }, DEFAULT_PROFILE);
  assert.equal(unknown.length, 4);
  assert.ok(unknown.every((item) => item.tone === "unknown"));

  const clean = activityReadiness({ aqi: 35 }, { sensitive: false });
  assert.equal(clean.find((i) => i.id === "exercise").status, "RECOMMENDED");
  assert.equal(clean.find((i) => i.id === "windows").status, "VENTILATE");

  const sensitiveHigh = activityReadiness({ aqi: 120 }, { sensitive: true });
  assert.equal(sensitiveHigh.find((i) => i.id === "exercise").status, "MOVE INDOORS");
  assert.equal(sensitiveHigh.find((i) => i.id === "mask").status, "RECOMMENDED");

  const severe = activityReadiness({ aqi: 260 }, { sensitive: false });
  assert.equal(severe.find((i) => i.id === "exercise").status, "AVOID");
  assert.equal(severe.find((i) => i.id === "mask").status, "STRONGLY ADVISED");
});
