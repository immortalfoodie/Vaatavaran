import { category, makePlan, impact, activityReadiness } from "./engine.js";

const $ = (selector) => document.querySelector(selector);
const SVG_NS = "http://www.w3.org/2000/svg";

const formatTime = (city, time) =>
  new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: city.zone,
  }).format(new Date(time));

const formatShortHour = (city, time) =>
  new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    timeZone: city.zone,
  }).format(new Date(time));

/** Create an HTML element with optional class and text. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Create an SVG element with stringified attributes (CSP-safe, no inline styles). */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function getSourceLabel(mode, kind) {
  if (mode === "demo") return "Demo scenario";
  if (kind === "google") return "Google Air Quality (500m)";
  return kind === "station" ? "Station-reported AQI" : "Regional forecast estimate";
}

/** Main stateless dashboard renderer: coordinates focused section renderers. */
export function renderDashboard({
  air,
  forecastAir,
  profile,
  city,
  mode,
  completed,
  selectedHourIndex,
  onComplete,
  onSelectHour,
}) {
  const plan = makePlan(air, profile);
  const kind = air.source?.kind || "model";
  const station = kind === "station";
  const sourceLabel = getSourceLabel(mode, kind);
  const outlookAir = air.hourly?.length ? air : forecastAir || air;
  const outlookPlan = outlookAir === air ? plan : makePlan(outlookAir, profile);
  const separateOutlook = outlookAir !== air && Boolean(outlookAir.hourly?.length);

  renderHeaderMeta({ air, plan, profile, city, sourceLabel });
  renderAirCard({ air, forecastAir, plan, city, mode, station, sourceLabel });
  renderBriefCard({ plan, outlookPlan, city, station, separateOutlook });
  renderPriorities({ plan, completed, onComplete });
  renderProfileSummary(profile, city);
  renderForecast({
    air: outlookAir,
    plan: outlookPlan,
    mode: separateOutlook ? "model" : mode,
    city,
    separateOutlook,
    selectedHourIndex,
    onSelectHour,
  });
  renderActivityReadiness(air, profile);
  renderExposureMatrix(outlookAir, city);
  renderSignals(outlookAir, outlookPlan, completed);

  $("#home-personal").textContent = plan.cards[2].action;
  $("#chat-context").textContent =
    `${city.name} · ${air.aqi ?? "Unavailable"} US AQI · ${sourceLabel} · current household preferences`;
  $("#impact-preview").textContent =
    plan.impact.savedKg > 0
      ? `Switching a ${profile.distance} km solo car commute to transit could avoid ~${plan.impact.savedKg} kg CO₂/day (illustrative scenario).`
      : "Your travel choices matter. Explore how a shared or lower-emission journey changes an illustrative carbon footprint.";
  $("#impact-distance").value = profile.distance;
  renderImpact(profile.distance);
}

function renderHeaderMeta({ air, plan, profile, city }) {
  const hasReading = Number.isFinite(air.aqi);
  $("#date-label").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: city.zone,
  })
    .format(new Date())
    .toUpperCase();
  $("#profile-caption").textContent = profile.sensitive
    ? "SENSITIVE HOUSEHOLD"
    : "STANDARD HOUSEHOLD";
  $("#header-aqi-count").textContent = hasReading
    ? String(Math.round(air.aqi))
    : "—";
  $("#header-aqi-label").textContent = plan.category.label.toUpperCase();
}

function renderAirCard({ air, forecastAir, plan, city, mode, station, sourceLabel }) {
  const hasReading = Number.isFinite(air.aqi);
  $("#air-heading").textContent = hasReading
    ? sourceLabel.toUpperCase()
    : "AIR DATA UNAVAILABLE";
  $("#air-location").textContent = station
    ? air.source.station
    : `${city.name} · ${city.region}`;
  $("#aqi").textContent = hasReading ? String(Math.round(air.aqi)) : "—";
  $("#aqi-category").textContent = plan.category.label.toUpperCase();
  $("#aqi-category").className = `status-tag ${plan.category.tone}`;

  const delta = Number.isFinite(air.delta24h)
    ? air.delta24h
    : Number.isFinite(forecastAir?.delta24h)
      ? forecastAir.delta24h
      : null;
  const deltaEl = $("#aqi-delta");
  if (delta !== null && mode !== "demo") {
    deltaEl.hidden = false;
    deltaEl.className = `delta-pill${delta > 0 ? " worse" : ""}`;
    const suffix = Number.isFinite(air.delta24h) ? "VS YESTERDAY" : "MODEL 24H";
    deltaEl.textContent =
      delta === 0
        ? `SAME ${suffix}`
        : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)} ${suffix}`;
  } else {
    deltaEl.hidden = true;
  }

  $("#aqi-guidance").textContent =
    plan.category.level < 0
      ? "Check local monitoring"
      : plan.high
        ? "Take extra care outdoors"
        : "Stay aware of local conditions";

  renderSegmentedMeter(air.aqi);

  const whoEl = $("#who-context");
  if (!station && Number.isFinite(air.pm25) && air.pm25 > 0) {
    const ratio = (air.pm25 / 15).toFixed(1);
    whoEl.hidden = false;
    whoEl.textContent =
      air.pm25 > 15
        ? `Hourly PM2.5 is ~${ratio}× the WHO 24h guideline (15 µg/m³).`
        : "Hourly PM2.5 is within the WHO 24h guideline (15 µg/m³).";
  } else {
    whoEl.hidden = true;
  }

  for (const [id, value] of [
    ["pm25", station ? air.pollutantAqi?.pm25 : air.pm25],
    ["pm10", station ? air.pollutantAqi?.pm10 : air.pm10],
  ]) {
    const available = Number.isFinite(value);
    $("#" + id).replaceChildren(
      ...(available
        ? [
          document.createTextNode(`${Math.round(value)} `),
          el("small", "", station ? "US AQI" : "µg/m³"),
        ]
        : [el("small", "", "Not reported")]),
    );
  }

  const isGoogle = air.source?.kind === "google";
  $("#data-type").replaceChildren(
    document.createTextNode(
      mode === "demo"
        ? "Demo "
        : isGoogle
          ? "Google "
          : station
            ? "Station "
            : "Model ",
    ),
    el(
      "small",
      "",
      mode === "demo"
        ? "scenario"
        : isGoogle
          ? "500m live"
          : station
            ? "report"
            : "forecast",
    ),
  );
  $("#data-label").textContent = hasReading
    ? mode === "demo"
      ? "DEMO DATA"
      : isGoogle
        ? "GOOGLE 500M LIVE"
        : station
          ? "STATION LIVE"
          : "MODEL LIVE"
    : "CHECKING DATA";
  $("#data-description").textContent =
    mode === "demo"
      ? "Illustrative winter-smog scenario · not current conditions"
      : isGoogle
        ? `Google Air Quality · 500 m sensor-fused grid${air.localIndex ? ` · ${air.localIndex.name}: ${air.localIndex.aqi}` : ""}`
        : station
          ? `WAQI · station ${air.source.distanceKm} km from city centre`
          : "Copernicus CAMS global model · ~45 km resolution";

  $("#observed-label").textContent =
    mode === "demo"
      ? "Demo scenario · switch to Best Source for live data"
      : air.observedAt
        ? `${isGoogle ? "Google updated" : station ? "Station reported" : "Model valid"} ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: city.zone }).format(new Date(air.observedAt))} · fetched ${formatTime(city, air.fetchedAt)}`
        : "No valid reading for the selected source";

  $("#source-warning").textContent =
    mode === "demo"
      ? "Illustrative scenario. Do not use these numbers as current conditions."
      : isGoogle
        ? "US AQI computed from Google Air Quality 500 m PM2.5/PM10 concentrations. Street-level micro-conditions can still vary."
        : station
          ? "PM values are pollutant-specific US AQI, not concentrations (µg/m³). One nearby station, not a city-wide average. Data is provisional."
          : "Not a street-level sensor reading. Local pollution may differ substantially.";

  renderAttribution(air, mode);
  $(".air-card").dataset.tone = plan.category.tone;
}

function renderBriefCard({ plan, outlookPlan, city, station, separateOutlook }) {
  $("#hero-title").textContent = plan.headline;
  $("#hero-summary").textContent = plan.summary;
  $("#outdoor-summary").textContent =
    plan.category.level < 0
      ? "Check local monitor"
      : plan.high
        ? "Move indoors"
        : "Quieter routes";
  $("#window-summary").textContent = plan.high
    ? "Keep peaks out"
    : "Ventilate cleanly";
  const best = plan.best || outlookPlan?.best;
  $("#best-slot").textContent = best
    ? `${formatTime(city, best.time)} · AQI ${best.aqi}${separateOutlook ? " (model)" : ""}`
    : station
      ? "Loading model…"
      : "Unavailable";
}

function renderSegmentedMeter(aqi) {
  const container = $("#aqi-meter");
  container.replaceChildren();
  const total = 20;
  const filled = Number.isFinite(aqi)
    ? Math.max(1, Math.min(total, Math.round((aqi / 350) * total)))
    : 0;
  for (let i = 0; i < total; i++) {
    container.append(el("span", i < filled ? "seg-block filled" : "seg-block"));
  }
}

function renderAttribution(air, mode) {
  const container = $("#source-attribution");
  container.replaceChildren();
  if (mode === "demo" || !air.source) return;
  const credits = [
    { name: air.source.name, url: air.source.url },
    ...(air.source.attributions || []),
  ];
  for (const credit of credits) {
    if (container.childNodes.length)
      container.append(document.createTextNode(" · "));
    const node = el(credit.url ? "a" : "span", "", credit.name);
    if (credit.url) {
      node.href = credit.url;
      node.target = "_blank";
      node.rel = "noreferrer";
    }
    container.append(node);
  }
}

function renderProfileSummary(profile, city) {
  const dl = $("#plan-profile-dl");
  dl.replaceChildren();
  const commuteLabels = {
    car: "Solo car",
    transit: "Public transit",
    walk: "Walk / cycle",
    home: "Work from home",
  };
  const rows = [
    ["CITY", city.name],
    ["SENSITIVITY", profile.sensitive ? "High (Sensitive)" : "Standard"],
    ["COMMUTE", commuteLabels[profile.commute] || profile.commute],
    ["DAILY DISTANCE", `${profile.distance} km`],
    ["AIR PURIFIER", profile.purifier ? "Available" : "None"],
    ["BUDGET", profile.budget === "flexible" ? "Flexible" : "No-cost first"],
    ["EXERCISE", profile.outdoor],
  ];
  for (const [k, v] of rows) {
    const item = el("div");
    item.append(el("dt", "", k), el("dd", "", v));
    dl.append(item);
  }
}

function renderPriorities({ plan, completed, onComplete }) {
  const overviewList = $("#priorities");
  const fullList = $("#full-plan");
  overviewList.replaceChildren();
  fullList.replaceChildren();

  const toggleAction = (id, checked) => {
    onComplete(id, checked);
    updateCompletion(completed);
    document
      .querySelectorAll(`[data-action-id="${id}"]`)
      .forEach((node) => node.classList.toggle("done", checked));
    document
      .querySelectorAll(`input[data-action-check="${id}"]`)
      .forEach((box) => {
        box.checked = checked;
      });
  };

  for (const card of plan.cards) {
    const isDone = completed.has(card.id);

    // Spacious Overview Priority Card (with interactive checkbox)
    const overviewCard = el("article", `priority-card${isDone ? " done" : ""}`);
    overviewCard.dataset.actionId = card.id;

    const top = el("div", "priority-card-top");
    top.append(el("span", "priority-card-kicker", `${card.kind} · ${card.time}`));

    const quickLabel = el("label", "check-row");
    const quickCheck = el("input");
    quickCheck.type = "checkbox";
    quickCheck.checked = isDone;
    quickCheck.dataset.actionCheck = card.id;
    quickCheck.setAttribute("aria-label", `Mark completed: ${card.title}`);
    quickCheck.addEventListener("change", () =>
      toggleAction(card.id, quickCheck.checked),
    );
    quickLabel.append(quickCheck, document.createTextNode("DONE"));
    top.append(quickLabel);

    const foot = el("div", "priority-card-foot");
    const link = el("a", "", "[WHY & DETAILS ↗]");
    link.href = `#plan/${card.id}`;
    link.setAttribute("aria-label", `Explore: ${card.title}`);
    foot.append(el("span", "row-key", card.time), link);

    overviewCard.append(
      top,
      el("h3", "", card.title),
      el("p", "", card.action.split(/(?<=\.)\s+/)[0]),
      foot,
    );
    overviewList.append(overviewCard);

    // Full Plan Card
    const full = el("article", `plan-card${isDone ? " done" : ""}`);
    full.id = `action-${card.id}`;
    full.dataset.actionId = card.id;

    const body = el("div");
    const details = el("details");
    details.append(
      el("summary", "", "WHY THIS FITS YOUR DAY"),
      el("p", "", card.why),
    );
    body.append(
      el("span", "plan-card-eyebrow", `${card.kind} · ${card.time}`),
      el("h3", "", card.title),
      el("p", "", card.action),
      details,
      el("div", "plan-impact", "↗ " + card.impact),
    );

    const label = el("label", "check-row");
    const check = el("input");
    check.type = "checkbox";
    check.checked = isDone;
    check.dataset.actionCheck = card.id;
    check.setAttribute("aria-label", `Mark completed: ${card.title}`);
    check.addEventListener("change", () => toggleAction(card.id, check.checked));
    label.append(check, document.createTextNode("DONE"));

    full.append(body, label);
    fullList.append(full);
  }
  updateCompletion(completed);
}

function updateCompletion(completed) {
  const count = completed.size;
  $("#completion").textContent = `${count} OF 3 COMPLETED`;
  $("#header-done-count").textContent = String(count);
  $("#brief-progress").textContent = `${count} OF 3 DONE`;
}

/** Interactive Stacked-Circle Dot-Matrix Chart + Hour Inspector (exported for fast targeted updates). */
export function renderForecast({
  air,
  plan,
  mode,
  city,
  separateOutlook = false,
  selectedHourIndex,
  onSelectHour,
}) {
  const chart = $("#forecast");
  const pills = $("#hour-pills");
  const table = $("#forecast-table");
  chart.replaceChildren();
  pills.replaceChildren();
  table.replaceChildren();

  $("#forecast-label").textContent =
    mode === "demo"
      ? "DEMO OUTLOOK"
      : separateOutlook
        ? "SEPARATE CAMS MODEL"
        : air.source?.kind === "station"
          ? "STATION FEED"
          : "REGIONAL MODEL";

  const hours = (air.hourly || []).slice(0, 12);
  if (!hours.length) {
    $("#inspector-reading").textContent = "Hourly forecast unavailable for this feed";
    chart.append(
      el("p", "forecast-note", "Select Regional model or Demo scenario to view the 12-hour outlook."),
    );
    $("#best-window").textContent =
      air.source?.kind === "station"
        ? "This station feed does not supply an hourly forecast. Select Regional model for the CAMS outlook."
        : "No forecast is available. Check local monitoring before outdoor activity.";
    return;
  }

  const bestIdx = hours.findIndex((h) => h.time === plan.best?.time);
  const activeIdx =
    Number.isInteger(selectedHourIndex) &&
      selectedHourIndex >= 0 &&
      selectedHourIndex < hours.length
      ? selectedHourIndex
      : bestIdx >= 0
        ? bestIdx
        : 0;

  const activeHour = hours[activeIdx];
  const activeCat = category(activeHour.aqi);
  $("#inspector-reading").textContent =
    `${activeIdx === 0 ? "Now" : formatTime(city, activeHour.time)} · AQI ${activeHour.aqi} (${activeCat.label})${activeIdx === bestIdx ? " · Lowest in window" : ""}`;

  const maxAqi = Math.max(120, ...hours.map((h) => h.aqi));
  const maxDots = 9;
  const width = 380;
  const height = 168;
  const padL = 30;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const colW = plotW / hours.length;
  const dotR = Math.min(5.6, colW * 0.34);
  const dotStep = plotH / maxDots;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true",
  });

  svg.append(
    svgEl("line", {
      x1: padL,
      y1: padT,
      x2: padL,
      y2: height - padB,
      stroke: "#23371b",
      "stroke-width": 1,
    }),
    svgEl("line", {
      x1: padL,
      y1: height - padB,
      x2: width - padR,
      y2: height - padB,
      stroke: "#23371b",
      "stroke-width": 1,
    }),
  );

  for (const frac of [0, 0.5, 1]) {
    const y = height - padB - frac * plotH;
    const t = svgEl("text", {
      x: padL - 6,
      y: y + 3,
      "text-anchor": "end",
      "font-size": 8.5,
      fill: "#23371b",
      "font-family": "sans-serif",
    });
    t.textContent = String(Math.round(frac * maxAqi));
    svg.append(t);
  }

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const cx = padL + colW * i + colW / 2;
    const dots = Math.max(1, Math.round((h.aqi / maxAqi) * maxDots));
    const isSelected = i === activeIdx;

    for (let d = 0; d < dots; d++) {
      const cy = height - padB - dotStep * d - dotR - 2;
      svg.append(
        svgEl("circle", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: dotR.toFixed(1),
          fill: isSelected ? "#23371b" : "#ebf3db",
          stroke: "#23371b",
          "stroke-width": 1,
        }),
      );
    }

    if (i === 0 || i === 3 || i === 6 || i === 9 || i === hours.length - 1) {
      const lbl = svgEl("text", {
        x: cx.toFixed(1),
        y: height - 8,
        "text-anchor": "middle",
        "font-size": 8.5,
        fill: "#23371b",
        "font-family": "sans-serif",
      });
      lbl.textContent = i === 0 ? "NOW" : formatShortHour(city, h.time).toUpperCase();
      svg.append(lbl);
    }

    const btn = el(
      "button",
      `hour-pill${isSelected ? " selected" : ""}`,
      i === 0 ? "NOW" : formatShortHour(city, h.time).replace(/\s+/g, "").toUpperCase(),
    );
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(isSelected));
    btn.addEventListener("click", () => onSelectHour(i));
    pills.append(btn);

    const row = el("tr");
    row.append(
      el("td", "", formatTime(city, h.time)),
      el("td", "", String(h.aqi)),
      el("td", "", category(h.aqi).label),
    );
    table.append(row);
  }
  chart.append(svg);

  chart.setAttribute(
    "aria-label",
    `${mode === "demo" ? "Illustrative" : "Modelled"} hourly US AQI: ${hours.map((h) => `${formatTime(city, h.time)}: ${h.aqi}`).join(", ")}. A data table follows.`,
  );
  $("#best-window").textContent = plan.best
    ? `${separateOutlook ? "Separate regional model (not a continuation of the station reading). " : ""}Lowest in outlook: ${formatTime(city, plan.best.time)} · AQI ${plan.best.aqi} (${category(plan.best.aqi).label.toLowerCase()}). Lower does not mean safe.`
    : "";
}

/** Deterministic "Can I Go Out?" Readiness Rows. */
function renderActivityReadiness(air, profile) {
  const container = $("#activity-readiness");
  container.replaceChildren();
  for (const item of activityReadiness(air, profile)) {
    const row = el("div", "readiness-row");
    const head = el("div", "readiness-row-head");
    head.append(
      el("strong", "", item.label),
      el("span", `status-tag ${item.tone}`, item.status),
    );
    row.append(head, el("p", "", item.note));
    container.append(row);
  }
}

/** 4-Band Relative Olive Intensity Heatmap (Analytics View). */
function renderExposureMatrix(air, city) {
  const container = $("#exposure-matrix");
  container.replaceChildren();
  const hours = (air.hourly || []).slice(0, 12);
  const maxAqi = Math.max(100, ...hours.map((h) => h.aqi));
  const minAqi = hours.length ? Math.min(...hours.map((h) => h.aqi)) : 0;
  const span = Math.max(25, maxAqi - minAqi);
  const bands = [
    { label: "PEAK", frac: 0.75, baseLvl: 4 },
    { label: "HIGH", frac: 0.5, baseLvl: 3 },
    { label: "MOD", frac: 0.25, baseLvl: 2 },
    { label: "BASE", frac: 0, baseLvl: 1 },
  ];

  for (const band of bands) {
    const row = el("div", "density-row");
    row.append(el("span", "density-label", band.label));
    for (let i = 0; i < 12; i++) {
      const h = hours[i];
      let lvl = 0;
      if (h && Number.isFinite(h.aqi)) {
        const rel = (h.aqi - minAqi) / span;
        if (rel >= band.frac) {
          lvl = Math.min(
            4,
            Math.max(1, band.baseLvl - (rel < band.frac + 0.18 ? 1 : 0)),
          );
        } else if (band.baseLvl === 1) {
          lvl = 1;
        }
      }
      row.append(el("span", `density-cell${lvl ? ` lvl-${lvl}` : ""}`));
    }
    container.append(row);
  }

  const times = el("div", "density-times");
  times.append(el("span", "", ""));
  for (let i = 0; i < 12; i++) {
    const h = hours[i];
    times.append(
      el(
        "span",
        "",
        h
          ? i === 0
            ? "NOW"
            : formatShortHour(city, h.time).replace(/\s*(am|pm)/i, "$1")
          : "—",
      ),
    );
  }
  container.append(times);
}

/** Proportional Signal Bars (Analytics View). */
function renderSignals(air, plan, completed) {
  const container = $("#signal-bars");
  container.replaceChildren();
  const hours = air.hourly || [];
  const highHours = hours.filter((h) => category(h.aqi).level >= 3).length;
  const modHours = hours.filter((h) => {
    const l = category(h.aqi).level;
    return l === 1 || l === 2;
  }).length;
  const goodHours = hours.filter((h) => category(h.aqi).level === 0).length;

  const items = hours.length
    ? [
      {
        count: String(modHours).padStart(2, "0"),
        label: "CAUTION HOURS",
        width: modHours > 6 ? "bar-w-85" : modHours > 2 ? "bar-w-70" : "bar-w-55",
        highlight: false,
      },
      {
        count: String(highHours).padStart(2, "0"),
        label: "HIGH-RISK HOURS",
        width: highHours > 0 ? "bar-w-100" : "bar-w-55",
        highlight: highHours > 0,
      },
      {
        count: String(goodHours).padStart(2, "0"),
        label: "GOOD-AIR HOURS",
        width: goodHours > 6 ? "bar-w-85" : "bar-w-55",
        highlight: false,
      },
    ]
    : [
      {
        count: String(completed.size).padStart(2, "0"),
        label: "ACTIONS COMPLETED",
        width: "bar-w-55",
        highlight: false,
      },
      {
        count: Number.isFinite(air.aqi) ? String(Math.round(air.aqi)) : "—",
        label: plan.category.label.toUpperCase(),
        width: "bar-w-100",
        highlight: plan.high,
      },
      {
        count: String(Math.max(0, 3 - completed.size)).padStart(2, "0"),
        label: "ACTIONS REMAINING",
        width: "bar-w-70",
        highlight: false,
      },
    ];

  for (const item of items) {
    const track = el("div", "signal-track");
    const bar = el(
      "div",
      `signal-bar ${item.width}${item.highlight ? " highlight" : ""}`,
    );
    bar.append(el("strong", "", item.count), el("span", "", item.label));
    track.append(bar);
    container.append(track);
  }
}

/** Diagonal-Hatched vs Solid Forest Bar Chart (Analytics View). */
export function renderImpact(distance) {
  const value = Number(distance);
  const estimate = impact({ commute: "car", distance: value });
  $("#distance-label").textContent = `${value} km`;
  $("#carbon-saving").textContent = estimate.savedKg.toFixed(2);
  $("#carbon-formula").textContent =
    `${value} km × (0.17 − 0.06) kg CO₂/km = ${estimate.savedKg.toFixed(2)} kg CO₂ per day. Scenario only; not logged as an actual saving.`;

  const chart = $("#impact-chart");
  if (!chart) return;
  chart.replaceChildren();

  const carKg = Number((value * 0.17).toFixed(2));
  const transitKg = Number((value * 0.06).toFixed(2));
  const maxVal = Math.max(0.5, carKg);
  const carH = Math.max(14, Math.round((carKg / maxVal) * 92));
  const transitH = Math.max(10, Math.round((transitKg / maxVal) * 92));

  const svg = svgEl("svg", {
    viewBox: "0 0 360 134",
    "aria-hidden": "true",
  });

  const defs = svgEl("defs");
  const pattern = svgEl("pattern", {
    id: "diag-hatch",
    width: 8,
    height: 8,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(
    svgEl("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 8,
      stroke: "#23371b",
      "stroke-width": 2.4,
    }),
  );
  defs.append(pattern);
  svg.append(defs);

  const tY = 118 - transitH;
  svg.append(
    svgEl("rect", {
      x: 14,
      y: tY,
      width: 156,
      height: transitH,
      fill: "url(#diag-hatch)",
      stroke: "#23371b",
      "stroke-width": 1,
    }),
  );
  const tLabel = svgEl("text", {
    x: 14,
    y: tY - 6,
    "font-size": 9,
    "font-weight": 700,
    fill: "#4a5444",
    "font-family": "sans-serif",
  });
  tLabel.textContent = `PUBLIC TRANSIT (${transitKg.toFixed(2)} KG)`;
  svg.append(tLabel);

  const cY = 118 - carH;
  svg.append(
    svgEl("rect", {
      x: 190,
      y: cY,
      width: 156,
      height: carH,
      fill: "#23371b",
    }),
  );
  const cLabel = svgEl("text", {
    x: 190,
    y: cY - 6,
    "font-size": 9,
    "font-weight": 700,
    fill: "#23371b",
    "font-family": "sans-serif",
  });
  cLabel.textContent = `SOLO CAR (${carKg.toFixed(2)} KG)`;
  svg.append(cLabel);

  chart.append(svg);
}

/** Render live side-by-side city comparison cards on Analytics view. */
export function renderCityComparison(rows, activeCityId, onPickCity) {
  const container = $("#city-compare-list");
  container.replaceChildren();
  if (!rows.length) {
    container.append(
      el("p", "source-caption", "Could not load city comparison right now."),
    );
    return;
  }
  for (const row of rows) {
    const cat = category(row.aqi);
    const btn = el(
      "button",
      `compare-card${row.city.id === activeCityId ? " current" : ""}`,
    );
    btn.type = "button";
    btn.append(
      el("span", "row-key", row.city.name),
      el("strong", "", Number.isFinite(row.aqi) ? String(row.aqi) : "—"),
      el("span", `status-tag ${cat.tone}`, cat.label.toUpperCase()),
    );
    btn.addEventListener("click", () => onPickCity(row.city.id));
    container.append(btn);
  }
}
