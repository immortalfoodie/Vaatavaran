import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_SCHEMA,
  aiPlanContext,
  allowedWindows,
  applyAiPlan,
  cleanModelText,
  createDayPlanner,
} from "../lib/day-plan.mjs";
import { planDay } from "../public/planner.js";
import { usAqiFromPm } from "../public/aqi-scales.js";
import { normalizeProfile } from "../public/engine.js";

const START = Date.parse("2026-11-27T00:00:00Z");
const HOUR = 3_600_000;
const city = { id: "delhi", name: "New Delhi", lat: 28.6, lon: 77.2, zone: "UTC" };
const profile = normalizeProfile({ sensitive: false });
const iso = (hour) => new Date(START + hour * HOUR).toISOString();
const hourly = Array.from({ length: 24 }, (_, h) => {
  const pm25 = h >= 13 && h <= 16 ? 30 + Math.abs(15 - h) * 5 : 90;
  return { time: iso(h), aqi: usAqiFromPm(pm25, null), pm25 };
});
const activities = [
  { type: "walk", minutes: 30, time: "07:00", flexible: true },
  { type: "school", minutes: 30, time: "08:00", flexible: false },
];
const basePlan = () => planDay({ hourly, city, activities, profile });

/** Gemini-shaped HTTP response carrying a JSON text part. */
const geminiReply = (json) => ({
  ok: true,
  json: async () => ({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(json) }] } }],
  }),
});

test("Gemini may only choose among the usual time and the rule-checked options", () => {
  const [walk, school] = basePlan().steps.sort((a, b) => a.id.localeCompare(b.id));
  const walkTimes = allowedWindows(walk).map((w) => w.time);
  assert.ok(walkTimes.includes(iso(7)), "usual time is allowed");
  assert.ok(walkTimes.includes(iso(15)), "cleanest option is allowed");
  assert.ok(walkTimes.length <= 4);
  assert.deepEqual(
    allowedWindows(school).map((w) => w.time),
    [iso(8)],
    "fixed stays fixed",
  );
});

test("A valid Gemini choice is applied with its own wording; numbers stay computed", () => {
  const plan = basePlan();
  const ai = {
    summary: "Walk after lunch when the air clears.",
    steps: [
      {
        id: "a1",
        startTime: iso(14),
        reason: "Air is cleaner after lunch.",
        tradeoff: "Later walk.",
      },
    ],
  };
  const merged = applyAiPlan(plan, ai, { profile, city });
  const walk = merged.plan.steps.find((s) => s.id === "a1");
  assert.equal(merged.accepted, 1);
  assert.equal(walk.planned.time, iso(14));
  assert.equal(walk.reason, "Air is cleaner after lunch.");
  assert.equal(Number(walk.reduction.toFixed(3)), Number((1 - 35 / 90).toFixed(3)));
  assert.equal(merged.narrative, "Walk after lunch when the air clears.");
});

test("Invented times, unknown ids, moved fixed activities and clashes are rejected", () => {
  const plan = basePlan();
  const ai = {
    summary: "ignored when nothing is accepted",
    steps: [
      { id: "a1", startTime: iso(3), reason: "3 am is cleanest", tradeoff: "" }, // not offered
      { id: "a2", startTime: iso(15), reason: "move school", tradeoff: "" }, // fixed activity
      { id: "a9", startTime: iso(15), reason: "unknown", tradeoff: "" },
    ],
  };
  const merged = applyAiPlan(plan, ai, { profile, city });
  assert.equal(merged.accepted, 0);
  assert.equal(merged.narrative, "");
  assert.deepEqual(
    merged.plan.steps.map((s) => s.planned.time),
    plan.steps.map((s) => s.planned.time),
    "rule-based plan is kept",
  );

  const clash = applyAiPlan(
    planDay({
      hourly,
      city,
      activities: [activities[0], { type: "school", minutes: 30, time: "14:00", flexible: false }],
      profile,
    }),
    { summary: "", steps: [{ id: "a1", startTime: iso(14), reason: "x", tradeoff: "y" }] },
    { profile, city },
  );
  assert.equal(clash.accepted, 0, "cannot stack the walk onto the school run");
});

test("Model text is stripped of control characters and length-capped", () => {
  assert.equal(cleanModelText("Go\u0000 out\n\tlater", 50), "Go out later");
  assert.equal(cleanModelText("x".repeat(500), 10).length, 10);
  assert.equal(cleanModelText({ not: "text" }, 10), "");
});

test("Gemini context carries only allowed options and no secrets", () => {
  const context = aiPlanContext({ city, plan: basePlan(), profile });
  const walk = context.activities.find((a) => a.id === "a1");
  assert.equal(context.city, "New Delhi");
  assert.ok(walk.allowedStartTimes.every((o) => typeof o.startTime === "string"));
  assert.equal(walk.allowedStartTimes[0].exposureVsUsual, "0%", "usual time is listed first");
  assert.ok(
    walk.allowedStartTimes.slice(1).every((o) => /^-\d+%$/.test(o.exposureVsUsual)),
    "every alternative is cleaner than the usual time",
  );
  assert.deepEqual(PLAN_SCHEMA.required, ["summary", "steps"]);
});

test("Planner service: rules without consent, structured Gemini request with consent", async () => {
  const airFor = async () => ({ mode: "model", hourly, source: { kind: "model" } });
  let request;
  const fetcher = async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
    return geminiReply({
      summary: "Plan ready.",
      steps: [{ id: "a1", startTime: iso(15), reason: "Cleanest hour.", tradeoff: "Afternoon." }],
    });
  };
  const planForDay = createDayPlanner({ airFor, fetcher, apiKeys: ["k"], model: "gemini-test" });
  const base = { city, mode: "model", profile, activities, consumeAi: () => true };

  const rules = await planForDay({ ...base, useAI: false });
  assert.equal(rules.status, 200);
  assert.equal(rules.body.source, "rules");
  assert.equal(request, undefined, "no AI call without consent");

  const ai = await planForDay({ ...base, useAI: true });
  assert.equal(ai.body.source, "ai");
  assert.equal(ai.body.narrative, "Plan ready.");
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(request.body.generationConfig.responseJsonSchema, PLAN_SCHEMA);
  assert.equal(request.headers["x-goog-api-key"], "k");
  assert.doesNotMatch(request.url, /key=/);
});

test("Planner service falls back honestly on AI failure, quota and missing forecast", async () => {
  const airFor = async () => ({ mode: "model", hourly });
  const base = { city, mode: "model", profile, activities, useAI: true, consumeAi: () => true };

  const broken = createDayPlanner({
    airFor,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }],
      }),
    }),
    apiKeys: ["k"],
    model: "m",
  });
  const fallback = await broken({ ...base });
  assert.equal(fallback.body.source, "rules");
  assert.match(fallback.body.notice, /local guide answered/);

  const quota = createDayPlanner({
    airFor,
    fetcher: async () => ({ ok: false, status: 429 }),
    apiKeys: ["k"],
    model: "m",
  });
  assert.match((await quota({ ...base })).body.notice, /quota/);

  const limited = await quota({ ...base, consumeAi: () => false });
  assert.equal(limited.status, 429);

  const noForecast = createDayPlanner({
    airFor: async () => {
      throw new Error("down");
    },
    fetcher: async () => geminiReply({}),
    apiKeys: [],
    model: "m",
  });
  assert.equal((await noForecast({ ...base, useAI: false })).status, 503);
});

test("Sources without an hourly outlook use the regional model for planning", async () => {
  const calls = [];
  const airFor = async (_city, mode) => {
    calls.push(mode);
    return mode === "model" ? { mode: "model", hourly } : { mode: "live", hourly: [] };
  };
  const planForDay = createDayPlanner({ airFor, fetcher: fetch, apiKeys: [], model: "m" });
  const result = await planForDay({
    city,
    mode: "live",
    profile,
    activities,
    useAI: false,
    consumeAi: () => true,
  });
  assert.deepEqual(calls, ["live", "model"]);
  assert.equal(result.body.forecast.mode, "model");
  assert.equal(result.body.plan.steps.length, 2);
});
