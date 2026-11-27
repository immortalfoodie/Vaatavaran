import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AI_REQUESTS_PER_WINDOW,
  MAX_REQUESTS_PER_WINDOW,
  RATE_WINDOW_MS,
  createRateLimiter,
} from "../lib/rate-limit.mjs";

test("Requests above the per-window limit are rejected, then allowed after the window", () => {
  let now = 0;
  const limiter = createRateLimiter(() => now);
  for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) assert.equal(limiter.check("a").ok, true);
  const blocked = limiter.check("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);

  assert.equal(limiter.check("b").ok, true, "limits are per client");
  now += RATE_WINDOW_MS + 1;
  assert.equal(limiter.check("a").ok, true, "a new window resets the count");
});

test("AI quota is a stricter sub-limit of the same window", () => {
  const limiter = createRateLimiter(() => 0);
  const decision = limiter.check("a");
  assert.equal(decision.ok, true);
  for (let i = 0; i < MAX_AI_REQUESTS_PER_WINDOW; i++) {
    assert.equal(limiter.consumeAi(decision.bucket), true);
  }
  assert.equal(limiter.consumeAi(decision.bucket), false);
});

test("Client tracking is bounded so unique IPs cannot exhaust memory", () => {
  let now = 0;
  const limiter = createRateLimiter(() => now);
  let busy = 0;
  for (let i = 0; i < 1500; i++) if (!limiter.check(`ip-${i}`).ok) busy++;
  assert.ok(busy > 0, "new clients are refused once the table is full");
  now += RATE_WINDOW_MS + 1;
  assert.equal(limiter.check("fresh").ok, true, "expired buckets are swept");
});
