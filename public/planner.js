/**
 * "Plan my day": moves flexible outdoor activities into the cleanest forecast hours.
 *
 * Pure and deterministic, shared by the browser and the server. The server may let Gemini
 * choose among the options computed here and write the explanations, but every start time
 * it accepts must be one of these options (see lib/day-plan.mjs).
 *
 * Exposure model: the same activity at two times differs only in air concentration, so the
 * breathing rate cancels out and the saving is the ratio of PM2.5 × minutes. No absolute
 * dose or health benefit is claimed.
 */
import { category, isHighRisk, normalizeProfile, LEVEL } from "./engine.js";
import { pm25FromUsAqi } from "./aqi-scales.js";
import { formatClock, formatTime, localMinuteOfDay } from "./format.js";
import { HOUR_MS } from "./time.js";

/** @typedef {import("./types.js").HourlyPoint} HourlyPoint */
/** @typedef {import("./types.js").Profile} Profile */

export const MAX_ACTIVITIES = 8;
const MIN_MINUTES = 10;
const MAX_MINUTES = 180;
const DEFAULT_MINUTES = 30;
const MAX_LABEL_LENGTH = 40;
const MINUTES_PER_HOUR = 60;
/** Suggested starts stay within waking hours: from 06:00, finishing by 22:00 (local). */
const DAY_START_MINUTE = 6 * 60;
const DAY_END_MINUTE = 22 * 60;
/** Only suggest a move when it cuts exposure by at least this fraction. */
export const MIN_IMPROVEMENT = 0.1;
/** Alternative start times offered per flexible activity (and to Gemini). */
const MAX_OPTIONS = 3;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Activity presets. `strenuous` activities raise breathing rate, so when even the cleanest
 * hour is high-risk for the household they are moved indoors rather than rescheduled.
 */
export const ACTIVITY_TYPES = Object.freeze({
  exercise: { label: "Outdoor exercise", strenuous: true },
  walk: { label: "Walk", strenuous: false },
  play: { label: "Children's outdoor play", strenuous: true },
  school: { label: "School run", strenuous: false },
  commute: { label: "Commute", strenuous: false },
  errands: { label: "Errands / market", strenuous: false },
  airing: { label: "Air out the home", strenuous: false },
});

/**
 * @typedef {object} Activity
 * @property {string} id Stable id ("a1", "a2", …) assigned by position.
 * @property {keyof typeof ACTIVITY_TYPES} type
 * @property {string} label
 * @property {number} minutes
 * @property {string} time Usual start time, "HH:MM" in the city's local time.
 * @property {boolean} flexible Whether the planner may move it.
 */

/**
 * @typedef {object} Slot One forecast hour.
 * @property {string} time ISO start of the hour.
 * @property {number} aqi US AQI.
 * @property {number} pm25 PM2.5 used for exposure (forecast, or estimated from AQI).
 * @property {boolean} pm25Estimated
 * @property {number} minute Local minute of the day when the hour starts (0–1439).
 */

/**
 * @typedef {object} Window A candidate start for one activity.
 * @property {number} start Index of the first slot.
 * @property {number} span Number of hourly slots covered.
 * @property {string} time ISO start time.
 * @property {number} aqi Highest US AQI during the window.
 * @property {number} pm25 Average PM2.5 during the window (µg/m³).
 * @property {number} dose Relative exposure: PM2.5 × minutes (µg/m³·min).
 */

/**
 * @typedef {"moved" | "keep" | "fixed" | "indoors" | "unavailable"} StepStatus
 */

/**
 * @typedef {object} PlanStep
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {number} minutes
 * @property {boolean} flexible
 * @property {string} usualTime The household's own start time, "HH:MM" (local).
 * @property {StepStatus} status
 * @property {Window | null} usual Window at the usual time.
 * @property {Window | null} planned Recommended window.
 * @property {Window[]} options Allowed alternatives (flexible activities only).
 * @property {number} reduction Fraction of exposure avoided versus the usual time (0–1).
 * @property {string} reason
 * @property {string} tradeoff
 */

/**
 * @typedef {object} PlanSummary
 * @property {number} moved Activities moved to a cleaner hour.
 * @property {number} indoors Strenuous activities moved indoors.
 * @property {number} baselineDose Exposure if everything ran at its usual time.
 * @property {number} plannedDose Exposure with the plan.
 * @property {number} reduction Fraction avoided (0–1).
 */

/**
 * @typedef {object} DayPlan
 * @property {PlanStep[]} steps In planned start order.
 * @property {PlanSummary} summary
 * @property {boolean} pm25Estimated Some hours had no PM2.5 forecast and used AQI instead.
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {string} time "HH:MM" */
const minuteOf = (time) => Number(time.slice(0, 2)) * MINUTES_PER_HOUR + Number(time.slice(3, 5));

/**
 * Validate one untrusted activity; returns null when it cannot be planned.
 * @param {any} raw
 * @param {number} index Position in the list (drives the stable id).
 * @returns {Activity | null}
 */
function normalizeActivity(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const type = Object.hasOwn(ACTIVITY_TYPES, raw.type) ? raw.type : null;
  const time = typeof raw.time === "string" && TIME_PATTERN.test(raw.time) ? raw.time : null;
  if (!type || !time) return null;
  const minutes = clamp(
    Math.round(Number(raw.minutes)) || DEFAULT_MINUTES,
    MIN_MINUTES,
    MAX_MINUTES,
  );
  const custom = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  return {
    id: `a${index + 1}`,
    type,
    label: custom || ACTIVITY_TYPES[/** @type {keyof typeof ACTIVITY_TYPES} */ (type)].label,
    minutes,
    time,
    flexible: raw.flexible === true,
  };
}

/**
 * Validate an untrusted activity list (at most MAX_ACTIVITIES; invalid rows are dropped).
 * @param {unknown} input
 * @returns {Activity[]}
 */
export function normalizeActivities(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_ACTIVITIES).flatMap((raw, index) => {
    const activity = normalizeActivity(raw, index);
    return activity ? [activity] : [];
  });
}

/**
 * Turn the hourly forecast into slots with a PM2.5 value for every valid hour.
 * @param {HourlyPoint[] | undefined} hourly
 * @param {string} zone IANA time zone of the city.
 * @returns {Slot[]}
 */
export function forecastSlots(hourly, zone) {
  return (hourly || [])
    .filter((h) => category(h.aqi).level >= 0)
    .map((h) => {
      const measured = typeof h.pm25 === "number" && Number.isFinite(h.pm25);
      return {
        time: h.time,
        aqi: h.aqi,
        pm25: measured ? /** @type {number} */ (h.pm25) : (pm25FromUsAqi(h.aqi) ?? 0),
        pm25Estimated: !measured,
        minute: localMinuteOfDay(zone, h.time),
      };
    });
}

/**
 * Exposure window for an activity starting at a slot, or null if it does not fit in the
 * forecast (too close to its end, or across a gap in the data).
 * @param {Slot[]} slots
 * @param {number} start
 * @param {number} minutes
 * @returns {Window | null}
 */
export function windowAt(slots, start, minutes) {
  const span = Math.ceil(minutes / MINUTES_PER_HOUR);
  const hours = slots.slice(start, start + span);
  if (start < 0 || hours.length < span) return null;
  const contiguous = hours.every(
    (slot, i) => i === 0 || Date.parse(slot.time) - Date.parse(hours[i - 1].time) === HOUR_MS,
  );
  if (!contiguous) return null;
  const dose = hours.reduce((total, slot, i) => {
    const minutesInHour = Math.min(MINUTES_PER_HOUR, minutes - i * MINUTES_PER_HOUR);
    return total + slot.pm25 * minutesInHour;
  }, 0);
  return {
    start,
    span,
    time: hours[0].time,
    aqi: Math.max(...hours.map((slot) => slot.aqi)),
    pm25: Number((dose / minutes).toFixed(1)),
    dose: Math.round(dose),
  };
}

/**
 * @param {Window} window
 * @param {Set<number>} occupied
 */
const overlaps = (window, occupied) =>
  Array.from({ length: window.span }, (_, i) => window.start + i).some((i) => occupied.has(i));

/**
 * @param {Window} window
 * @param {Set<number>} occupied
 */
function occupy(window, occupied) {
  for (let i = 0; i < window.span; i++) occupied.add(window.start + i);
}

/**
 * Free windows within waking hours, cleanest first; ties go to the earlier hour.
 * @param {Slot[]} slots
 * @param {number} minutes
 * @param {Set<number>} occupied
 * @returns {Window[]}
 */
function candidateWindows(slots, minutes, occupied) {
  const span = Math.ceil(minutes / MINUTES_PER_HOUR);
  const duringWakingHours = (/** @type {Slot} */ slot) =>
    slot.minute >= DAY_START_MINUTE && slot.minute + span * MINUTES_PER_HOUR <= DAY_END_MINUTE;
  return slots
    .flatMap((slot, i) => {
      const window = duringWakingHours(slot) ? windowAt(slots, i, minutes) : null;
      return window && !overlaps(window, occupied) ? [window] : [];
    })
    .sort((a, b) => a.dose - b.dose || a.start - b.start);
}

/**
 * @param {Window | null} usual
 * @param {Window | null} planned
 */
const reductionOf = (usual, planned) =>
  usual && planned && usual.dose > 0 ? Math.max(0, 1 - planned.dose / usual.dose) : 0;

/** @param {string} type */
const isStrenuous = (type) =>
  ACTIVITY_TYPES[/** @type {keyof typeof ACTIVITY_TYPES} */ (type)]?.strenuous === true;

/**
 * Status for a recommended window, applying the household's risk rules.
 * @param {{ type: string, flexible: boolean, usual: Window | null }} step
 * @param {Window} planned
 * @param {Profile} profile
 * @returns {StepStatus}
 */
function statusFor(step, planned, profile) {
  if (isStrenuous(step.type) && isHighRisk(category(planned.aqi), profile)) return "indoors";
  if (!step.flexible) return "fixed";
  return planned.start === step.usual?.start ? "keep" : "moved";
}

/** @param {number} fraction */
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * Plain-language reason and trade-off for a step. Gemini may replace these with its own
 * wording, but never the numbers they are based on.
 * @param {PlanStep} step
 * @param {{ zone: string }} city
 * @returns {{ reason: string, tradeoff: string }}
 */
export function describeStep(step, city) {
  const { usual, planned } = step;
  if (!usual || !planned) {
    return {
      reason: "This time is outside the forecast window, so it cannot be compared yet.",
      tradeoff: "Plan again later, when the forecast covers it.",
    };
  }
  const at = formatTime(city, planned.time);
  const usualAt = formatClock(step.usualTime);
  const band = category(planned.aqi).label.toLowerCase();
  const copy = {
    moved: {
      reason: `PM2.5 is forecast to fall from about ${usual.pm25} to ${planned.pm25} µg/m³ (US AQI ${usual.aqi} → ${planned.aqi}), so you breathe about ${percent(step.reduction)} fewer particles.`,
      tradeoff: `Starts at ${at} instead of ${usualAt}. Forecasts change; check again before heading out.`,
    },
    keep: {
      reason: `${usualAt} is already one of the cleaner times in the forecast (US AQI ${planned.aqi}, ${band}).`,
      tradeoff: `No free slot is at least ${percent(MIN_IMPROVEMENT)} cleaner, so moving it is not worth the disruption.`,
    },
    fixed: {
      reason: `Fixed at ${usualAt}; the air is expected to be ${band} (US AQI ${planned.aqi}).`,
      tradeoff:
        category(planned.aqi).level >= LEVEL.UNHEALTHY
          ? "Keep outdoor waiting short, prefer enclosed transport, and use a well-fitting N95 if it is unavoidable."
          : "Prefer quieter streets away from idling traffic.",
    },
    indoors: {
      reason: `Even the cleanest available time (${at}, US AQI ${planned.aqi}) is ${band} for your household.`,
      tradeoff:
        "Swap it for gentle indoor activity today: hard breathing outdoors draws in more particles.",
    },
  };
  return copy[/** @type {"moved" | "keep" | "fixed" | "indoors"} */ (step.status)];
}

/**
 * Recommend a specific window for a step, recomputing its status, saving and text.
 * Used for the rule-based choice and to apply a validated Gemini choice.
 * @param {PlanStep} step
 * @param {Window} window Must be the usual window or one of `step.options`.
 * @param {Profile} profile
 * @param {{ zone: string }} city
 * @returns {PlanStep}
 */
export function withPlannedWindow(step, window, profile, city) {
  const status = statusFor(step, window, profile);
  const next = {
    ...step,
    status,
    planned: window,
    reduction: status === "indoors" ? 0 : reductionOf(step.usual, window),
  };
  return { ...next, ...describeStep(next, city) };
}

/**
 * Schedule one activity against the remaining free hours.
 * @param {Activity} activity
 * @param {Slot[]} slots
 * @param {Set<number>} occupied Slot indices already taken by earlier activities.
 * @param {{ profile: Profile, city: { zone: string } }} context
 * @returns {PlanStep}
 */
function scheduleActivity(activity, slots, occupied, { profile, city }) {
  const start = minuteOf(activity.time);
  // The forecast hour that contains the usual start time.
  const usualIndex = slots.findIndex(
    (slot) => start >= slot.minute && start < slot.minute + MINUTES_PER_HOUR,
  );
  const usual = windowAt(slots, usualIndex, activity.minutes);
  /** @type {PlanStep} */
  const base = {
    id: activity.id,
    type: activity.type,
    label: activity.label,
    minutes: activity.minutes,
    flexible: activity.flexible,
    usualTime: activity.time,
    status: "unavailable",
    usual,
    planned: null,
    options: [],
    reduction: 0,
    reason: "",
    tradeoff: "",
  };
  if (!usual) return { ...base, ...describeStep(base, city) };

  const options = activity.flexible
    ? candidateWindows(slots, activity.minutes, occupied)
        .filter((w) => w.dose <= usual.dose)
        .slice(0, MAX_OPTIONS)
    : [];
  const best = options[0];
  const worthMoving = best && best.dose <= usual.dose * (1 - MIN_IMPROVEMENT);
  const step = withPlannedWindow({ ...base, options }, worthMoving ? best : usual, profile, city);
  // An activity moved indoors does not use outdoor air, so it leaves the hour free for others.
  if (step.planned && step.status !== "indoors") occupy(step.planned, occupied);
  return step;
}

/**
 * Fixed activities claim their hours first; then flexible ones, strenuous and longer first,
 * since they gain most from a cleaner hour.
 * @param {Activity} a
 * @param {Activity} b
 */
function schedulingOrder(a, b) {
  if (a.flexible !== b.flexible) return a.flexible ? 1 : -1;
  const strenuousFirst = Number(isStrenuous(b.type)) - Number(isStrenuous(a.type));
  return strenuousFirst || b.minutes - a.minutes;
}

/**
 * Totals across the plan. Indoor swaps are excluded from the exposure comparison because
 * indoor air is not measured.
 * @param {PlanStep[]} steps
 * @returns {PlanSummary}
 */
export function summarizePlan(steps) {
  const compared = steps.filter((s) => s.usual && s.planned && s.status !== "indoors");
  const baselineDose = compared.reduce((t, s) => t + /** @type {Window} */ (s.usual).dose, 0);
  const plannedDose = compared.reduce((t, s) => t + /** @type {Window} */ (s.planned).dose, 0);
  return {
    moved: steps.filter((s) => s.status === "moved").length,
    indoors: steps.filter((s) => s.status === "indoors").length,
    baselineDose,
    plannedDose,
    reduction: baselineDose > 0 ? Math.max(0, 1 - plannedDose / baselineDose) : 0,
  };
}

/**
 * When the step actually happens: the new time if moved, otherwise the household's own time.
 * @param {PlanStep} step
 */
const startOf = (step) => {
  const window = step.status === "moved" ? step.planned : step.usual;
  return Date.parse(window?.time ?? "") || Infinity;
};

/**
 * Order steps by recommended start time (unplannable steps last).
 * @param {PlanStep[]} steps
 * @returns {PlanStep[]}
 */
export function sortSteps(steps) {
  return [...steps].sort((a, b) => startOf(a) - startOf(b));
}

/**
 * Build a rule-based day plan from the hourly forecast.
 * @param {object} input
 * @param {HourlyPoint[] | undefined} input.hourly Forecast (up to 24 hours).
 * @param {{ zone: string }} input.city City (for local time).
 * @param {unknown} input.activities Untrusted activity list.
 * @param {unknown} input.profile Untrusted household profile.
 * @returns {DayPlan}
 */
export function planDay({ hourly, city, activities, profile }) {
  const slots = forecastSlots(hourly, city.zone);
  const household = normalizeProfile(profile);
  const list = normalizeActivities(activities);
  const occupied = new Set();
  const byId = new Map(
    [...list]
      .sort(schedulingOrder)
      .map((a) => [a.id, scheduleActivity(a, slots, occupied, { profile: household, city })]),
  );
  const steps = sortSteps(list.map((a) => /** @type {PlanStep} */ (byId.get(a.id))));
  return {
    steps,
    summary: summarizePlan(steps),
    pm25Estimated: slots.some((slot) => slot.pm25Estimated),
  };
}
