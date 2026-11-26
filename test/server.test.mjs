import test from "node:test";
import assert from "node:assert/strict";
import { createApp, parseAir } from "../server.mjs";

const now = Date.parse("2026-11-17T12:30:00Z");
function upstream() {
  const start = Math.floor(now / 3600000) * 3600;
  return {
    hourly: {
      time: Array.from({ length: 12 }, (_, i) => start + i * 3600),
      us_aqi: Array.from({ length: 12 }, (_, i) => 180 - i),
      pm2_5: [80],
      pm10: [120],
    },
  };
}
async function fixture(t, options = {}) {
  const server = createApp({ apiKey: "", stationToken: "", clock: () => now, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (path) => fetch(base + path),
    post: (body, headers = {}) =>
      fetch(base + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
  };
}
const question = {
  city: "delhi",
  mode: "demo",
  profile: { sensitive: true },
  question: "Can I exercise outside?",
};
test("Static allowlist protects private files and adds security headers", async (t) => {
  const app = await fixture(t);
  for (const path of [
    "/.env",
    "/server.mjs",
    "/package.json",
    "/.git/config",
    "/..%2f.env",
  ])
    assert.equal((await app.get(path)).status, 404);
  const page = await app.get("/");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
});
test("Unknown city and mode are rejected", async (t) => {
  const app = await fixture(t);
  assert.equal((await app.get("/api/air?city=evil&mode=live")).status, 400);
  assert.equal((await app.get("/api/air?city=delhi&mode=unknown")).status, 400);
});
test("Demo mode does not make external requests", async (t) => {
  const app = await fixture(t, {
    fetcher: () => {
      throw new Error("Must not call");
    },
  });
  const response = await app.get("/api/air?city=delhi&mode=demo");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "demo");
});
test("Live response validates data, caches and coalesces requests", async (t) => {
  let calls = 0;
  const app = await fixture(t, {
    fetcher: async () => {
      calls++;
      return { ok: true, json: async () => upstream() };
    },
  });
  const responses = await Promise.all([
    app.get("/api/air?city=delhi&mode=live"),
    app.get("/api/air?city=delhi&mode=live"),
  ]);
  assert.equal((await responses[0].json()).aqi, 180);
  assert.equal(responses[1].status, 200);
  assert.equal(calls, 1);
});
test("Live failure does not masquerade as demo or clean air", async (t) => {
  const app = await fixture(t, {
    fetcher: async () => {
      throw new Error("Network unavailable");
    },
  });
  const response = await app.get("/api/air?city=delhi&mode=live");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /explicitly switch/);
  assert.equal((await app.post({ ...question, mode: "live" })).status, 503);
});
test("Parser rejects missing, stale, and invalid readings", () => {
  assert.throws(() => parseAir({}, "delhi", now));
  const data = upstream();
  data.hourly.us_aqi[0] = null;
  assert.throws(() => parseAir(data, "delhi", now));
  assert.throws(() => parseAir(upstream(), "delhi", now + 86400000));
});
test("Malformed, oversized and hostile chat requests fail safely", async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post("{invalid")).status, 400);
  assert.equal((await app.post("null")).status, 400);
  assert.equal((await app.post({ ...question, question: "" })).status, 400);
  assert.equal(
    (await app.post({ ...question, question: "a".repeat(1001) })).status,
    400,
  );
  assert.equal(
    (await app.post({ ...question, junk: "a".repeat(9000) })).status,
    413,
  );
  assert.equal(
    (await app.post(question, { Origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal(
    (await app.post(question, { "Content-Type": "text/plain" })).status,
    415,
  );
});
test("Without consent, configured AI still uses local guide", async (t) => {
  const app = await fixture(t, {
    apiKey: "fake-secret",
    fetcher: () => {
      throw new Error("No consent");
    },
  });
  const data = await (await app.post(question)).json();
  assert.equal(data.source, "local");
  assert.match(data.answer, /Postpone strenuous/);
});
test("GenAI receives server-trusted context and never exposes credentials", async (t) => {
  let payload;
  const app = await fixture(t, {
    apiKey: "fake-secret",
    fetcher: async (_url, options) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: "Keep activity indoors in this demo scenario." },
                ],
              },
            },
          ],
        }),
      };
    },
  });
  const data = await (
    await app.post({ ...question, useAI: true, air: { aqi: 0 } })
  ).json();
  assert.equal(data.source, "ai");
  assert.equal(JSON.parse(payload.contents[0].parts[0].text).air.aqi, 286);
  assert.match(payload.systemInstruction.parts[0].text, /Never invent/);
  assert.ok(!JSON.stringify(data).includes("fake-secret"));
});
test("Provider failure and empty AI output return labeled local fallback", async (t) => {
  for (const result of [
    { ok: false },
    { ok: true, json: async () => ({ output: [] }) },
  ]) {
    const app = await fixture(t, {
      apiKey: "fake",
      fetcher: async () => result,
    });
    const data = await (await app.post({ ...question, useAI: true })).json();
    assert.equal(data.source, "local");
    assert.match(data.notice, /unavailable/);
  }
});
test("Emergency escalation bypasses generative AI", async (t) => {
  const app = await fixture(t, {
    apiKey: "fake",
    fetcher: () => {
      throw new Error("Must not call");
    },
  });
  const data = await (
    await app.post({ ...question, useAI: true, question: "I cannot breathe" })
  ).json();
  assert.equal(data.source, "local");
  assert.match(data.answer, /urgent medical/);
});
test("Per-client request limits prevent unlimited requests", async (t) => {
  const app = await fixture(t);
  for (let i = 0; i < 60; i++)
    assert.equal((await app.get("/api/air?city=delhi&mode=demo")).status, 200);
  assert.equal((await app.get("/api/air?city=delhi&mode=demo")).status, 429);
});

test("Gemini free-tier quota failure uses an explicit local fallback", async (t) => {
  const app = await fixture(t, {
    apiKey: "fake",
    fetcher: async () => ({ ok: false, status: 429 }),
  });
  const data = await (await app.post({ ...question, useAI: true })).json();
  assert.equal(data.source, "local");
  assert.match(data.notice, /quota/);
});

test("Emergency guidance is available even when live air and AI are unreachable", async (t) => {
  const app = await fixture(t, {
    apiKey: "fake",
    fetcher: () => {
      throw new Error("Must not call any provider");
    },
  });
  const response = await app.post({
    ...question,
    mode: "live",
    useAI: true,
    question: "I can’t breathe",
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).answer, /urgent medical/);
});

test("Blocked and truncated Gemini responses never appear as complete AI guidance", async (t) => {
  for (const finishReason of ["SAFETY", "MAX_TOKENS"]) {
    const app = await fixture(t, {
      apiKey: "fake",
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason,
              content: { parts: [{ text: "Incomplete advice" }] },
            },
          ],
        }),
      }),
    });
    const data = await (await app.post({ ...question, useAI: true })).json();
    assert.equal(data.source, "local");
    assert.ok(!data.answer.includes("Incomplete advice"));
  }
});

test("Parser computes 24-hour delta when yesterday reading is available", () => {
  const start = Math.floor(now / 3600000) * 3600;
  const parsed = parseAir(
    {
      hourly: {
        time: [start - 86400, start, start + 3600],
        us_aqi: [160, 182, 175],
        pm2_5: [70, 88, 82],
        pm10: [110, 130, 124],
      },
    },
    "delhi",
    now,
  );
  assert.equal(parsed.aqi, 182);
  assert.equal(parsed.yesterdayAqi, 160);
  assert.equal(parsed.delta24h, 22);
});

test("Geocode and custom-coordinate air endpoints validate inputs safely", async (t) => {
  const app = await fixture(t, {
    fetcher: async (url) => {
      const href = String(url);
      if (href.includes("geocoding-api")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                name: "Chandigarh",
                admin1: "Chandigarh",
                country: "India",
                latitude: 30.7333,
                longitude: 76.7794,
                timezone: "Asia/Kolkata",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => upstream() };
    },
  });
  assert.equal((await app.get("/api/geocode?q=a")).status, 400);
  const geo = await (await app.get("/api/geocode?q=Chandigarh")).json();
  assert.equal(geo.results[0].name, "Chandigarh");

  assert.equal((await app.get("/api/air?lat=999&lon=77&mode=model")).status, 400);
  assert.equal((await app.get("/api/air?lat=30.73&lon=76.77&mode=demo")).status, 400);
  const custom = await app.get("/api/air?lat=30.73&lon=76.77&name=Chandigarh&mode=model");
  assert.equal(custom.status, 200);
  assert.equal((await custom.json()).aqi, 180);
});

test("HTTPS proxy header enables HSTS and health reports Google Air status", async (t) => {
  const app = await fixture(t, { googleAirKey: "test-google-key" });
  const healthRes = await fetch(
    `http://127.0.0.1:${(await app.get("/api/health")).url.match(/:(\d+)/)[1]}/api/health`,
    { headers: { "x-forwarded-proto": "https" } },
  );
  assert.equal(healthRes.status, 200);
  assert.match(healthRes.headers.get("strict-transport-security"), /max-age=31536000/);
  const health = await healthRes.json();
  assert.equal(health.googleAir, true);
});

test("Modular client assets are allowlisted and served as JavaScript", async (t) => {
  const app = await fixture(t);
  for (const asset of ["/app.js", "/charts.js", "/storage.js", "/views.js", "/engine.js"]) {
    const res = await app.get(asset);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/javascript/);
  }
});
