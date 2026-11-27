/**
 * Client application state: restored from browser storage, validated, and persisted.
 * No DOM access; pure state helpers so the rules stay easy to follow and test.
 */
import { CITIES, DEFAULT_PROFILE, normalizeProfile } from "./engine.js";
import { isRecord } from "./guard.js";
import { loadSavedState, saveState } from "./storage.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./types.js").Profile} Profile */

export const DEFAULT_CITY_ID = "mumbai";
export const CUSTOM_CITY_ID = "custom";
export const DEFAULT_ZONE = "Asia/Kolkata";
/** @type {ReadonlySet<string>} */
export const VALID_ACTIONS = new Set(["move", "commute", "home"]);
/** @type {ReadonlySet<number>} 0 disables proactive alerts. */
export const ALERT_THRESHOLDS = new Set([0, 100, 150, 200]);
/** @type {readonly DataMode[]} */
const DATA_MODES = ["demo", "live", "model"];

/**
 * @typedef {object} CustomCity
 * @property {string} name
 * @property {string} [region]
 * @property {number} lat
 * @property {number} lon
 * @property {string} [zone]
 */

/**
 * @typedef {object} AppState
 * @property {Profile} profile
 * @property {number} alertAbove US AQI threshold for the proactive banner (0 = off).
 * @property {CustomCity | null} customCity
 * @property {string} cityId Preset id or CUSTOM_CITY_ID.
 * @property {DataMode} mode
 * @property {boolean} googleUpgraded Whether we already auto-switched to Google Air once.
 * @property {Air} air Primary reading.
 * @property {Air | null} forecastAir Separate model outlook when the primary has no hourly data.
 * @property {Set<string>} completed Completed action ids for today.
 * @property {number | null} selectedHourIndex
 * @property {number} requestId Monotonic id that discards out-of-order air responses.
 */

/** @returns {Air} */
export const emptyAir = () => ({ aqi: null, hourly: [], pm25: null, pm10: null });

/**
 * @param {Record<string, unknown>} saved
 * @returns {CustomCity | null}
 */
function restoreCustomCity(saved) {
  const custom = saved.customCity;
  if (
    !isRecord(custom) ||
    typeof custom.name !== "string" ||
    typeof custom.lat !== "number" ||
    !Number.isFinite(custom.lat) ||
    typeof custom.lon !== "number" ||
    !Number.isFinite(custom.lon)
  ) {
    return null;
  }
  return {
    name: custom.name,
    region: typeof custom.region === "string" ? custom.region : undefined,
    lat: custom.lat,
    lon: custom.lon,
    zone: typeof custom.zone === "string" ? custom.zone : undefined,
  };
}

/**
 * @param {Record<string, unknown>} saved
 * @param {CustomCity | null} customCity
 * @returns {string}
 */
function restoreCityId(saved, customCity) {
  if (saved.city === CUSTOM_CITY_ID && customCity) return CUSTOM_CITY_ID;
  if (typeof saved.city === "string" && CITIES.some((c) => c.id === saved.city)) return saved.city;
  return DEFAULT_CITY_ID;
}

/**
 * Resolve the active city (preset or custom) for a state.
 * @param {Pick<AppState, "cityId" | "customCity">} state
 * @returns {City}
 */
export function currentCity(state) {
  if (state.cityId === CUSTOM_CITY_ID && state.customCity) {
    return { id: CUSTOM_CITY_ID, zone: DEFAULT_ZONE, ...state.customCity };
  }
  return CITIES.find((c) => c.id === state.cityId) || CITIES[0];
}

/**
 * Today's date (YYYY-MM-DD) in the active city's time zone; resets the checklist daily.
 * @param {Pick<AppState, "cityId" | "customCity">} state
 * @returns {string}
 */
export function dayKey(state) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: currentCity(state).zone }).format(new Date());
}

/**
 * Build the initial state from validated browser storage.
 * @returns {AppState}
 */
export function createState() {
  const saved = loadSavedState();
  const customCity = restoreCustomCity(saved);
  const alertAbove = Number(saved.alertAbove);
  /** @type {AppState} */
  const state = {
    profile: normalizeProfile(saved.profile || DEFAULT_PROFILE),
    alertAbove: ALERT_THRESHOLDS.has(alertAbove) ? alertAbove : 0,
    customCity,
    cityId: restoreCityId(saved, customCity),
    mode:
      typeof saved.mode === "string" && DATA_MODES.includes(/** @type {DataMode} */ (saved.mode))
        ? /** @type {DataMode} */ (saved.mode)
        : "model",
    googleUpgraded: saved.googleUpgraded === true,
    air: emptyAir(),
    forecastAir: null,
    completed: new Set(),
    selectedHourIndex: null,
    requestId: 0,
  };
  if (saved.day === dayKey(state) && Array.isArray(saved.completed)) {
    state.completed = new Set(
      saved.completed.filter(
        (/** @type {unknown} */ id) => typeof id === "string" && VALID_ACTIONS.has(id),
      ),
    );
  }
  return state;
}

/**
 * Persist the durable subset of state. Chat and air readings are never stored.
 * @param {AppState} state
 * @returns {boolean} False when browser storage is unavailable.
 */
export function persistState(state) {
  return saveState({
    profile: state.profile,
    alertAbove: state.alertAbove,
    customCity: state.customCity,
    city: state.cityId,
    mode: state.mode,
    googleUpgraded: state.googleUpgraded,
    day: dayKey(state),
    completed: [...state.completed],
  });
}
