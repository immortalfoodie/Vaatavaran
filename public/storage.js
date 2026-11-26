/**
 * Browser-local persistence and plain-text plan export / clipboard helpers.
 */
import { makePlan } from "./engine.js";
import { el } from "./charts.js";

const STORAGE_KEY = "vaatavaran-v1";

/** Safely read saved JSON state from localStorage. */
export function loadSavedState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Persist state snapshot to localStorage; returns false if storage is unavailable. */
export function saveState(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/** Clear saved preferences and daily completion from localStorage. */
export function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

/** Format a privacy-safe plain-text daily or community checklist. */
export function buildPlanText({ air, profile, city, mode, day, community = false }) {
  const plan = makePlan(air, profile);
  const station = air.source?.kind === "station";
  return [
    "VAATAVARAN · DAILY CLEANER-AIR PLAN",
    `${city.name} · ${day}`,
    station
      ? "Based on current station guidance. Check the source for the latest numeric reading."
      : `${mode.toUpperCase()} DATA · US AQI ${air.aqi ?? "unavailable"} · ${plan.category.label}`,
    "",
    ...(community
      ? [
          "• Keep school gates idle-free.",
          "• Combine essential journeys and share rides where practical.",
          "• Avoid outdoor burning; follow local advisories.",
          "• Help neighbours identify cleaner indoor public spaces.",
        ]
      : plan.cards.flatMap((c, i) => [`${i + 1}. ${c.title}`, c.action, ""])),
    "",
    station
      ? `Station source: ${air.source.url || "https://waqi.info"}. Numeric station data is not exported.`
      : "Demo data is illustrative. Live readings reflect the selected air-quality provider.",
    "US AQI differs from India AQI. General educational guidance, not medical advice.",
  ].join("\n");
}

/** Trigger a client-side .txt download of the formatted checklist. */
export function downloadPlanText(text, community = false) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = el("a");
  link.href = url;
  link.download = `vaatavaran-${community ? "community" : "daily"}-plan.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
