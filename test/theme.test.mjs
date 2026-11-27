import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  bindThemeToggle,
  nextTheme,
  normalizeTheme,
  themeButtonLabel,
} from "../public/theme.js";

test("Light is the default and the toggle cycles Light → Dark → Auto → Light", () => {
  assert.equal(DEFAULT_THEME, "light");
  assert.equal(THEMES[0], DEFAULT_THEME, "the cycle starts at the default");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "auto");
  assert.equal(nextTheme("auto"), "light");
});

test("Missing, unknown or tampered stored themes fall back to the light default", () => {
  for (const value of [null, undefined, "", "blue", "AUTO", 1, { theme: "dark" }]) {
    assert.equal(normalizeTheme(value), "light", String(value));
  }
  for (const theme of THEMES) assert.equal(normalizeTheme(theme), theme);
});

test("Toggle's accessible name starts with its visible label and names the next theme", () => {
  assert.equal(themeButtonLabel("light"), "Light theme (default). Switch to dark theme.");
  assert.match(themeButtonLabel("dark"), /^Dark theme .* Switch to auto theme\.$/);
  assert.match(
    themeButtonLabel("auto"),
    /^Auto theme \(follows your device\)\. Switch to light theme\.$/,
  );
});

test("Pre-paint boot script uses the same storage key and explicit themes as theme.js", async () => {
  const boot = await readFile(new URL("../public/theme-boot.js", import.meta.url), "utf8");
  assert.ok(boot.includes(`"${THEME_STORAGE_KEY}"`), "storage key matches");
  for (const theme of THEMES.filter((t) => t !== DEFAULT_THEME)) {
    assert.ok(boot.includes(`"${theme}"`), `boot script applies "${theme}"`);
  }
});

test("Every colour token that changes between themes is defined once with light-dark()", async () => {
  const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /@media \(prefers-color-scheme/, "no duplicated dark palette");
  assert.match(css, /:root \{[^}]*color-scheme: light;/, "light is the CSS default");
  assert.match(css, /:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
  assert.match(css, /:root\[data-theme="auto"\]\s*\{\s*color-scheme: light dark;/);
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  assert.ok((root.match(/light-dark\(/g) || []).length >= 30);
});

test("bindThemeToggle syncs document theme, meta tags, storage and cycles cleanly", () => {
  const store = new Map();
  const root = { dataset: {} };
  const metas = [
    {
      attrs: new Map([
        ["media", "(prefers-color-scheme: light)"],
        ["content", "#f7f8f3"],
      ]),
      getAttribute(k) {
        return this.attrs.get(k) ?? null;
      },
      setAttribute(k, v) {
        this.attrs.set(k, v);
      },
    },
    {
      attrs: new Map([
        ["media", "(prefers-color-scheme: dark)"],
        ["content", "#f7f8f3"],
      ]),
      getAttribute(k) {
        return this.attrs.get(k) ?? null;
      },
      setAttribute(k, v) {
        this.attrs.set(k, v);
      },
    },
  ];
  const icon = { textContent: "" };
  const label = { textContent: "" };
  let onClick = null;
  const button = {
    dataset: {},
    title: "",
    attrs: new Map(),
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
    querySelector(sel) {
      return sel === ".theme-toggle-icon" ? icon : label;
    },
    addEventListener(event, fn) {
      if (event === "click") onClick = fn;
    },
  };

  const prevDoc = globalThis.document;
  const prevStorage = globalThis.localStorage;
  globalThis.document = {
    documentElement: root,
    querySelectorAll: () => metas,
  };
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };

  try {
    bindThemeToggle(null);
    bindThemeToggle(button);
    assert.equal(root.dataset.theme, undefined);
    assert.equal(label.textContent, "LIGHT");
    assert.equal(metas[1].attrs.get("content"), "#f7f8f3");

    onClick();
    assert.equal(root.dataset.theme, "dark");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(label.textContent, "DARK");
    assert.equal(metas[0].attrs.get("content"), "#10150d");

    onClick();
    assert.equal(root.dataset.theme, "auto");
    assert.equal(store.get(THEME_STORAGE_KEY), "auto");
    assert.equal(metas[0].attrs.get("content"), "#f7f8f3");
    assert.equal(metas[1].attrs.get("content"), "#10150d");

    onClick();
    assert.equal(root.dataset.theme, undefined);
    assert.equal(store.has(THEME_STORAGE_KEY), false);
    assert.equal(label.textContent, "LIGHT");
  } finally {
    globalThis.document = prevDoc;
    globalThis.localStorage = prevStorage;
  }
});
