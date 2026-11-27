import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  HttpError,
  MAX_BODY_BYTES,
  getClientIp,
  readJsonBody,
  resolveCustomCity,
} from "../lib/request.mjs";

test("Custom coordinates accept the exact geographic bounds", () => {
  for (const [lat, lon] of [
    [90, 180],
    [-90, -180],
    [0, 0],
  ]) {
    const city = resolveCustomCity(String(lat), String(lon), "Edge", "Asia/Kolkata");
    assert.ok(city, `${lat},${lon} should be valid`);
    assert.equal(city.lat, lat);
    assert.equal(city.lon, lon);
  }
});

test("Custom coordinates reject out-of-range, missing and non-numeric values", () => {
  for (const [lat, lon] of [
    ["90.01", "0"],
    ["0", "-180.5"],
    ["abc", "1"],
    [null, "1"],
    ["1", undefined],
    ["Infinity", "1"],
  ]) {
    assert.equal(resolveCustomCity(lat, lon, "x", "UTC"), null, `${lat},${lon}`);
  }
});

test("Custom city names are trimmed and bounded; unsafe time zones fall back to UTC", () => {
  const city = resolveCustomCity("19", "72", `  ${"N".repeat(200)}  `, "../../etc/passwd");
  assert.equal(city.name.length, 80);
  assert.equal(city.zone, "UTC");
  assert.equal(resolveCustomCity("19.5", "72.25", "", "Asia/Kolkata").name, "19.50, 72.25");
  assert.match(resolveCustomCity("19", "72", "x", "Asia/Kolkata").id, /^custom:19\.000,72\.000$/);
});

test("JSON bodies are parsed from streams, strings and pre-parsed objects", async () => {
  const stream = Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]);
  stream.headers = {};
  assert.deepEqual(await readJsonBody(stream), { a: 1 });
  assert.deepEqual(await readJsonBody({ body: '{"b":2}' }), { b: 2 });
  assert.deepEqual(await readJsonBody({ body: { c: 3 } }), { c: 3 });
});

test("Oversized and malformed JSON bodies raise client-safe HTTP errors", async () => {
  const huge = JSON.stringify({ q: "x".repeat(MAX_BODY_BYTES) });
  for (const [req, status] of [
    [{ body: huge }, 413],
    [{ body: { q: "x".repeat(MAX_BODY_BYTES) } }, 413],
    [{ body: "{not json" }, 400],
    [{ body: null }, 400],
    [{ body: 42 }, 400],
  ]) {
    await assert.rejects(readJsonBody(req), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test("Forwarded IP headers are trusted only behind an explicitly configured proxy", (t) => {
  const req = { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: {} };
  req.socket.remoteAddress = "127.0.0.1";
  const previous = process.env.TRUST_PROXY;
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });
  delete process.env.TRUST_PROXY;
  if (!process.env.VERCEL) assert.equal(getClientIp(req), "127.0.0.1");
  process.env.TRUST_PROXY = "1";
  assert.equal(getClientIp(req), "203.0.113.9");
});
