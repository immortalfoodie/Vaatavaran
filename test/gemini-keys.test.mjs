import test from "node:test";
import assert from "node:assert/strict";
import { AiProviderError, generateAnswer, generateJson } from "../lib/assistant.mjs";
import { createApp } from "../server.mjs";

const answer = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }),
});
const failure = (status) => ({
  ok: false,
  status,
  json: async () => ({ error: { message: "secret detail" } }),
});

/**
 * Fake Gemini that answers per key, recording which keys were tried in order.
 * @param {Record<string, () => object>} byKey
 */
function fakeGemini(byKey) {
  const tried = [];
  const fetcher = async (_url, init) => {
    const key = init.headers["x-goog-api-key"];
    tried.push(key);
    return byKey[key]();
  };
  return { fetcher, tried };
}

const ask = (fetcher, apiKeys) =>
  generateAnswer({ fetcher, apiKeys, model: "gemini-test", context: { question: "q" } });

test("A rate-limited primary key fails over to the fallback key", async () => {
  const { fetcher, tried } = fakeGemini({
    primary: () => failure(429),
    backup: () => answer("ok"),
  });
  assert.equal(await ask(fetcher, ["primary", "backup"]), "ok");
  assert.deepEqual(tried, ["primary", "backup"]);
});

test("Invalid, revoked or restricted primary keys also fail over", async () => {
  for (const status of [400, 401, 403, 500]) {
    const { fetcher, tried } = fakeGemini({ bad: () => failure(status), good: () => answer("ok") });
    assert.equal(await ask(fetcher, ["bad", "good"]), "ok", `status ${status}`);
    assert.deepEqual(tried, ["bad", "good"]);
  }
});

test("A healthy primary key is used alone; the fallback is never called", async () => {
  const { fetcher, tried } = fakeGemini({
    primary: () => answer("first"),
    backup: () => answer("x"),
  });
  assert.equal(await ask(fetcher, ["primary", "backup"]), "first");
  assert.deepEqual(tried, ["primary"]);
});

test("The quota notice is used only when every key is out of quota", async () => {
  const allLimited = fakeGemini({ a: () => failure(429), b: () => failure(429) });
  await assert.rejects(ask(allLimited.fetcher, ["a", "b"]), (error) => {
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.quota, true);
    assert.doesNotMatch(error.message, /secret detail/, "provider bodies are never relayed");
    return true;
  });

  const mixed = fakeGemini({ a: () => failure(401), b: () => failure(429) });
  await assert.rejects(ask(mixed.fetcher, ["a", "b"]), { quota: false });
});

test("Network errors and blocked answers are not retried with the next key", async () => {
  const offline = fakeGemini({
    a: () => {
      throw new TypeError("fetch failed");
    },
    b: () => answer("never"),
  });
  await assert.rejects(ask(offline.fetcher, ["a", "b"]), /fetch failed/);
  assert.deepEqual(offline.tried, ["a"], "no second deadline after a timeout or network error");

  const blocked = fakeGemini({
    a: () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "SAFETY" }] }) }),
    b: () => answer("never"),
  });
  await assert.rejects(ask(blocked.fetcher, ["a", "b"]), /blocked/);
  assert.deepEqual(blocked.tried, ["a"]);
});

test("Duplicate and blank keys are ignored; no keys means AI is not configured", async () => {
  const { fetcher, tried } = fakeGemini({ same: () => failure(429) });
  await assert.rejects(ask(fetcher, ["same", "", "same"]));
  assert.deepEqual(tried, ["same"], "the same key is never tried twice");
  await assert.rejects(ask(fetcher, []), /not configured/);
});

test("Structured JSON requests use the same failover", async () => {
  const { fetcher, tried } = fakeGemini({
    primary: () => failure(429),
    backup: () => answer('{"summary":"s","steps":[]}'),
  });
  const json = await generateJson({
    fetcher,
    apiKeys: ["primary", "backup"],
    model: "gemini-test",
    instructions: "i",
    payload: {},
    schema: { type: "object" },
  });
  assert.deepEqual(json, { summary: "s", steps: [] });
  assert.deepEqual(tried, ["primary", "backup"]);
});

test("Server chat uses GEMINI_FALLBACK_API_KEY when the primary is rate-limited", async (t) => {
  const { fetcher, tried } = fakeGemini({
    primary: () => failure(429),
    backup: () => answer("Stay in."),
  });
  const airFetcher = async (url, init) =>
    String(url).includes("generativelanguage") ? fetcher(url, init) : failure(503);
  const server = createApp({
    apiKey: "primary",
    fallbackApiKey: "backup",
    stationToken: "",
    googleAirKey: "",
    fetcher: airFetcher,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      city: "delhi",
      mode: "demo",
      profile: {},
      question: "Can I go for a run?",
      useAI: true,
    }),
  });
  const data = await response.json();
  assert.equal(data.source, "ai");
  assert.equal(data.answer, "Stay in.");
  assert.deepEqual(tried, ["primary", "backup"]);

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ai, true);
  assert.equal(JSON.stringify(health).includes("backup"), false, "keys are never exposed");
});

test("A fallback key alone is enough to enable AI", async (t) => {
  const server = createApp({ apiKey: "", fallbackApiKey: "only-backup", stationToken: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const health = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
  assert.equal(health.ai, true);
});
