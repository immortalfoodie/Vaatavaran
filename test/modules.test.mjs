import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApp } from "../server.mjs";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const IMPORT_PATTERN = /^\s*(?:import|export)\s[^;]*?from\s+"\.\/([\w-]+\.js)"/gm;

/** Walk the browser module graph from app.js, as the browser would. */
async function browserModuleGraph() {
  const seen = new Set();
  const queue = ["app.js"];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = await readFile(new URL(name, PUBLIC_DIR), "utf8");
    for (const [, dep] of source.matchAll(IMPORT_PATTERN)) queue.push(dep);
  }
  return [...seen];
}

test("Every browser module reachable from app.js is served as JavaScript", async (t) => {
  const server = createApp({ apiKey: "", stationToken: "", googleAirKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const modules = await browserModuleGraph();
  assert.ok(modules.length >= 8, `expected the full module graph, got ${modules.join(", ")}`);
  for (const name of modules) {
    const res = await fetch(`${base}/${name}`);
    assert.equal(res.status, 200, `${name} must be allowlisted in server.mjs`);
    assert.match(res.headers.get("content-type"), /text\/javascript/);
  }
});

test("Type-only and server modules are never served", async (t) => {
  const server = createApp({ apiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/types.js", "/lib/http.mjs", "/eslint.config.js", "/jsconfig.json"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
