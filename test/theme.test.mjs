import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
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
