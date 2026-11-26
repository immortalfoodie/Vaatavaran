import {
  renderDashboard,
  renderForecast,
  renderImpact,
  renderCityComparison,
  el,
} from "./views.js";
import {
  CITIES,
  DEFAULT_PROFILE,
  demoAir,
  normalizeProfile,
  makePlan,
  localAnswer,
  isEmergency,
} from "./engine.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "vaatavaran-v1";
const VALID_PAGES = new Set(["today", "plan", "home", "impact"]);
const VALID_ACTIONS = new Set(["move", "commute", "home"]);

const PAGE_HEADINGS = {
  today: [
    "Today’s Overview",
    "A clearer picture of your air. A thoughtful plan for your day.",
  ],
  plan: [
    "My Daily Plan",
    "Practical steps, tailored to your air and your household.",
  ],
  home: [
    "A Healthier Home",
    "Simple ways to reduce indoor pollution, one room at a time.",
  ],
  impact: [
    "Analytics & Impact",
    "Hourly exposure intensity, commute emissions, and community choices.",
  ],
};

function readStorage() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

const saved = readStorage();
const savedCustom =
  saved.customCity &&
  typeof saved.customCity.name === "string" &&
  Number.isFinite(saved.customCity.lat) &&
  Number.isFinite(saved.customCity.lon)
    ? saved.customCity
    : null;

const state = {
  profile: normalizeProfile(saved.profile || DEFAULT_PROFILE),
  alertAbove: [0, 100, 150, 200].includes(Number(saved.alertAbove))
    ? Number(saved.alertAbove)
    : 0,
  customCity: savedCustom,
  cityId:
    saved.city === "custom" && savedCustom
      ? "custom"
      : CITIES.some((c) => c.id === saved.city)
        ? saved.city
        : "mumbai",
  mode: ["demo", "live", "model"].includes(saved.mode) ? saved.mode : "model",
  air: { aqi: null, hourly: [] },
  forecastAir: null,
  completed: new Set(),
  selectedHourIndex: null,
  requestId: 0,
  chatBusy: false,
};

const currentCity = () =>
  state.cityId === "custom" && state.customCity
    ? { id: "custom", ...state.customCity }
    : CITIES.find((c) => c.id === state.cityId) || CITIES[0];
const dayKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: currentCity().zone }).format(
    new Date(),
  );

if (saved.day === dayKey() && Array.isArray(saved.completed)) {
  state.completed = new Set(
    saved.completed.filter((id) => VALID_ACTIONS.has(id)),
  );
}

function setStatus(message, { showRecovery = false } = {}) {
  $("#status").textContent = message;
  $("#status-banner").hidden = !message;
  $("#status-actions").hidden = !showRecovery;
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: state.profile,
        alertAbove: state.alertAbove,
        customCity: state.customCity,
        city: state.cityId,
        mode: state.mode,
        day: dayKey(),
        completed: [...state.completed],
      }),
    );
  } catch {
    setStatus(
      "Browser storage is unavailable. Your settings work for this session only.",
    );
  }
}

function airQueryUrl(city, mode) {
  if (city.id === "custom") {
    const params = new URLSearchParams({
      lat: String(city.lat),
      lon: String(city.lon),
      name: city.name,
      zone: city.zone || "Asia/Kolkata",
      mode,
    });
    return `/api/air?${params}`;
  }
  return `/api/air?city=${city.id}&mode=${mode}`;
}

function populateCitySelect() {
  const select = $("#city");
  select.replaceChildren();
  for (const city of CITIES) {
    const option = el("option", "", `${city.name} · ${city.region}`);
    option.value = city.id;
    select.append(option);
  }
  if (state.customCity) {
    const opt = el(
      "option",
      "",
      `${state.customCity.name}${state.customCity.region ? " · " + state.customCity.region : ""} (Custom)`,
    );
    opt.value = "custom";
    select.append(opt);
  }
  select.value = state.cityId;
}

function renderForecastOnly() {
  const outlookAir = state.air.hourly?.length
    ? state.air
    : state.forecastAir || state.air;
  const separateOutlook =
    outlookAir !== state.air && Boolean(outlookAir.hourly?.length);
  renderForecast({
    air: outlookAir,
    plan: makePlan(outlookAir, state.profile),
    mode: separateOutlook ? "model" : state.mode,
    city: currentCity(),
    separateOutlook,
    selectedHourIndex: state.selectedHourIndex,
    onSelectHour(index) {
      state.selectedHourIndex = index;
      renderForecastOnly();
    },
  });
}

function render() {
  renderDashboard({
    air: state.air,
    forecastAir: state.forecastAir,
    profile: state.profile,
    city: currentCity(),
    mode: state.mode,
    completed: state.completed,
    selectedHourIndex: state.selectedHourIndex,
    onComplete(id, checked) {
      if (checked) state.completed.add(id);
      else state.completed.delete(id);
      persist();
    },
    onSelectHour(index) {
      state.selectedHourIndex = index;
      renderForecastOnly();
    },
  });
}

function closeMobileNav() {
  $("#top-nav").classList.remove("open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
}

function route() {
  const [rawPage, actionId] = location.hash.slice(1).split("/");
  const page = VALID_PAGES.has(rawPage) ? rawPage : "today";

  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `${page}-view`;
  });
  document.querySelectorAll(".nav-pill[data-page]").forEach((link) => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  closeMobileNav();

  const [title, subtitle] = PAGE_HEADINGS[page];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;

  if (page === "plan" && VALID_ACTIONS.has(actionId)) {
    const card = document.getElementById("action-" + actionId);
    card?.querySelector("details")?.setAttribute("open", "");
    card?.scrollIntoView({ block: "center" });
  }
}

async function loadAir() {
  const id = ++state.requestId;
  const city = currentCity();
  if (city.id === "custom" && state.mode === "demo") {
    state.mode = "model";
    $("#data-mode").value = "model";
  }
  state.selectedHourIndex = null;
  state.forecastAir = null;
  $("#refresh").disabled = true;
  $("#today-view").setAttribute("aria-busy", "true");
  $(".air-card").dataset.state = "loading";
  setStatus(
    state.mode !== "demo" ? "Fetching the selected air-quality source…" : "",
  );

  state.air =
    state.mode === "demo"
      ? demoAir(state.cityId)
      : { aqi: null, hourly: [], pm25: null, pm10: null };
  render();

  try {
    if (state.mode !== "demo") {
      const response = await fetch(airQueryUrl(city, state.mode), {
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Air data unavailable");
      if (id !== state.requestId) return;
      state.air = data;
      if (
        state.alertAbove > 0 &&
        Number.isFinite(data.aqi) &&
        data.aqi >= state.alertAbove
      ) {
        setStatus(
          `Proactive alert: ${city.name} is at US AQI ${data.aqi} (your alert threshold: ${state.alertAbove}+).`,
        );
      } else {
        setStatus("");
      }
      render();

      // Feeds without hourly forecasts (Google Air / WAQI) load the separate CAMS 12h outlook in parallel.
      if (!data.hourly?.length) {
        fetch(airQueryUrl(city, "model"), {
          signal: AbortSignal.timeout(10000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((modelData) => {
            if (id !== state.requestId || !modelData?.hourly?.length) return;
            state.forecastAir = modelData;
            render();
          })
          .catch(() => {
            /* Keep station view intact if regional outlook is temporarily unreachable. */
          });
      }
    }
    $(".air-card").dataset.state = state.mode;
  } catch (error) {
    if (id === state.requestId) {
      // If a ground station feed is unavailable or stale, seamlessly switch to live regional model data.
      if (state.mode === "live") {
        state.mode = "model";
        $("#data-mode").value = "model";
        persist();
        return loadAir();
      }
      $(".air-card").dataset.state = "error";
      setStatus(
        `${error.name === "TimeoutError" ? "Live data timed out." : error.message}`,
        { showRecovery: true },
      );
    }
  } finally {
    if (id === state.requestId) {
      $("#refresh").disabled = false;
      $("#today-view").setAttribute("aria-busy", "false");
    }
  }
}

async function searchAnyCity(query) {
  const container = $("#city-search-results");
  container.replaceChildren(el("p", "source-caption", "Searching locations…"));
  $("#city-search-submit").disabled = true;
  try {
    const response = await fetch(
      `/api/geocode?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search unavailable");
    container.replaceChildren();
    if (!data.results?.length) {
      container.append(
        el("p", "source-caption", "No matching cities found. Try another spelling."),
      );
      return;
    }
    for (const loc of data.results) {
      const btn = el("button", "city-result-btn");
      btn.type = "button";
      const left = el("div");
      left.append(el("strong", "", loc.name), el("span", "", loc.region));
      btn.append(left, el("span", "row-key", "SELECT ↗"));
      btn.addEventListener("click", () => {
        state.customCity = loc;
        state.cityId = "custom";
        if (state.mode === "demo") {
          state.mode = "model";
          $("#data-mode").value = "model";
        }
        state.completed.clear();
        populateCitySelect();
        persist();
        $("#city-dialog").close();
        loadAir();
      });
      container.append(btn);
    }
  } catch (error) {
    container.replaceChildren(el("p", "source-caption", error.message));
  } finally {
    $("#city-search-submit").disabled = false;
  }
}

async function loadCityComparison() {
  const btn = $("#compare-load");
  const container = $("#city-compare-list");
  btn.disabled = true;
  container.replaceChildren(
    el("p", "source-caption", "Fetching live regional readings across cities…"),
  );
  const sample = CITIES.slice(0, 6);
  const settled = await Promise.allSettled(
    sample.map(async (city) => {
      const res = await fetch(airQueryUrl(city, "model"), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("Unavailable");
      const data = await res.json();
      return { city, aqi: data.aqi };
    }),
  );
  const rows = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  renderCityComparison(rows, state.cityId, (pickedId) => {
    state.cityId = pickedId;
    $("#city").value = pickedId;
    state.completed.clear();
    persist();
    location.hash = "#today";
    loadAir();
  });
  btn.disabled = false;
}

function buildPlanText(community = false) {
  const plan = makePlan(state.air, state.profile);
  const station = state.air.source?.kind === "station";
  return [
    "VAATAVARAN · DAILY CLEANER-AIR PLAN",
    `${currentCity().name} · ${dayKey()}`,
    station
      ? "Based on current station guidance. Check the source for the latest numeric reading."
      : `${state.mode.toUpperCase()} DATA · US AQI ${state.air.aqi ?? "unavailable"} · ${plan.category.label}`,
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
      ? `Station source: ${state.air.source.url || "https://waqi.info"}. Numeric station data is not exported.`
      : "Demo data is illustrative. Model data is a regional Open-Meteo / CAMS forecast, not a local sensor reading.",
    "US AQI differs from India AQI. General educational guidance, not medical advice.",
  ].join("\n");
}

function exportPlan(community = false) {
  const url = URL.createObjectURL(
    new Blob([buildPlanText(community)], { type: "text/plain;charset=utf-8" }),
  );
  const a = el("a");
  a.href = url;
  a.download = `vaatavaran-${community ? "community" : "daily"}-plan.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(
    "Your checklist has been downloaded. Household health preferences were excluded.",
  );
}

async function copyPlan() {
  const text = buildPlanText(false);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(
      "Daily plan copied to clipboard (health preferences excluded). Ready to share.",
    );
  } catch {
    exportPlan(false);
  }
}

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

function addMessage(text, who, label) {
  const message = el("div", `message ${who}`);
  message.append(el("span", "message-label", label), el("p", "", text));
  $("#chat-messages").append(message);
  message.scrollIntoView({ block: "nearest" });
  return message;
}

function resetChatMessages() {
  $("#chat-messages").replaceChildren();
  addMessage(
    "I can help turn air-quality information into everyday choices. What would make today easier?",
    "assistant",
    "LOCAL GUIDE",
  );
}

async function ask(question) {
  if (state.chatBusy || !question.trim()) return;
  if (isEmergency(question)) {
    $("#question").value = "";
    addMessage(question, "user", "YOU");
    addMessage(
      localAnswer(question, state.air, state.profile),
      "assistant",
      "URGENT GUIDANCE · ON DEVICE",
    );
    return;
  }
  state.chatBusy = true;
  $("#send-question").disabled = true;
  $("#question").value = "";
  const city = currentCity();
  const context = {
    city: state.cityId,
    ...(city.id === "custom"
      ? { lat: city.lat, lon: city.lon, cityName: city.name, zone: city.zone }
      : {}),
    mode: state.mode,
    profile: { ...state.profile },
    question,
    useAI: $("#ai-optin").checked,
  };
  const snapshotAir = state.air;
  addMessage(question, "user", "YOU");
  const waiting = addMessage(
    "Checking your air and household context…",
    "assistant pending",
    "VAATAVARAN",
  );
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "The assistant is unavailable.");
    addMessage(
      (data.notice ? data.notice + "\n\n" : "") + data.answer,
      "assistant",
      `${data.source === "ai" ? "GEMINI · VERIFY GUIDANCE" : "LOCAL GUIDE"} · ${context.mode.toUpperCase()} DATA`,
    );
  } catch (error) {
    if (context.mode === "demo") {
      addMessage(
        `The server could not answer (${error.message}). Using the on-device guide.\n\n${localAnswer(question, snapshotAir, context.profile)}`,
        "assistant",
        "ON-DEVICE GUIDE · DEMO DATA",
      );
    } else {
      addMessage(
        error.message + " Please retry, or explicitly switch to demo mode.",
        "error",
        "COULD NOT VERIFY LIVE CONTEXT",
      );
    }
  } finally {
    waiting.remove();
    state.chatBusy = false;
    $("#send-question").disabled = false;
    $("#question").focus();
  }
}

function bindEvents() {
  populateCitySelect();
  $("#data-mode").value = state.mode;

  $("#city-search-open")?.addEventListener("click", () => {
    $("#city-dialog").showModal();
    $("#city-query").focus();
  });

  $("#city-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = $("#city-query").value.trim();
    if (q.length >= 2) searchAnyCity(q);
  });

  $("#compare-load")?.addEventListener("click", loadCityComparison);

  $("#city").addEventListener("change", () => {
    state.cityId = $("#city").value;
    state.completed.clear();
    persist();
    loadAir();
  });

  $("#data-mode").addEventListener("change", () => {
    state.mode = $("#data-mode").value;
    state.completed.clear();
    persist();
    loadAir();
  });

  $("#refresh").addEventListener("click", loadAir);
  $("#retry-air")?.addEventListener("click", loadAir);
  $("#switch-to-model")?.addEventListener("click", () => {
    state.mode = "model";
    $("#data-mode").value = "model";
    persist();
    loadAir();
  });

  for (const id of [
    "profile-open",
    "household-edit",
    "home-profile",
    "plan-edit-profile",
  ]) {
    $("#" + id)?.addEventListener("click", openProfile);
  }

  for (const id of ["chat-open", "qa-ask", "plan-ask-ai"]) {
    $("#" + id)?.addEventListener("click", openChat);
  }

  $("#copy-plan")?.addEventListener("click", copyPlan);
  $("#plan-copy")?.addEventListener("click", copyPlan);
  $("#share-plan")?.addEventListener("click", () => exportPlan(false));
  $("#community-export")?.addEventListener("click", () => exportPlan(true));
  $("#chat-clear")?.addEventListener("click", resetChatMessages);

  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#top-nav").classList.toggle("open");
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.profile = normalizeProfile({
      ...Object.fromEntries(data),
      sensitive: data.has("sensitive"),
      purifier: data.has("purifier"),
    });
    const threshold = Number(data.get("alertAbove"));
    state.alertAbove = [0, 100, 150, 200].includes(threshold) ? threshold : 0;
    state.completed.clear();
    persist();
    render();
    $("#profile-dialog").close();
    setStatus("Your daily plan now reflects your household preferences.");
  });

  $("#reset-profile").addEventListener("click", () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* No storage available. */
    }
    state.profile = normalizeProfile(DEFAULT_PROFILE);
    state.alertAbove = 0;
    state.customCity = null;
    if (state.cityId === "custom") state.cityId = "mumbai";
    populateCitySelect();
    state.completed.clear();
    resetChatMessages();
    $("#ai-optin").checked = false;
    render();
    $("#profile-dialog").close();
    setStatus("Saved preferences, progress and this page’s chat have been reset.");
  });

  document.querySelectorAll("[data-close]").forEach((button) =>
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.close).close(),
    ),
  );

  for (const id of ["about-open", "sources-open"]) {
    $("#" + id)?.addEventListener("click", () => $("#about-dialog").showModal());
  }

  $("#impact-distance").addEventListener("input", (event) =>
    renderImpact(event.target.value),
  );

  $("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    ask($("#question").value.trim());
  });

  document.querySelectorAll("[data-question]").forEach((button) =>
    button.addEventListener("click", () => ask(button.dataset.question)),
  );

  window.addEventListener("hashchange", route);
}

let activeDay = dayKey();
function refreshAgingContext() {
  if (document.hidden) return;
  const nextDay = dayKey();
  if (activeDay !== nextDay) {
    activeDay = nextDay;
    state.completed.clear();
    persist();
    render();
  }
  if (
    state.mode !== "demo" &&
    !$("#refresh").disabled &&
    (!state.air.fetchedAt || Date.now() - Date.parse(state.air.fetchedAt) > 600000)
  ) {
    loadAir();
  }
}

bindEvents();
document.addEventListener("visibilitychange", refreshAgingContext);
window.setInterval(refreshAgingContext, 60000);
route();
loadAir();

fetch("/api/health")
  .then((r) => r.json())
  .then((data) => {
    $("#data-mode option[value=live]").textContent = data.googleAir
      ? "GOOGLE AIR (500M)"
      : data.stationData
        ? "STATION FEED"
        : "REGIONAL MODEL";
    if (data.googleAir && !saved.mode && state.mode !== "live") {
      state.mode = "live";
      $("#data-mode").value = "live";
      loadAir();
    }
    $("#ai-optin").disabled = !data.ai;
    $("#ai-availability").textContent = data.ai
      ? "(Gemini · opt-in)"
      : "(server key not configured)";
  })
  .catch(() => {
    $("#ai-availability").textContent = "(offline · local guide available)";
  });
