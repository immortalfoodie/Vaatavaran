/**
 * Priority cards, household summary list, and completion progress counters.
 */
import { $, el } from "./dom.js";

/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").PlanCard} PlanCard */
/** @typedef {import("./types.js").Profile} Profile */

/** Daily plan always has one movement, one commute and one home action. */
export const TOTAL_ACTIONS = 3;

const COMMUTE_LABELS = {
  car: "Solo car",
  transit: "Public transit",
  walk: "Walk / cycle",
  home: "Work from home",
};

/** @param {Set<string>} completed */
function updateCompletion(completed) {
  const count = completed.size;
  $("#completion").textContent = `${count} OF ${TOTAL_ACTIONS} COMPLETED`;
  $("#header-done-count").textContent = String(count);
  $("#brief-progress").textContent = `${count} OF ${TOTAL_ACTIONS} DONE`;
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildCheckbox(card, isDone, onToggle) {
  const label = el("label", "check-row");
  const box = el("input");
  box.type = "checkbox";
  box.checked = isDone;
  box.dataset.actionCheck = card.id;
  box.setAttribute("aria-label", `Mark completed: ${card.title}`);
  box.addEventListener("change", () => onToggle(card.id, box.checked));
  label.append(box, document.createTextNode("DONE"));
  return label;
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildOverviewPriorityCard(card, isDone, onToggle) {
  const node = el("article", `priority-card${isDone ? " done" : ""}`);
  node.dataset.actionId = card.id;
  const top = el("div", "priority-card-top");
  top.append(
    el("span", "priority-card-kicker", `${card.kind} · ${card.time}`),
    buildCheckbox(card, isDone, onToggle),
  );
  const foot = el("div", "priority-card-foot");
  const link = el("a", "", "[WHY & DETAILS ↗]");
  link.href = `#plan/${card.id}`;
  link.setAttribute("aria-label", `Why & details: ${card.title}`);
  foot.append(el("span", "row-key", card.time), link);
  node.append(top, el("h3", "", card.title), el("p", "", card.action.split(/(?<=\.)\s+/)[0]), foot);
  return node;
}

/**
 * @param {PlanCard} card
 * @param {boolean} isDone
 * @param {(id: string, checked: boolean) => void} onToggle
 */
function buildFullPlanCard(card, isDone, onToggle) {
  const full = el("article", `plan-card${isDone ? " done" : ""}`);
  full.id = `action-${card.id}`;
  full.dataset.actionId = card.id;
  const body = el("div");
  const details = el("details");
  details.append(el("summary", "", "WHY THIS FITS YOUR DAY"), el("p", "", card.why));
  body.append(
    el("span", "plan-card-eyebrow", `${card.kind} · ${card.time}`),
    el("h3", "", card.title),
    el("p", "", card.action),
    details,
    el("div", "plan-impact", `↗ ${card.impact}`),
  );
  full.append(body, buildCheckbox(card, isDone, onToggle));
  return full;
}

/**
 * Render the 3 priority cards on both Overview and Daily Plan, kept in sync.
 * @param {{ plan: Plan, completed: Set<string>,
 *   onComplete: (id: string, checked: boolean) => void }} options
 */
export function renderPriorities({ plan, completed, onComplete }) {
  const overviewList = $("#priorities");
  const fullList = $("#full-plan");
  overviewList.replaceChildren();
  fullList.replaceChildren();

  /** @type {(id: string, checked: boolean) => void} */
  const toggleAction = (id, checked) => {
    onComplete(id, checked);
    updateCompletion(completed);
    document
      .querySelectorAll(`[data-action-id="${id}"]`)
      .forEach((node) => node.classList.toggle("done", checked));
    document.querySelectorAll(`input[data-action-check="${id}"]`).forEach((box) => {
      /** @type {HTMLInputElement} */ (box).checked = checked;
    });
  };

  for (const card of plan.cards) {
    const isDone = completed.has(card.id);
    overviewList.append(buildOverviewPriorityCard(card, isDone, toggleAction));
    fullList.append(buildFullPlanCard(card, isDone, toggleAction));
  }
  updateCompletion(completed);
}

/**
 * Render the Household Overview definition list on the Daily Plan sidebar.
 * @param {Profile} profile
 * @param {City} city
 */
export function renderProfileSummary(profile, city) {
  const dl = $("#plan-profile-dl");
  dl.replaceChildren();
  const rows = [
    ["CITY", city.name],
    ["SENSITIVITY", profile.sensitive ? "High (Sensitive)" : "Standard"],
    ["COMMUTE", COMMUTE_LABELS[profile.commute] || profile.commute],
    ["DAILY DISTANCE", `${profile.distance} km`],
    ["AIR PURIFIER", profile.purifier ? "Available" : "None"],
    ["BUDGET", profile.budget === "flexible" ? "Flexible" : "No-cost first"],
    ["EXERCISE", profile.outdoor],
  ];
  for (const [key, value] of rows) {
    const item = el("div");
    item.append(el("dt", "", key), el("dd", "", value));
    dl.append(item);
  }
}
