import {
  CITIES,
  DEFAULT_PROFILE,
  category,
  demoAir,
  normalizeProfile,
  makePlan,
  localAnswer,
} from "./engine.js";

const $ = (selector) => document.querySelector(selector);
const KEY = "vaatavaran-v1";
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY)) || {};
} catch {
  /* Storage may be disabled. */
}
let profile = normalizeProfile(saved.profile || DEFAULT_PROFILE);
let cityId = CITIES.some((c) => c.id === saved.city) ? saved.city : "delhi";
let mode = "demo",
  air = demoAir(cityId),
  requestId = 0,
  chatBusy = false;
let completed = new Set();
const currentCity = () => CITIES.find((c) => c.id === cityId);
const dayKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: currentCity().zone }).format(
    new Date(),
  );
if (saved.day === dayKey() && Array.isArray(saved.completed))
  completed = new Set(
    saved.completed.filter((id) => ["move", "commute", "home"].includes(id)),
  );
const icons = { sun: "☼", train: "↔", home: "⌂" };
const timeLabel = (time) =>
  new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    timeZone: currentCity().zone,
  }).format(new Date(time));
function persist() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        profile,
        city: cityId,
        day: dayKey(),
        completed: [...completed],
      }),
    );
  } catch {
    $("#status").textContent =
      "Browser storage is unavailable. Your settings work for this session only.";
  }
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function render() {
  const plan = makePlan(air, profile),
    city = currentCity();
  $("#date-label").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: city.zone,
  })
    .format(new Date())
    .toUpperCase();
  $("#air-location").textContent = `${city.name} · ${city.region}`;
  $("#aqi").textContent = air.aqi ?? "—";
  $("#aqi-category").textContent = plan.category.label;
  $("#aqi-category").className = `badge ${plan.category.tone}`;
  $("#aqi-guidance").textContent =
    plan.category.level < 0
      ? "Check local monitoring"
      : plan.high
        ? "Take extra care outdoors"
        : "Stay aware of local conditions";
  for (const [id, value] of [
    ["pm25", air.pm25],
    ["pm10", air.pm10],
  ]) {
    $("#" + id).replaceChildren(
      document.createTextNode(
        value === null || value === undefined ? "— " : `${Math.round(value)} `,
      ),
      el("small", "", "µg/m³"),
    );
  }
  $("#data-type").replaceChildren(
    document.createTextNode(mode === "demo" ? "Demo " : "Model "),
    el("small", "", mode === "demo" ? "scenario" : "estimate"),
  );
  $("#data-label").textContent =
    mode === "demo" ? "Demo scenario" : "Live model data";
  $("#data-description").textContent =
    mode === "demo"
      ? "Illustrative data, not current conditions"
      : "Open-Meteo / CAMS · not a local sensor";
  $("#observed-label").textContent =
    mode === "demo"
      ? "Illustrative winter-smog scenario · not observed data"
      : air.observedAt
        ? `Model valid ${timeLabel(air.observedAt)} · fetched ${timeLabel(air.fetchedAt)} · local city time`
        : "Live data unavailable · no current reading";
  $("#hero-title").textContent = plan.headline;
  $("#hero-summary").textContent = plan.summary;
  $("#profile-caption").textContent = profile.sensitive
    ? "Sensitive household · edit"
    : "Your preferences · edit";
  $("#home-personal").textContent = plan.cards[2].action;
  $("#chat-context").textContent =
    `${city.name} · ${air.aqi ?? "Unavailable"} US AQI · ${mode === "demo" ? "Demo scenario" : "Live model"} · current household preferences`;
  $("#forecast-label").textContent =
    mode === "demo" ? "DEMO OUTLOOK" : "MODEL FORECAST";
  renderCards(plan);
  renderForecast(plan);
  $("#impact-preview").textContent =
    plan.impact.savedKg > 0
      ? `A ${profile.distance} km switch from solo car to transit could avoid about ${plan.impact.savedKg} kg CO₂. An illustrative estimate, with assumptions you can inspect.`
      : "Your travel choices matter. Explore how a shared or lower-emission journey changes an illustrative carbon footprint.";
  $("#impact-distance").value = profile.distance;
  renderImpact(profile.distance);
}
function renderCards(plan) {
  $("#priorities").replaceChildren();
  $("#full-plan").replaceChildren();
  for (const card of plan.cards) {
    const article = el("article", "card priority-card");
    const top = el("div", "priority-top");
    const icon = el("span", "priority-icon", icons[card.icon]);
    icon.setAttribute("aria-hidden", "true");
    top.append(icon, el("span", "", card.kind));
    const link = el("a", "", "Explore this action →");
    link.href = `#plan`;
    link.setAttribute("aria-label", `Explore: ${card.title}`);
    article.append(
      top,
      el("h3", "", card.title),
      el("p", "", card.action.split(". ")[0] + "."),
      link,
    );
    $("#priorities").append(article);
    const full = el(
      "article",
      `card plan-card${completed.has(card.id) ? " done" : ""}`,
    );
    const body = el("div");
    const details = el("details");
    details.append(
      el("summary", "", "Why this fits your day"),
      el("p", "", card.why),
    );
    body.append(
      el("span", "eyebrow", card.time.toUpperCase()),
      el("h3", "", card.title),
      el("p", "", card.action),
      details,
      el("div", "plan-impact", "↗ " + card.impact),
    );
    const label = el("label", "check-row"),
      check = el("input");
    check.type = "checkbox";
    check.checked = completed.has(card.id);
    check.setAttribute("aria-label", `Mark completed: ${card.title}`);
    check.addEventListener("change", () => {
      check.checked ? completed.add(card.id) : completed.delete(card.id);
      full.classList.toggle("done", check.checked);
      updateCompletion();
      persist();
    });
    label.append(check, document.createTextNode("Done"));
    full.append(icon.cloneNode(true), body, label);
    $("#full-plan").append(full);
  }
  updateCompletion();
}
function updateCompletion() {
  $("#completion").textContent = `${completed.size} of 3 completed`;
}
function renderForecast(plan) {
  $("#forecast").replaceChildren();
  $("#forecast-table").replaceChildren();
  const hours = air.hourly || [],
    max = Math.max(100, ...hours.map((h) => h.aqi));
  // SVG bars avoid inline styles, preserving a strict style CSP.
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i],
      column = el("div", "chart-column");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 100");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const height = Math.max(3, Math.round((h.aqi / max) * 87));
    rect.setAttribute("x", "3");
    rect.setAttribute("y", String(100 - height));
    rect.setAttribute("width", "18");
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "3");
    rect.setAttribute(
      "fill",
      h.aqi > 200 ? "#a4869c" : h.aqi > 100 ? "#c69a74" : "#9aaf7c",
    );
    svg.append(rect);
    column.append(
      el("span", "chart-value", String(h.aqi)),
      svg,
      el("span", "chart-time", i === 0 ? "Now" : timeLabel(h.time)),
    );
    $("#forecast").append(column);
    const row = el("tr");
    row.append(
      el("td", "", timeLabel(h.time)),
      el("td", "", String(h.aqi)),
      el("td", "", category(h.aqi).label),
    );
    $("#forecast-table").append(row);
  }
  $("#forecast").setAttribute(
    "aria-label",
    hours.length
      ? `${mode === "demo" ? "Illustrative" : "Modelled"} hourly US AQI: ${hours.map((h) => `${timeLabel(h.time)}: ${h.aqi}`).join(", ")}. A data table follows.`
      : "Hourly data is unavailable",
  );
  $("#best-window").textContent = plan.best
    ? `Lowest in this outlook: ${timeLabel(plan.best.time)}, AQI ${plan.best.aqi} (${category(plan.best.aqi).label.toLowerCase()}). Lower does not mean safe.`
    : "No forecast is available. Check local monitoring before outdoor activity.";
}
function renderImpact(distance) {
  const value = Number(distance);
  $("#distance-label").textContent = `${value} km`;
  $("#carbon-saving").textContent = (value * 0.11).toFixed(2);
  $("#carbon-formula").textContent =
    `${value} km × (0.17 − 0.06) kg CO₂/km = ${(value * 0.11).toFixed(2)} kg CO₂ per day. Scenario only; not logged as an actual saving.`;
}
function route() {
  const page = ["today", "plan", "home", "impact"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "today";
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.id !== `${page}-view`;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const headings = {
    today: [
      "Let’s make today a little lighter.",
      "A clearer picture of your air. A thoughtful plan for your day.",
    ],
    plan: [
      "Your day, with a little more clarity.",
      "Practical steps, tailored to your air and your household.",
    ],
    home: [
      "A healthier home starts small.",
      "Simple ways to reduce indoor pollution, one room at a time.",
    ],
    impact: [
      "Small choices. A shared difference.",
      "Explore the impact of a lower-emission daily routine.",
    ],
  };
  $("#page-title").textContent = headings[page][0];
  $("#page-subtitle").textContent = headings[page][1];
}
async function loadAir() {
  const id = ++requestId;
  $("#refresh").disabled = true;
  $("#status").textContent =
    mode === "live" ? "Fetching modelled air quality…" : "";
  air =
    mode === "demo"
      ? demoAir(cityId)
      : { aqi: null, hourly: [], pm25: null, pm10: null };
  render();
  try {
    if (mode === "live") {
      const response = await fetch(`/api/air?city=${cityId}&mode=live`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Air data unavailable");
      if (id !== requestId) return;
      air = data;
      $("#status").textContent = "";
      render();
    }
  } catch (error) {
    if (id === requestId)
      $("#status").textContent =
        `${error.name === "TimeoutError" ? "Live data timed out." : error.message} You can retry or select Explore demo. No demo data has been substituted.`;
  } finally {
    if (id === requestId) $("#refresh").disabled = false;
  }
}
function openProfile() {
  const form = $("#profile-form");
  for (const [key, value] of Object.entries(profile)) {
    const field = form.elements.namedItem(key);
    if (field.type === "checkbox") field.checked = value;
    else field.value = value;
  }
  $("#profile-dialog").showModal();
}
function exportPlan(community = false) {
  const plan = makePlan(air, profile);
  const lines = [
    "VAATAVARAN · DAILY CLEANER-AIR PLAN",
    `${currentCity().name} · ${dayKey()}`,
    `${mode.toUpperCase()} DATA · US AQI ${air.aqi ?? "unavailable"} · ${plan.category.label}`,
    "",
    ...(community
      ? [
          "Keep school gates idle-free.",
          "Combine essential journeys and share rides where practical.",
          "Avoid outdoor burning; follow local advisories.",
          "Help neighbours identify cleaner indoor public spaces.",
        ]
      : plan.cards.flatMap((c, i) => [`${i + 1}. ${c.title}`, c.action, ""])),
    "",
    "Demo data is illustrative. Live data is modelled by Open-Meteo / CAMS, not a street-level sensor.",
    "US AQI differs from India AQI. General educational guidance, not medical advice.",
    "Sources: https://www.airnow.gov/aqi/aqi-basics/ · https://www.epa.gov/wildfires/indoor-air-filtration",
  ];
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
  );
  const a = el("a");
  a.href = url;
  a.download = `vaatavaran-${community ? "community" : "daily"}-plan.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("#status").textContent =
    "Your checklist has been exported. Household health preferences were excluded.";
}
function addMessage(text, who, label) {
  const message = el("div", `message ${who}`);
  message.append(el("span", "message-label", label), el("p", "", text));
  $("#chat-messages").append(message);
  message.scrollIntoView({ block: "nearest" });
}
async function ask(question) {
  if (chatBusy || !question.trim()) return;
  chatBusy = true;
  $("#send-question").disabled = true;
  $("#question").value = "";
  const context = {
    city: cityId,
    mode,
    profile: { ...profile },
    question,
    useAI: $("#ai-optin").checked,
  };
  const snapshotAir = air;
  addMessage(question, "user", "YOU");
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
      `${data.source === "ai" ? "AI ASSISTANT · VERIFY GUIDANCE" : "LOCAL GUIDE"} · ${context.mode.toUpperCase()} DATA`,
    );
  } catch (error) {
    if (context.mode === "demo")
      addMessage(
        `The server could not answer (${error.message}). Using the on-device guide.\n\n${localAnswer(question, snapshotAir, context.profile)}`,
        "assistant",
        "ON-DEVICE GUIDE · DEMO DATA",
      );
    else
      addMessage(
        error.message + " Please retry, or explicitly switch to demo mode.",
        "error",
        "COULD NOT VERIFY LIVE CONTEXT",
      );
  } finally {
    chatBusy = false;
    $("#send-question").disabled = false;
    $("#question").focus();
  }
}
for (const city of CITIES) {
  const option = el("option", "", city.name);
  option.value = city.id;
  $("#city").append(option);
}
$("#city").value = cityId;
$("#city").addEventListener("change", () => {
  cityId = $("#city").value;
  completed.clear();
  persist();
  loadAir();
});
$("#data-mode").addEventListener("change", () => {
  mode = $("#data-mode").value;
  completed.clear();
  persist();
  loadAir();
});
$("#refresh").addEventListener("click", loadAir);
$("#profile-open").addEventListener("click", openProfile);
$("#home-profile").addEventListener("click", openProfile);
// Mobile keeps household editing directly reachable through the daily plan.
const edit = el("button", "button secondary", "Edit household preferences");
edit.addEventListener("click", openProfile);
$("#plan-view").prepend(edit);
$("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  profile = normalizeProfile({
    ...Object.fromEntries(data),
    sensitive: data.has("sensitive"),
    purifier: data.has("purifier"),
  });
  completed.clear();
  persist();
  render();
  $("#profile-dialog").close();
  $("#status").textContent =
    "Your daily plan now reflects your household preferences.";
});
$("#reset-profile").addEventListener("click", () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* No storage available. */
  }
  profile = normalizeProfile(DEFAULT_PROFILE);
  completed.clear();
  $("#chat-messages").replaceChildren();
  $("#ai-optin").checked = false;
  render();
  $("#profile-dialog").close();
  $("#status").textContent =
    "Saved preferences, progress and this page’s chat have been reset.";
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.close).close(),
    ),
  );
for (const id of ["about-open", "sources-open"])
  $("#" + id).addEventListener("click", () => $("#about-dialog").showModal());
$("#chat-open").addEventListener("click", () => {
  $("#chat-dialog").showModal();
  $("#question").focus();
});
$("#share-plan").addEventListener("click", () => exportPlan());
$("#community-export").addEventListener("click", () => exportPlan(true));
$("#impact-distance").addEventListener("input", (event) =>
  renderImpact(event.target.value),
);
$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  ask($("#question").value.trim());
});
document
  .querySelectorAll("[data-question]")
  .forEach((button) =>
    button.addEventListener("click", () => ask(button.dataset.question)),
  );
window.addEventListener("hashchange", route);
let activeDay = dayKey();
function refreshAgingContext() {
  if (document.hidden) return;
  const nextDay = dayKey();
  if (activeDay !== nextDay) {
    activeDay = nextDay;
    completed.clear();
    persist();
    render();
  }
  // Do not leave an old reading presented as current in a long-lived tab.
  if (
    mode === "live" &&
    !$("#refresh").disabled &&
    (!air.fetchedAt || Date.now() - Date.parse(air.fetchedAt) > 600000)
  ) loadAir();
}
document.addEventListener("visibilitychange", refreshAgingContext);
window.setInterval(refreshAgingContext, 60000);
render();
route();
fetch("/api/health")
  .then((r) => r.json())
  .then((data) => {
    $("#ai-optin").disabled = !data.ai;
    $("#ai-availability").textContent = data.ai
      ? "(optional)"
      : "(server key not configured)";
  })
  .catch(() => {
    $("#ai-availability").textContent = "(offline · local guide available)";
  });
