/**
 * "Plan my day" UI: the household's routine form and the planned timeline.
 * Planning itself happens on the server (rules, optionally Gemini); this module only
 * collects activities, calls the API and renders the result.
 */
import { ACTIVITY_TYPES, MAX_ACTIVITIES } from "./planner.js";
import { category } from "./engine.js";
import { cityContext, postDayPlan } from "./api.js";
import { formatClock, formatTime, relativeDay } from "./format.js";
import { loadJson, removeKey, saveJson } from "./storage.js";
import { $, el } from "./dom.js";

/** @typedef {import("./planner.js").DayPlan} DayPlan */
/** @typedef {import("./planner.js").PlanStep} PlanStep */
/** @typedef {import("./planner.js").PlanSummary} PlanSummary */
/** @typedef {import("./api.js").PlanReply} PlanReply */
/** @typedef {import("./chat.js").ChatSnapshot} Snapshot */

/**
 * @typedef {object} RoutineRow One editable activity, as stored and shown in the form.
 * @property {string} type
 * @property {string} label Custom name ("" uses the preset name).
 * @property {number} minutes
 * @property {string} time "HH:MM"
 * @property {boolean} flexible
 */

const ROUTINE_KEY = "vaatavaran-routine";
/** @type {RoutineRow[]} A typical weekday, shown until the household saves its own. */
const DEFAULT_ROUTINE = [
  { type: "walk", label: "", minutes: 30, time: "07:00", flexible: true },
  { type: "school", label: "", minutes: 30, time: "08:00", flexible: false },
  { type: "airing", label: "", minutes: 15, time: "09:00", flexible: true },
  { type: "exercise", label: "", minutes: 45, time: "18:00", flexible: true },
];

/** @type {Record<string, string>} Visible tag text for each step status. */
const STATUS_LABELS = {
  moved: "MOVED",
  keep: "KEEP TIME",
  fixed: "FIXED",
  indoors: "MOVE INDOORS",
  unavailable: "NOT IN FORECAST",
};

/**
 * Coerce stored rows; falls back to the default routine when nothing valid is saved.
 * @returns {RoutineRow[]}
 */
function loadRoutine() {
  const saved = loadJson(ROUTINE_KEY);
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_ROUTINE;
  return saved.slice(0, MAX_ACTIVITIES).map((row) => ({
    type: Object.hasOwn(ACTIVITY_TYPES, row?.type) ? row.type : "walk",
    label: typeof row?.label === "string" ? row.label : "",
    minutes: Number(row?.minutes) || 30,
    time: typeof row?.time === "string" ? row.time : "07:00",
    flexible: row?.flexible === true,
  }));
}

/**
 * Wrap a control in a visible label.
 * @param {string} text
 * @param {HTMLElement} control
 */
function field(text, control) {
  const label = el("label", "routine-field");
  label.append(el("span", "routine-field-label", text), control);
  return label;
}

/**
 * @param {string} name
 * @param {string} type
 * @param {Record<string, string | number>} attrs
 * @returns {HTMLInputElement}
 */
function input(name, type, attrs) {
  const node = /** @type {HTMLInputElement} */ (el("input"));
  node.name = name;
  node.type = type;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * One editable activity row.
 * @param {RoutineRow} row
 * @param {number} index
 * @param {() => void} onRemove
 */
function routineRow(row, index, onRemove) {
  const wrap = el("div", "routine-row");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", `Activity ${index + 1}`);

  const type = /** @type {HTMLSelectElement} */ (el("select"));
  type.name = "type";
  for (const [value, preset] of Object.entries(ACTIVITY_TYPES)) {
    const option = el("option", "", preset.label);
    option.value = value;
    type.append(option);
  }
  type.value = row.type;

  const label = input("label", "text", { maxlength: 40, placeholder: "Optional name" });
  label.value = row.label;
  const minutes = input("minutes", "number", { min: 10, max: 180, step: 5, required: "" });
  minutes.value = String(row.minutes);
  const time = input("time", "time", { required: "" });
  time.value = row.time;
  const flexible = input("flexible", "checkbox", {});
  flexible.checked = row.flexible;
  const flexibleLabel = el("label", "check-row routine-flexible");
  flexibleLabel.append(flexible, document.createTextNode("Can move"));

  const remove = el("button", "icon-square routine-remove", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove activity ${index + 1}`);
  remove.addEventListener("click", onRemove);

  wrap.append(
    field("ACTIVITY", type),
    field("NAME", label),
    field("MINUTES", minutes),
    field("USUAL TIME", time),
    flexibleLabel,
    remove,
  );
  return wrap;
}

/**
 * Read the rows currently in the form.
 * @returns {RoutineRow[]}
 */
function readRows() {
  return [...document.querySelectorAll("#routine-rows .routine-row")].map((row) => {
    /** @param {string} name */
    const control = (name) =>
      /** @type {HTMLInputElement} */ (row.querySelector(`[name="${name}"]`));
    return {
      type: control("type").value,
      label: control("label").value.trim(),
      minutes: Number(control("minutes").value),
      time: control("time").value,
      flexible: control("flexible").checked,
    };
  });
}

/**
 * Re-render the form rows and the add button's state.
 * @param {RoutineRow[]} rows
 */
function renderRows(rows) {
  const container = $("#routine-rows");
  container.replaceChildren(
    ...rows.map((row, index) =>
      routineRow(row, index, () => renderRows(readRows().filter((_, i) => i !== index))),
    ),
  );
  $("#routine-add").disabled = rows.length >= MAX_ACTIVITIES;
}

/** @param {number} fraction */
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * Headline for the plan: Gemini's narrative when available, plus the measured totals.
 * @param {PlanSummary} summary
 * @param {string | undefined} narrative
 */
export function planHeadline(summary, narrative) {
  const parts = [];
  if (summary.moved > 0) {
    parts.push(
      `${summary.moved} ${summary.moved === 1 ? "activity" : "activities"} moved to cleaner hours`,
    );
  }
  if (summary.reduction > 0) {
    parts.push(`about ${percent(summary.reduction)} fewer particles breathed`);
  }
  if (summary.indoors > 0) parts.push(`${summary.indoors} better done indoors today`);
  const totals = parts.length
    ? `${parts.join(" · ")}.`
    : "Your usual times are already the cleaner options.";
  return narrative ? `${narrative} ${totals}` : totals;
}

/**
 * One timeline entry.
 * @param {PlanStep} step
 * @param {{ zone: string }} city
 */
function stepItem(step, city) {
  const window = step.planned ?? step.usual;
  const item = el("li", `plan-step is-${step.status}`);
  // Only a moved activity changes time; everything else happens at the household's own time.
  const movedTo = step.status === "moved" ? step.planned : null;
  const when = el(
    "time",
    "plan-step-time",
    movedTo ? formatTime(city, movedTo.time) : formatClock(step.usualTime),
  );
  if (movedTo) when.dateTime = movedTo.time;
  // Times already past today are planned for tomorrow; label the day of the time shown.
  const shown = movedTo ?? step.usual;
  const day = shown ? relativeDay(city.zone, shown.time) : null;
  const whenCell = el("div", "plan-step-when");
  whenCell.append(when);
  if (day) whenCell.append(el("span", "row-key", day.toUpperCase()));

  const tag = el(
    "span",
    `status-tag ${window ? category(window.aqi).tone : "unknown"}`,
    STATUS_LABELS[step.status],
  );
  const title = el("div", "plan-step-title");
  title.append(el("strong", "", `${step.label} · ${step.minutes} min`), tag);

  const body = el("div", "plan-step-body");
  body.append(title, el("p", "", step.reason), el("p", "plan-step-tradeoff", step.tradeoff));
  if (step.status === "moved" && step.usual) {
    body.append(
      el(
        "p",
        "plan-step-impact",
        `↓ ${percent(step.reduction)} particles breathed · usually ${formatClock(step.usualTime)}`,
      ),
    );
  }
  item.append(whenCell, body);
  return item;
}

/**
 * Caveats about the data behind the plan.
 * @param {PlanReply} reply
 */
function planNotes(reply) {
  const notes = [];
  if (reply.notice) notes.push(reply.notice);
  if (reply.forecast.mode === "demo") notes.push("Demo scenario: times are illustrative.");
  if (reply.plan.pm25Estimated) {
    notes.push("Some hours had no PM2.5 forecast, so exposure was estimated from US AQI.");
  }
  notes.push(
    "Savings compare the same activity at two times (PM2.5 × minutes); they are estimates, not health outcomes.",
  );
  return notes;
}

/**
 * @param {PlanReply} reply
 * @param {{ zone: string }} city
 * @param {(summary: PlanSummary) => void} onFollow
 */
function renderPlan(reply, city, onFollow) {
  const result = $("#day-plan-result");
  const source =
    reply.source === "ai" ? "GEMINI · CHOSEN FROM RULE-CHECKED OPTIONS" : "RULE-BASED PLANNER";
  const headline = el("p", "day-plan-headline", planHeadline(reply.plan.summary, reply.narrative));
  headline.setAttribute("role", "status");

  const list = el("ol", "day-plan-steps");
  list.append(...reply.plan.steps.map((step) => stepItem(step, city)));

  const follow = el("button", "btn btn-dark", "I’LL FOLLOW THIS PLAN →");
  follow.type = "button";
  follow.addEventListener("click", () => {
    onFollow(reply.plan.summary);
    follow.disabled = true;
    follow.textContent = "SAVED TO THIS MONTH’S IMPACT ✓";
  });

  const notes = el("ul", "day-plan-notes");
  notes.append(...planNotes(reply).map((note) => el("li", "", note)));
  const footer = el("div", "day-plan-footer");
  footer.append(el("span", "row-key", source), follow);

  result.replaceChildren(headline, list, notes, footer);
  result.hidden = false;
}

/**
 * @typedef {object} PlannerController
 * @property {(available: boolean) => void} setAiAvailable Enable or disable the Gemini opt-in.
 * @property {() => void} reset Forget the saved routine and show the default one.
 */

/**
 * Wire the "Plan my day" form.
 * @param {object} options
 * @param {() => Snapshot} options.getSnapshot Current city, mode and household.
 * @param {(summary: PlanSummary) => void} options.onFollow Called when the plan is adopted.
 * @returns {PlannerController}
 */
export function bindPlanner({ getSnapshot, onFollow }) {
  const form = $("#day-planner-form");
  const submit = $("#plan-day-submit");
  const result = $("#day-plan-result");
  renderRows(loadRoutine());

  $("#routine-add").addEventListener("click", () => {
    const rows = readRows();
    renderRows([
      ...rows,
      { type: "errands", label: "", minutes: 30, time: "17:00", flexible: true },
    ]);
  });

  form.addEventListener("submit", async (/** @type {SubmitEvent} */ event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const activities = readRows();
    saveJson(ROUTINE_KEY, activities);
    const snapshot = getSnapshot();
    submit.disabled = true;
    result.setAttribute("aria-busy", "true");
    try {
      const reply = await postDayPlan({
        ...cityContext(snapshot.cityId, snapshot.city),
        mode: snapshot.mode,
        profile: snapshot.profile,
        activities,
        useAI: $("#plan-ai-optin").checked,
      });
      renderPlan(reply, snapshot.city, onFollow);
    } catch (error) {
      result.replaceChildren(el("p", "day-plan-error", /** @type {Error} */ (error).message));
      result.hidden = false;
    } finally {
      submit.disabled = false;
      result.setAttribute("aria-busy", "false");
    }
  });

  return {
    setAiAvailable(available) {
      $("#plan-ai-optin").disabled = !available;
      $("#plan-ai-availability").textContent = available
        ? "(Gemini · opt-in)"
        : "(server key not configured)";
    },
    reset() {
      removeKey(ROUTINE_KEY);
      renderRows(DEFAULT_ROUTINE);
      result.hidden = true;
      result.replaceChildren();
    },
  };
}
