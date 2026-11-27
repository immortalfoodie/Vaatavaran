/**
 * Vaatavaran client controller: wires state, hash routing, air loading and UI events.
 * Feature modules (chat, city search, views, storage) receive what they need explicitly.
 */
import { renderDashboard, renderFreshness } from "./views.js";
import { renderForecast, renderImpact } from "./charts.js";
import { clearSavedState, buildPlanText, downloadPlanText } from "./storage.js";
import { CITIES, DEFAULT_PROFILE, demoAir, normalizeProfile, makePlan } from "./engine.js";
import { fetchAir, fetchHealth } from "./api.js";
import { createChat, resetChat } from "./chat.js";
import { bindCitySearch, loadCityComparison } from "./city-search.js";
import {
  ALERT_THRESHOLDS,
  CUSTOM_CITY_ID,
  DEFAULT_CITY_ID,
  VALID_ACTIONS,
  createState,
  currentCity,
  dayKey,
  emptyAir,
  persistState,
} from "./state.js";
import { $, el, setLoadingRegion } from "./dom.js";
import { MINUTE_MS, SECOND_MS } from "./time.js";

/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./state.js").AppState} AppState */
/** @typedef {import("./state.js").CustomCity} CustomCity */
/** @typedef {import("./api.js").Health} Health */

/** @type {ReadonlySet<string>} */
const VALID_PAGES = new Set(["today", "plan", "home", "impact"]);
const STALE_REFRESH_MS = 10 * MINUTE_MS;
const POLL_INTERVAL_MS = MINUTE_MS;
/** How often the "Updated X minutes ago" label is refreshed. */
const FRESHNESS_TICK_MS = 30 * SECOND_MS;

/** @type {Record<string, [title: string, subtitle: string]>} */
const PAGE_HEADINGS = {
  today: ["Today’s Overview", "A clearer picture of your air. A thoughtful plan for your day."],
  plan: ["My Daily Plan", "Practical steps, tailored to your air and your household."],
  home: ["A Healthier Home", "Simple ways to reduce indoor pollution, one room at a time."],
  impact: [
    "Analytics & Impact",
    "Hourly exposure intensity, commute emissions, and community choices.",
  ],
};

/** @type {AppState} */
const state = createState();
const city = () => currentCity(state);
const chat = createChat(() => ({
  cityId: state.cityId,
  city: city(),
  mode: state.mode,
  profile: state.profile,
  air: state.air,
}));

/* ---------- Status & persistence ---------- */

/**
 * Show (or clear, with "") the polite status banner.
 * @param {string} message
 * @param {{ showRecovery?: boolean }} [options] Show "retry / switch source" buttons.
 */
function setStatus(message, { showRecovery = false } = {}) {
  $("#status").textContent = message;
  $("#status-banner").hidden = !message;
  $("#status-actions").hidden = !showRecovery;
}

function persist() {
  if (!persistState(state)) {
    setStatus("Browser storage is unavailable. Your settings work for this session only.");
  }
}

/**
 * Change the data source and keep the selector in sync.
 * @param {DataMode} mode
 */
function setMode(mode) {
  state.mode = mode;
  $("#data-mode").value = mode;
}

/* ---------- Rendering ---------- */

function populateCitySelect() {
  const select = $("#city");
  select.replaceChildren();
  for (const preset of CITIES) {
    const option = el("option", "", `${preset.name} · ${preset.region}`);
    option.value = preset.id;
    select.append(option);
  }
  if (state.customCity) {
    const { name, region } = state.customCity;
    const option = el("option", "", `${name}${region ? ` · ${region}` : ""} (Custom)`);
    option.value = CUSTOM_CITY_ID;
    select.append(option);
  }
  select.value = state.cityId;
}

/** @param {number} index */
function selectHour(index) {
  state.selectedHourIndex = index;
  renderForecastOnly();
}

function renderForecastOnly() {
  const outlookAir = state.air.hourly?.length ? state.air : state.forecastAir || state.air;
  const separateOutlook = outlookAir !== state.air && Boolean(outlookAir.hourly?.length);
  renderForecast({
    air: outlookAir,
    plan: makePlan(outlookAir, state.profile),
    mode: separateOutlook ? "model" : state.mode,
    city: city(),
    separateOutlook,
    selectedHourIndex: state.selectedHourIndex,
    onSelectHour: selectHour,
  });
}

function render() {
  renderDashboard({
    air: state.air,
    forecastAir: state.forecastAir,
    profile: state.profile,
    city: city(),
    mode: state.mode,
    completed: state.completed,
    selectedHourIndex: state.selectedHourIndex,
    onComplete(id, checked) {
      if (checked) state.completed.add(id);
      else state.completed.delete(id);
      persist();
    },
    onSelectHour: selectHour,
  });
}

/* ---------- Routing ---------- */

function closeMobileNav() {
  $("#top-nav").classList.remove("open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
}

function route() {
  const [rawPage, actionId] = location.hash.slice(1).split("/");
  const page = VALID_PAGES.has(rawPage) ? rawPage : "today";

  document.querySelectorAll(".view").forEach((view) => {
    /** @type {HTMLElement} */ (view).hidden = view.id !== `${page}-view`;
  });
  document.querySelectorAll(".nav-pill[data-page]").forEach((link) => {
    const active = /** @type {HTMLElement} */ (link).dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  closeMobileNav();

  const [title, subtitle] = PAGE_HEADINGS[page];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;

  if (page === "plan" && VALID_ACTIONS.has(actionId)) {
    const card = document.getElementById(`action-${actionId}`);
    card?.querySelector("details")?.setAttribute("open", "");
    card?.scrollIntoView({ block: "center" });
  }
}

/* ---------- Air data ---------- */

/**
 * @param {number} aqi
 * @returns {string} Proactive alert text, or "" when below the user's threshold.
 */
function alertMessage(aqi) {
  if (state.alertAbove <= 0 || !Number.isFinite(aqi) || aqi < state.alertAbove) return "";
  return `Proactive alert: ${city().name} is at US AQI ${aqi} (your alert threshold: ${state.alertAbove}+).`;
}

/** @param {boolean} busy */
function setAirBusy(busy) {
  $("#refresh").disabled = busy;
  $("#today-view").setAttribute("aria-busy", String(busy));
  setLoadingRegion("air", busy);
}

/**
 * Reset the dashboard for a new load and show the demo scenario or an empty "checking" state.
 * @returns {number} Request id used to discard stale responses.
 */
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
      setStatus(alertMessage(Number(data.aqi)) || notice);
      render();
    }
    // Google and station readings carry no hourly outlook; fetch the regional model for it.
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
 * Switch to a preset or custom city, resetting today's checklist.
 * @param {string} cityId
 */
function selectCity(cityId) {
  state.cityId = cityId;
  $("#city").value = cityId;
  state.completed.clear();
  persist();
  loadAir();
}

/** @param {CustomCity} loc */
function selectCustomCity(loc) {
  state.customCity = loc;
  if (state.mode === "demo") setMode("model");
  populateCitySelect();
  $("#city-dialog").close();
  selectCity(CUSTOM_CITY_ID);
}

/* ---------- Export ---------- */

/** @param {boolean} [community] */
function planText(community = false) {
  return buildPlanText({
    air: state.air,
    profile: state.profile,
    city: city(),
    mode: state.mode,
    day: dayKey(state),
    community,
  });
}

/** @param {boolean} community */
function exportPlan(community) {
  downloadPlanText(planText(community), community);
  setStatus("Your checklist has been downloaded. Household health preferences were excluded.");
}

async function copyPlan() {
  const text = planText();
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Daily plan copied to clipboard (health preferences excluded). Ready to share.");
  } catch {
    downloadPlanText(text, false);
  }
}

/* ---------- Dialogs & settings ---------- */

function openProfile() {
  closeMobileNav();
  const form = $("#profile-form");
  for (const [key, value] of Object.entries(state.profile)) {
    const field = form.elements.namedItem(key);
    if (field.type === "checkbox") field.checked = value;
    else field.value = value;
  }
  const alertField = form.elements.namedItem("alertAbove");
  if (alertField) alertField.value = String(state.alertAbove);
  $("#profile-dialog").showModal();
}

function openChat() {
  closeMobileNav();
  $("#chat-dialog").showModal();
  $("#question").focus();
}

function openGuide() {
  closeMobileNav();
  $("#guide-dialog").showModal();
}

/** @param {SubmitEvent} event */
function saveProfile(event) {
  event.preventDefault();
  const data = new FormData(/** @type {HTMLFormElement} */ (event.currentTarget));
  state.profile = normalizeProfile({
    ...Object.fromEntries(data),
    sensitive: data.has("sensitive"),
    purifier: data.has("purifier"),
  });
  const threshold = Number(data.get("alertAbove"));
  state.alertAbove = ALERT_THRESHOLDS.has(threshold) ? threshold : 0;
  state.completed.clear();
  persist();
  render();
  $("#profile-dialog").close();
  setStatus("Your daily plan now reflects your household preferences.");
}

function resetSavedData() {
  clearSavedState();
  state.profile = normalizeProfile(DEFAULT_PROFILE);
  state.alertAbove = 0;
  state.customCity = null;
  if (state.cityId === CUSTOM_CITY_ID) state.cityId = DEFAULT_CITY_ID;
  populateCitySelect();
  state.completed.clear();
  resetChat();
  $("#ai-optin").checked = false;
  render();
  $("#profile-dialog").close();
  setStatus("Saved preferences, progress and this page’s chat have been reset.");
}

/**
 * Attach one listener to several optional elements by id.
 * @param {string[]} ids
 * @param {() => void} handler
 */
function onClickAll(ids, handler) {
  for (const id of ids) document.getElementById(id)?.addEventListener("click", handler);
}

function bindEvents() {
  bindCitySearch(selectCustomCity);
  $("#compare-load")?.addEventListener("click", () =>
    loadCityComparison(state.cityId, (pickedId) => {
      location.hash = "#today";
      selectCity(pickedId);
    }),
  );

  $("#city").addEventListener("change", () => selectCity($("#city").value));
  $("#data-mode").addEventListener("change", () => {
    setMode($("#data-mode").value);
    state.completed.clear();
    persist();
    loadAir();
  });
  onClickAll(["refresh", "retry-air"], () => loadAir());
  $("#switch-to-model")?.addEventListener("click", () => {
    setMode("model");
    persist();
    loadAir();
  });

  onClickAll(["profile-open", "household-edit", "home-profile", "plan-edit-profile"], openProfile);
  onClickAll(["chat-open", "qa-ask", "plan-ask-ai"], openChat);
  onClickAll(["about-open", "sources-open"], () => $("#about-dialog").showModal());
  onClickAll(["guide-open", "footer-guide-open"], openGuide);
  $("#guide-open-profile")?.addEventListener("click", () => {
    $("#guide-dialog").close();
    openProfile();
  });

  onClickAll(["copy-plan", "plan-copy"], copyPlan);
  onClickAll(["share-plan"], () => exportPlan(false));
  onClickAll(["community-export"], () => exportPlan(true));
  onClickAll(["chat-clear"], resetChat);

  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#top-nav").classList.toggle("open");
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  $("#profile-form").addEventListener("submit", saveProfile);
  $("#reset-profile").addEventListener("click", resetSavedData);

  document.querySelectorAll("[data-close]").forEach((button) =>
    button.addEventListener("click", () => {
      const dialogId = /** @type {HTMLElement} */ (button).dataset.close ?? "";
      /** @type {HTMLDialogElement | null} */ (document.getElementById(dialogId))?.close();
    }),
  );
  $("#impact-distance").addEventListener("input", (/** @type {Event} */ event) =>
    renderImpact(/** @type {HTMLInputElement} */ (event.target).value),
  );
  $("#chat-form").addEventListener("submit", (/** @type {SubmitEvent} */ event) => {
    event.preventDefault();
    chat.ask($("#question").value);
  });
  document
    .querySelectorAll("[data-question]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        chat.ask(/** @type {HTMLElement} */ (button).dataset.question ?? ""),
      ),
    );
  window.addEventListener("hashchange", route);
}

/* ---------- Background freshness ---------- */

let activeDay = dayKey(state);

/** Reset the checklist at local midnight and refetch readings older than 10 minutes. */
function refreshAgingContext() {
  if (document.hidden) return;
  const nextDay = dayKey(state);
  if (activeDay !== nextDay) {
    activeDay = nextDay;
    state.completed.clear();
    persist();
    render();
  }
  const fetchedAt = state.air.fetchedAt ? Date.parse(state.air.fetchedAt) : 0;
  const stale = Date.now() - fetchedAt > STALE_REFRESH_MS;
  if (state.mode !== "demo" && !$("#refresh").disabled && stale) loadAir();
}

/** Keep the "Updated X minutes ago" label current while the page is visible. */
function tickFreshness() {
  if (!document.hidden) renderFreshness(state.air, state.mode);
}

/** @param {Health} health */
function liveModeOptionLabel(health) {
  if (health.googleAir) return "GOOGLE AIR (500M)";
  if (health.stationData) return "STATION FEED";
  return "REGIONAL MODEL";
}

/**
 * Reflect server capabilities; upgrade to Google Air once when it becomes available.
 * @param {Health} health
 */
function applyHealth(health) {
  $("#data-mode option[value=live]").textContent = liveModeOptionLabel(health);
  if (health.googleAir && !state.googleUpgraded && state.mode !== "demo") {
    state.googleUpgraded = true;
    setMode("live");
    persist();
    loadAir();
  }
  $("#ai-optin").disabled = !health.ai;
  $("#ai-availability").textContent = health.ai
    ? "(Gemini · opt-in)"
    : "(server key not configured)";
}

function init() {
  populateCitySelect();
  $("#data-mode").value = state.mode;
  bindEvents();
  document.addEventListener("visibilitychange", () => {
    tickFreshness();
    refreshAgingContext();
  });
  window.setInterval(refreshAgingContext, POLL_INTERVAL_MS);
  window.setInterval(tickFreshness, FRESHNESS_TICK_MS);
  route();
  loadAir();
  fetchHealth()
    .then(applyHealth)
    .catch(() => {
      $("#ai-availability").textContent = "(offline · local guide available)";
    });
}

init();
