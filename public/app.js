/**
 * Vaatavaran client controller: wires state, hash routing, feature modules and UI events.
 */
import { renderDashboard, renderFreshness } from "./views.js";
import { renderForecast, renderImpact } from "./charts.js";
import { clearSavedState, buildPlanText, downloadPlanText } from "./storage.js";
import { CITIES, DEFAULT_PROFILE, impact, normalizeProfile, makePlan } from "./engine.js";
import { fetchHealth } from "./api.js";
import { createChat, resetChat } from "./chat.js";
import { bindCitySearch, loadCityComparison } from "./city-search.js";
import { createAirLoader } from "./air-loader.js";
import { bindDialogClosers, openModal, openProfileDialog, submitProfileForm } from "./dialogs.js";
import {
  CUSTOM_CITY_ID,
  DEFAULT_CITY_ID,
  VALID_ACTIONS,
  createState,
  currentCity,
  dayKey,
  persistState,
} from "./state.js";
import { $, $button, $dialog, $input, $select, el } from "./dom.js";
import { bindThemeToggle } from "./theme.js";
import { bindPlanner } from "./planner-view.js";
import { bindCleanRoom } from "./clean-room-view.js";
import { renderMonthlyImpact } from "./history-view.js";
import {
  clearHistory,
  emptyHistory,
  loadHistory,
  recordChecklist,
  recordPlan,
  saveHistory,
  summarizeMonth,
} from "./history.js";
import { MINUTE_MS, SECOND_MS } from "./time.js";

/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./state.js").AppState} AppState */
/** @typedef {import("./state.js").CustomCity} CustomCity */
/** @typedef {import("./api.js").Health} Health */
/** @typedef {import("./history.js").History} History */
/** @typedef {import("./planner-view.js").PlannerController} PlannerController */

/** @type {ReadonlySet<string>} */
const VALID_PAGES = new Set(["today", "plan", "home", "impact"]);
const STALE_REFRESH_MS = 10 * MINUTE_MS;
const POLL_INTERVAL_MS = MINUTE_MS;
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
const snapshot = () => ({
  cityId: state.cityId,
  city: city(),
  mode: state.mode,
  profile: state.profile,
  air: state.air,
});
const chat = createChat(snapshot);
/** @type {History} Monthly impact, stored only on this device. */
let history = loadHistory();
/** @type {PlannerController | null} */
let planner = null;

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

/** @param {DataMode} mode */
function setMode(mode) {
  state.mode = mode;
  $select("#data-mode").value = mode;
}

function renderHistory() {
  const month = dayKey(state).slice(0, 7);
  renderMonthlyImpact(summarizeMonth(history, month), month);
}

/** @param {(current: History) => History} change */
function updateHistory(change) {
  history = change(history);
  saveHistory(history);
  renderHistory();
}

function recordTodayChecklist() {
  const co2Kg = state.completed.has("commute") ? impact(state.profile).savedKg : 0;
  updateHistory((current) =>
    recordChecklist(current, dayKey(state), { completed: state.completed, co2Kg }),
  );
}

function clearImpactHistory() {
  if (!window.confirm("Clear the monthly impact history saved on this device?")) return;
  clearHistory();
  history = emptyHistory();
  renderHistory();
  setStatus("Monthly impact history cleared from this device.");
}

function populateCitySelect() {
  const select = $select("#city");
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
      recordTodayChecklist();
    },
    onSelectHour: selectHour,
  });
}

const { loadAir } = createAirLoader({ state, setMode, setStatus, persist, render });

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

/** @param {string} cityId */
function selectCity(cityId) {
  state.cityId = cityId;
  $select("#city").value = cityId;
  state.completed.clear();
  persist();
  loadAir();
}

/** @param {CustomCity} loc */
function selectCustomCity(loc) {
  state.customCity = loc;
  if (state.mode === "demo") setMode("model");
  populateCitySelect();
  $dialog("#city-dialog").close();
  selectCity(CUSTOM_CITY_ID);
}

/** @param {boolean} [community] */
const planText = (community = false) =>
  buildPlanText({
    air: state.air,
    profile: state.profile,
    city: city(),
    mode: state.mode,
    day: dayKey(state),
    community,
  });

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

function resetSavedData() {
  clearSavedState();
  state.profile = normalizeProfile(DEFAULT_PROFILE);
  state.alertAbove = 0;
  state.customCity = null;
  if (state.cityId === CUSTOM_CITY_ID) state.cityId = DEFAULT_CITY_ID;
  populateCitySelect();
  state.completed.clear();
  resetChat();
  $input("#ai-optin").checked = false;
  clearHistory();
  history = emptyHistory();
  planner?.reset();
  render();
  renderHistory();
  $dialog("#profile-dialog").close();
  setStatus("Saved preferences, routine, monthly history and this page’s chat have been reset.");
}

/**
 * Attach one listener to several optional elements by id.
 * @param {string[]} ids
 * @param {() => void} handler
 */
function onClickAll(ids, handler) {
  for (const id of ids) document.getElementById(id)?.addEventListener("click", handler);
}

function bindSourceAndCityEvents() {
  bindCitySearch(selectCustomCity);
  $("#compare-load")?.addEventListener("click", () =>
    loadCityComparison(state.cityId, (pickedId) => {
      location.hash = "#today";
      selectCity(pickedId);
    }),
  );
  $select("#city").addEventListener("change", () => selectCity($select("#city").value));
  $select("#data-mode").addEventListener("change", () => {
    setMode(/** @type {DataMode} */ ($select("#data-mode").value));
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
}

function bindDialogAndActionEvents() {
  const openProfile = () => openProfileDialog(state, closeMobileNav);
  const openChat = () => {
    closeMobileNav();
    openModal($dialog("#chat-dialog"), $input("#question"));
  };
  const openGuide = () => {
    closeMobileNav();
    openModal($dialog("#guide-dialog"));
  };

  onClickAll(["profile-open", "household-edit", "home-profile", "plan-edit-profile"], openProfile);
  onClickAll(["chat-open", "qa-ask", "plan-ask-ai"], openChat);
  onClickAll(["about-open", "sources-open"], () => openModal($dialog("#about-dialog")));
  onClickAll(["guide-open", "footer-guide-open"], openGuide);
  $("#guide-open-profile")?.addEventListener("click", () => {
    $dialog("#guide-dialog").close();
    openProfile();
  });
  onClickAll(["copy-plan", "plan-copy"], copyPlan);
  onClickAll(["share-plan"], () => exportPlan(false));
  onClickAll(["community-export"], () => exportPlan(true));
  onClickAll(["chat-clear"], resetChat);
  onClickAll(["impact-clear"], clearImpactHistory);
  bindDialogClosers();
}

function bindEvents() {
  bindSourceAndCityEvents();
  bindDialogAndActionEvents();

  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#top-nav").classList.toggle("open");
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  $("#profile-form").addEventListener("submit", (event) =>
    submitProfileForm(/** @type {SubmitEvent} */ (event), state, {
      onSaved() {
        persist();
        render();
        setStatus("Your daily plan now reflects your household preferences.");
      },
    }),
  );
  $("#reset-profile").addEventListener("click", resetSavedData);
  $input("#impact-distance").addEventListener("input", (event) =>
    renderImpact(/** @type {HTMLInputElement} */ (event.target).value),
  );
  $("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    chat.ask($input("#question").value);
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

let activeDay = dayKey(state);

function refreshAgingContext() {
  if (document.hidden) return;
  const nextDay = dayKey(state);
  if (activeDay !== nextDay) {
    activeDay = nextDay;
    state.completed.clear();
    persist();
    render();
    renderHistory();
  }
  const fetchedAt = state.air.fetchedAt ? Date.parse(state.air.fetchedAt) : 0;
  const stale = Date.now() - fetchedAt > STALE_REFRESH_MS;
  if (state.mode !== "demo" && !$button("#refresh").disabled && stale) loadAir();
}

function tickFreshness() {
  if (!document.hidden) renderFreshness(state.air, state.mode);
}

/** @param {Health} health */
function liveModeOptionLabel(health) {
  if (health.googleAir) return "GOOGLE AIR (500M)";
  if (health.stationData) return "STATION FEED";
  return "REGIONAL MODEL";
}

/** @param {Health} health */
function applyHealth(health) {
  $("#data-mode option[value=live]").textContent = liveModeOptionLabel(health);
  if (health.googleAir && !state.googleUpgraded && state.mode !== "demo") {
    state.googleUpgraded = true;
    setMode("live");
    persist();
    loadAir();
  }
  $input("#ai-optin").disabled = !health.ai;
  $("#ai-availability").textContent = health.ai
    ? "(Gemini · opt-in)"
    : "(server key not configured)";
  planner?.setAiAvailable(health.ai);
}

function init() {
  bindThemeToggle($button("#theme-toggle"));
  bindCleanRoom();
  planner = bindPlanner({
    getSnapshot: snapshot,
    onFollow(summary) {
      updateHistory((current) => recordPlan(current, dayKey(state), summary));
      setStatus("Plan saved to this month’s impact on this device.");
    },
  });
  renderHistory();
  populateCitySelect();
  $select("#data-mode").value = state.mode;
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
