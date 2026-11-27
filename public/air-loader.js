/**
 * Air quality loading coordinator: handles primary fetch, single fallback to regional model,
 * separate outlook loading for current-only sources, and loading/error state management.
 */
import { demoAir } from "./engine.js";
import { fetchAir } from "./api.js";
import { CUSTOM_CITY_ID, currentCity, emptyAir } from "./state.js";
import { $, $button, setLoadingRegion } from "./dom.js";

/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./state.js").AppState} AppState */

/**
 * @param {AppState} state
 * @param {number} aqi
 */
function alertMessage(state, aqi) {
  if (state.alertAbove <= 0 || !Number.isFinite(aqi) || aqi < state.alertAbove) return "";
  return `Proactive alert: ${currentCity(state).name} is at US AQI ${aqi} (your alert threshold: ${state.alertAbove}+).`;
}

/** @param {boolean} busy */
function setAirBusy(busy) {
  $button("#refresh").disabled = busy;
  $("#today-view").setAttribute("aria-busy", String(busy));
  setLoadingRegion("air", busy);
}

/**
 * Build the air-loading controller for the active app state.
 * @param {object} deps
 * @param {AppState} deps.state
 * @param {(mode: DataMode) => void} deps.setMode
 * @param {(message: string, options?: { showRecovery?: boolean }) => void} deps.setStatus
 * @param {() => void} deps.persist
 * @param {() => void} deps.render
 */
export function createAirLoader({ state, setMode, setStatus, persist, render }) {
  const city = () => currentCity(state);

  /** Reset the dashboard for a new load and return a request id to discard stale responses. */
  function beginAirLoad() {
    if (city().id === CUSTOM_CITY_ID && state.mode === "demo") setMode("model");
    state.selectedHourIndex = null;
    state.forecastAir = null;
    state.air = state.mode === "demo" ? demoAir(state.cityId) : emptyAir();
    setAirBusy(true);
    setLoadingRegion("outlook", true);
    $(".air-card").dataset.state = "loading";
    setStatus(state.mode === "demo" ? "" : "Fetching the selected air-quality source…");
    render();
    return ++state.requestId;
  }

  /** @param {unknown} error */
  function showAirError(error) {
    const err = /** @type {Error} */ (error);
    setLoadingRegion("outlook", false);
    $(".air-card").dataset.state = "error";
    setStatus(err.name === "TimeoutError" ? "Live data timed out." : err.message, {
      showRecovery: true,
    });
  }

  /**
   * Sources without an hourly outlook (Google, stations) get a separate, labelled model outlook.
   * @param {number} requestId Discard the result if the user has since changed city or source.
   */
  function loadSeparateOutlook(requestId) {
    fetchAir(city(), "model")
      .then((modelData) => {
        if (requestId !== state.requestId || !modelData.hourly?.length) return;
        state.forecastAir = modelData;
        render();
      })
      .catch(() => {
        /* Keep the primary reading intact if the regional outlook is temporarily unreachable. */
      })
      .finally(() => {
        if (requestId === state.requestId) setLoadingRegion("outlook", false);
      });
  }

  /**
   * Load the primary reading for the selected city and source.
   * If the live source fails, fall back exactly once to the regional model and say so.
   * @param {{ allowFallback?: boolean, notice?: string }} [options]
   */
  async function loadAir({ allowFallback = true, notice = "" } = {}) {
    const id = beginAirLoad();
    const isCurrent = () => id === state.requestId;
    try {
      if (state.mode !== "demo") {
        const data = await fetchAir(city(), state.mode);
        if (!isCurrent()) return;
        state.air = data;
        setStatus(alertMessage(state, Number(data.aqi)) || notice);
        render();
      }
      const needsSeparateOutlook = !state.air.hourly?.length;
      setLoadingRegion("outlook", needsSeparateOutlook);
      if (needsSeparateOutlook) loadSeparateOutlook(id);
      $(".air-card").dataset.state = state.mode;
    } catch (error) {
      if (!isCurrent()) return;
      if (state.mode !== "live" || !allowFallback) {
        showAirError(error);
        return;
      }
      setMode("model");
      persist();
      await loadAir({
        allowFallback: false,
        notice: "The live source was unavailable, so the regional model is shown instead.",
      });
    } finally {
      if (isCurrent()) setAirBusy(false);
    }
  }

  return { loadAir };
}
