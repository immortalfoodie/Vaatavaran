import { renderDashboard, renderImpact, el } from "./views.js";
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
const state = {
  profile: normalizeProfile(saved.profile || DEFAULT_PROFILE),
  cityId: CITIES.some((c) => c.id === saved.city) ? saved.city : "delhi",
  mode: ["demo", "live", "model"].includes(saved.mode) ? saved.mode : "live",
  air: { aqi: null, hourly: [] },
  completed: new Set(),
  selectedHourIndex: null,
  requestId: 0,
  chatBusy: false,
};

const currentCity = () => CITIES.find((c) => c.id === state.cityId);
const dayKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: currentCity().zone }).format(
    new Date(),
  );

if (saved.day === dayKey() && Array.isArray(saved.completed)) {
  state.completed = new Set(
    saved.completed.filter((id) => VALID_ACTIONS.has(id)),
  );
}

function setStatus(message) {
  $("#status").textContent = message;
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: state.profile,
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

function render() {
  renderDashboard({
    air: state.air,
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
      render();
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
  state.selectedHourIndex = null;
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
      const response = await fetch(
        `/api/air?city=${state.cityId}&mode=${state.mode}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Air data unavailable");
      if (id !== state.requestId) return;
      state.air = data;
      setStatus("");
      render();
    }
    $(".air-card").dataset.state = state.mode;
  } catch (error) {
    if (id === state.requestId) {
      $(".air-card").dataset.state = "error";
      setStatus(
        `${error.name === "TimeoutError" ? "Live data timed out." : error.message} You can retry or select Demo scenario. No demo data has been substituted.`,
      );
    }
  } finally {
    if (id === state.requestId) {
      $("#refresh").disabled = false;
      $("#today-view").setAttribute("aria-busy", "false");
    }
  }
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
  const context = {
    city: state.cityId,
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
  for (const city of CITIES) {
    const option = el("option", "", `${city.name} · ${city.region}`);
    option.value = city.id;
    $("#city").append(option);
  }
  $("#city").value = state.cityId;
  $("#data-mode").value = state.mode;

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
render();
route();
loadAir();

fetch("/api/health")
  .then((r) => r.json())
  .then((data) => {
    $("#data-mode option[value=live]").textContent = data.stationData
      ? "STATION FEED"
      : "REGIONAL MODEL";
    $("#ai-optin").disabled = !data.ai;
    $("#ai-availability").textContent = data.ai
      ? "(Gemini · opt-in)"
      : "(server key not configured)";
  })
  .catch(() => {
    $("#ai-availability").textContent = "(offline · local guide available)";
  });
