import test from "node:test";
import assert from "node:assert/strict";
import { formatRelativeAge, formatTime } from "../public/format.js";

const now = Date.parse("2026-11-27T12:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();
const MINUTE = 60_000;

test("Relative age reads naturally from seconds to days", () => {
  assert.equal(formatRelativeAge(ago(10_000), now), "just now");
  assert.equal(formatRelativeAge(ago(MINUTE), now), "1 minute ago");
  assert.equal(formatRelativeAge(ago(4 * MINUTE + 59_000), now), "4 minutes ago");
  assert.equal(formatRelativeAge(ago(2 * 60 * MINUTE), now), "2 hours ago");
  assert.equal(formatRelativeAge(ago(26 * 60 * MINUTE), now), "yesterday");
});

test("Small clock skew never shows a reading as being from the future", () => {
  assert.equal(formatRelativeAge(new Date(now + 30_000).toISOString(), now), "just now");
});

test("Missing or invalid timestamps produce no label instead of a wrong one", () => {
  assert.equal(formatRelativeAge(undefined, now), null);
  assert.equal(formatRelativeAge("", now), null);
  assert.equal(formatRelativeAge("not a date", now), null);
});

test("Clock times are shown in the selected city's time zone", () => {
  const time = "2026-11-27T12:00:00Z";
  assert.match(formatTime({ zone: "Asia/Kolkata" }, time), /^5:30\s?pm$/i);
  assert.match(formatTime({ zone: "UTC" }, time), /^12:00\s?pm$/i);
});
