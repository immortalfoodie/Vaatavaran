import test from "node:test";
import assert from "node:assert/strict";
import { createMemo, fetchJson } from "../lib/http.mjs";

test("Memo shares one in-flight request between concurrent callers", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const memo = createMemo(() => 0, { ttlMs: 1000, maxEntries: 10 });
  const loader = async () => {
    calls++;
    await gate;
    return { value: 1 };
  };
  const pending = [memo("k", loader), memo("k", loader), memo("k", loader)];
  release();
  const results = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r === results[0]));
});

test("Memo refreshes after the TTL and does not cache failures", async () => {
  let now = 0;
  let calls = 0;
  const memo = createMemo(() => now, { ttlMs: 100, maxEntries: 10 });
  await memo("k", async () => ++calls);
  await memo("k", async () => ++calls);
  assert.equal(calls, 1);
  now = 101;
  await memo("k", async () => ++calls);
  assert.equal(calls, 2);

  await assert.rejects(
    memo("bad", async () => {
      throw new Error("down");
    }),
  );
  assert.equal(await memo("bad", async () => "recovered"), "recovered");
});

test("Memo stays bounded when many distinct keys are requested", async () => {
  let calls = 0;
  const memo = createMemo(() => 0, { ttlMs: 1000, maxEntries: 3 });
  for (const key of ["a", "b", "c", "d"]) await memo(key, async () => ++calls);
  await memo("a", async () => ++calls);
  assert.equal(calls, 5, "the cache was cleared when it reached its bound");
});

test("fetchJson never relays provider error bodies", async () => {
  const fetcher = async () => ({ ok: false, json: async () => ({ secret: "leak" }) });
  await assert.rejects(fetchJson(fetcher, "https://example.test", "Provider unavailable"), {
    message: "Provider unavailable",
  });
  const ok = async (_url, init) => ({ ok: true, json: async () => ({ hasSignal: !!init.signal }) });
  assert.deepEqual(await fetchJson(ok, "https://example.test", "x"), { hasSignal: true });
});
