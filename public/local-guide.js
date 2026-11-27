/**
 * Deterministic rule-based assistant and emergency symptom detector.
 * Used when generative AI is disabled, unavailable, or bypassed for urgent symptoms.
 */
import { category, makePlan } from "./engine.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").Profile} Profile */

const EMERGENCY_PATTERN = /chest pain|cannot breathe|can[’']t breathe|severe breath|blue lips/i;
const MASK_PATTERN = /mask|n95|respirator/;
const WINDOW_PATTERN = /window|ventilat/;
const SENSITIVE_PATTERN = /school|child|kids|parent|asthma|elder|senior|pregnan/;
const COMMUTE_PATTERN = /commut|travel|bus|car|emission|carbon/;
const HOME_PATTERN =
  /purif|hepa|filter|diy|box fan|remedy|remedies|indoor|home|plant|incense|budget|buy/;
const DIY_PATTERN = /purif|hepa|filter|diy|box fan|remedy|remedies|budget|buy/;
const OUTDOOR_PATTERN =
  /walk|run|exercise|outdoor|park|go out|outside|noon|morning|afternoon|evening|best time/;

/**
 * Detect symptom phrases that must bypass AI and show urgent-care guidance.
 * @param {string} question
 * @returns {boolean}
 */
export function isEmergency(question) {
  return EMERGENCY_PATTERN.test(question);
}

/**
 * @param {Plan} plan
 * @param {string} q Lowercased user question.
 */
function homeLocalAnswer(plan, q) {
  const diyHint = DIY_PATTERN.test(q)
    ? " For sizing a HEPA purifier or a low-cost DIY box-fan filter (~350 m³/h), try Home guide → Clean-room calculator."
    : "";
  return `${plan.cards[2].action}${diyHint} Houseplants are not a substitute for source control and effective particle filtration.`;
}

/** @param {Plan} plan */
function outdoorLocalAnswer(plan) {
  const bestHint = plan.best
    ? ` Lowest forecast in the next 12 hours is US AQI ${plan.best.aqi} (${category(plan.best.aqi).label.toLowerCase()}); use Daily plan → Plan my day to pick cleaner hours.`
    : " Use Daily plan → Plan my day to check cleaner hours.";
  return `${plan.cards[0].action} ${plan.cards[0].why}${bestHint} A lower forecast value is not necessarily safe.`;
}

/**
 * Deterministic rule-based answer used when AI is disabled, unavailable or bypassed.
 * @param {string} question
 * @param {Air} air
 * @param {Partial<Profile>} profile
 * @returns {string}
 */
export function localAnswer(question, air, profile) {
  const plan = makePlan(air, profile);
  const q = question.toLowerCase();
  if (isEmergency(question)) {
    return "Severe breathing difficulty or chest pain needs urgent medical attention. Contact local emergency services now. This assistant cannot diagnose or manage an emergency.";
  }
  if (MASK_PATTERN.test(q)) {
    return "For unavoidable particle-pollution exposure, a well-fitting certified N95/FFP2 respirator can help reduce inhaled particles, but does not filter all gases. Fit matters; ordinary cloth masks are not equivalent. Respirators may not fit young children. Ask a clinician about suitability for children or people with breathing conditions. Reducing outdoor exposure remains the priority.";
  }
  if (WINDOW_PATTERN.test(q)) {
    return `${plan.cards[2].action} Outdoor AQI alone cannot establish safe indoor air; avoid trapping combustion fumes and prioritize heat and immediate safety.`;
  }
  if (SENSITIVE_PATTERN.test(q)) {
    return `For a sensitive household: ${makePlan(air, { ...profile, sensitive: true }).cards[0].action} Follow school/local advisories and a clinician’s existing care plan. Do not change medication based on this app.`;
  }
  if (COMMUTE_PATTERN.test(q)) {
    return `${plan.cards[1].action} ${plan.cards[1].impact}. Carbon estimates are illustrative and do not predict a personal health improvement.`;
  }
  if (HOME_PATTERN.test(q)) return homeLocalAnswer(plan, q);
  if (OUTDOOR_PATTERN.test(q)) return outdoorLocalAnswer(plan);
  return `${plan.summary} Your priorities: ${plan.cards.map((c) => c.title.toLowerCase()).join("; ")}. Ask me about school runs, ventilation, exercise, masks, purifiers, or commuting. This local guide uses fixed rules; it is not a generative AI response.`;
}
