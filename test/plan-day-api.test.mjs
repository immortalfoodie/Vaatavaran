import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";
import { pm25FromUsAqi, usAqiFromPm } from "../public/aqi-scales.js";
import { formatClock, localMinuteOfDay, relativeDay } from "../public/format.js";
import { planHeadline } from "../public/planner-view.js";

const now = Date.parse("2026-11-27T02:00:00Z");

/** Start a real server on an ephemeral port with mocked providers. */
async function fixture(t, options = {}) {
  const server = createApp({
    apiKey: "",
    stationToken: "",
    googleAirKey: "",
    clock: () => now,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return (body, headers = {}) =>
    fetch(`${base}/api/plan-day`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
}

const demoRequest = {
  city: "delhi",
  mode: "demo",
  profile: { sensitive: true },
  activities: [
    { type: "walk", minutes: 30, time: "09:00", flexible: true },
    { type: "school", minutes: 30, time: "08:00", flexible: false },
  ],
};

test("POST /api/plan-day returns a rule-based plan for the demo scenario", async (t) => {
  const post = await fixture(t);
  const response = await post(demoRequest);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "rules");
  assert.equal(data.forecast.mode, "demo");
  assert.equal(data.plan.steps.length, 2);
  assert.ok(data.plan.steps.every((s) => typeof s.reason === "string" && s.reason.length > 0));
  assert.equal(data.plan.pm25Estimated, true, "demo hours carry AQI only");
});

test("Plan requests are validated and protected like chat", async (t) => {
  const post = await fixture(t);
  assert.equal((await post({ ...demoRequest, activities: [] })).status, 400);
  assert.equal(
    (await post({ ...demoRequest, activities: [{ type: "walk", time: "9am" }] })).status,
    400,
  );
  assert.equal((await post({ ...demoRequest, city: "atlantis" })).status, 400);
  assert.equal((await post(demoRequest, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post(demoRequest, { "Sec-Fetch-Site": "cross-site" })).status, 403);
});

test("Custom cities can never borrow another city's demo scenario", async (t) => {
  const post = await fixture(t);
  const custom = {
    ...demoRequest,
    city: "custom",
    lat: 59.9,
    lon: 10.7,
    cityName: "Oslo",
    zone: "Europe/Oslo",
  };
  assert.equal((await post(custom)).status, 400, "plan-day rejects custom + demo");
});

test("AQI ↔ PM2.5 conversion round-trips and local hours follow the time zone", () => {
  for (const pm25 of [5, 12.3, 45, 80, 150, 300]) {
    assert.ok(Math.abs(pm25FromUsAqi(usAqiFromPm(pm25, null)) - pm25) < 1, `PM2.5 ${pm25}`);
  }
  assert.equal(pm25FromUsAqi(50), 9);
  assert.equal(pm25FromUsAqi(null), null);
  assert.equal(localMinuteOfDay("Asia/Kolkata", "2026-11-27T02:00:00Z"), 7 * 60 + 30);
  assert.equal(localMinuteOfDay("UTC", "2026-11-27T23:00:00Z"), 23 * 60);
  assert.match(formatClock("07:05"), /^7:05\s?am$/i);
  assert.match(formatClock("18:00"), /^6:00\s?pm$/i);
  // 18:00 UTC on the 26th is 23:30 IST; 19:00 UTC is already the 27th in India.
  const evening = Date.parse("2026-11-26T18:00:00Z");
  assert.equal(relativeDay("Asia/Kolkata", "2026-11-26T18:00:00Z", evening), "Today");
  assert.equal(relativeDay("Asia/Kolkata", "2026-11-26T19:00:00Z", evening), "Tomorrow");
  assert.equal(relativeDay("UTC", "2026-11-30T12:00:00Z", evening), null);
});

test("Plan headline states the measured totals and never overclaims", () => {
  const summary = { moved: 2, indoors: 1, baselineDose: 900, plannedDose: 600, reduction: 1 / 3 };
  assert.equal(
    planHeadline(summary, ""),
    "2 activities moved to cleaner hours · about 33% fewer particles breathed · 1 better done indoors today.",
  );
  assert.match(planHeadline({ ...summary, moved: 0, indoors: 0, reduction: 0 }, ""), /already/);
  assert.match(planHeadline(summary, "Gemini says hi."), /^Gemini says hi\. 2 activities/);
});
