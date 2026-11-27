/** Shared, deterministic decision logic. AQI values use the US scale throughout. */
import { HOUR_MS } from "./time.js";

/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").Profile} Profile */
/** @typedef {import("./types.js").Category} Category */
/** @typedef {import("./types.js").Plan} Plan */
/** @typedef {import("./types.js").PlanCard} PlanCard */
/** @typedef {import("./types.js").Impact} Impact */
/** @typedef {import("./types.js").HourlyPoint} HourlyPoint */

const MAX_AQI = 500;
const MAX_DISTANCE_KM = 100;
const DEFAULT_DISTANCE_KM = 12;
const MIN_DEMO_AQI = 12;
/** Demo hourly shape: AQI offsets from the city's demo value for the next 12 hours. */
const DEMO_HOURLY_OFFSETS = [0, 8, 13, 4, -15, -32, -49, -55, -43, -29, -10, 6];
/**
 * Illustrative per-passenger CO₂ factors (kg/km), not a verified carbon inventory.
 * @type {Record<import("./types.js").Commute, number>}
 */
export const CO2_KG_PER_KM = { car: 0.17, transit: 0.06, walk: 0, home: 0 };
const COMMUTES = Object.keys(CO2_KG_PER_KM);

/** Category levels (index into AQI_BANDS) used by the decision rules. */
export const LEVEL = Object.freeze({
  GOOD: 0,
  MODERATE: 1,
  SENSITIVE: 2,
  UNHEALTHY: 3,
  VERY_UNHEALTHY: 4,
  HAZARDOUS: 5,
});

const AQI_BANDS = [
  { max: 50, label: "Good", tone: "good" },
  { max: 100, label: "Moderate", tone: "moderate" },
  { max: 150, label: "Unhealthy for sensitive groups", tone: "sensitive" },
  { max: 200, label: "Unhealthy", tone: "unhealthy" },
  { max: 300, label: "Very unhealthy", tone: "very" },
  { max: MAX_AQI, label: "Hazardous", tone: "hazardous" },
];

/** @type {City[]} */
export const CITIES = [
  {
    id: "delhi",
    name: "New Delhi",
    region: "Delhi, India",
    lat: 28.6139,
    lon: 77.209,
    zone: "Asia/Kolkata",
    demo: 286,
    demoPm25: 156,
    demoPm10: 218,
  },
  {
    id: "mumbai",
    name: "Mumbai",
    region: "Maharashtra, India",
    lat: 19.076,
    lon: 72.8777,
    zone: "Asia/Kolkata",
    demo: 142,
    demoPm25: 51,
    demoPm10: 83,
  },
  {
    id: "bengaluru",
    name: "Bengaluru",
    region: "Karnataka, India",
    lat: 12.9716,
    lon: 77.5946,
    zone: "Asia/Kolkata",
    demo: 72,
    demoPm25: 21,
    demoPm10: 42,
  },
  {
    id: "kolkata",
    name: "Kolkata",
    region: "West Bengal, India",
    lat: 22.5726,
    lon: 88.3639,
    zone: "Asia/Kolkata",
    demo: 178,
    demoPm25: 88,
    demoPm10: 128,
  },
  {
    id: "lucknow",
    name: "Lucknow",
    region: "Uttar Pradesh, India",
    lat: 26.8467,
    lon: 80.9462,
    zone: "Asia/Kolkata",
    demo: 224,
    demoPm25: 124,
    demoPm10: 180,
  },
  {
    id: "chennai",
    name: "Chennai",
    region: "Tamil Nadu, India",
    lat: 13.0827,
    lon: 80.2707,
    zone: "Asia/Kolkata",
    demo: 48,
    demoPm25: 8,
    demoPm10: 19,
  },
  {
    id: "hyderabad",
    name: "Hyderabad",
    region: "Telangana, India",
    lat: 17.385,
    lon: 78.4867,
    zone: "Asia/Kolkata",
    demo: 96,
    demoPm25: 34,
    demoPm10: 58,
  },
  {
    id: "pune",
    name: "Pune",
    region: "Maharashtra, India",
    lat: 18.5204,
    lon: 73.8567,
    zone: "Asia/Kolkata",
    demo: 112,
    demoPm25: 40,
    demoPm10: 69,
  },
  {
    id: "ahmedabad",
    name: "Ahmedabad",
    region: "Gujarat, India",
    lat: 23.0225,
    lon: 72.5714,
    zone: "Asia/Kolkata",
    demo: 158,
    demoPm25: 68,
    demoPm10: 114,
  },
  {
    id: "jaipur",
    name: "Jaipur",
    region: "Rajasthan, India",
    lat: 26.9124,
    lon: 75.7873,
    zone: "Asia/Kolkata",
    demo: 184,
    demoPm25: 94,
    demoPm10: 146,
  },
];
/** @type {Profile} */
export const DEFAULT_PROFILE = {
  sensitive: true,
  commute: "car",
  distance: DEFAULT_DISTANCE_KM,
  purifier: false,
  budget: "low",
  outdoor: "morning",
};
/**
 * Type guard for a real, finite number (rejects null, undefined, NaN and Infinity).
 * @param {unknown} value
 * @returns {value is number}
 */
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Map a US AQI value to its category band.
 * @param {unknown} value US AQI.
 * @returns {Category} Band, or level -1 ("Unavailable") for missing/out-of-range values.
 */
export function category(value) {
  if (!isFiniteNumber(value) || value < 0 || value > MAX_AQI) {
    return { label: "Unavailable", tone: "unknown", level: -1 };
  }
  const level = AQI_BANDS.findIndex((band) => Math.round(value) <= band.max);
  return { label: AQI_BANDS[level].label, tone: AQI_BANDS[level].tone, level };
}

/**
 * Coerce untrusted input into a valid household profile.
 * @param {any} [input]
 * @returns {Profile}
 */
export function normalizeProfile(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  return {
    sensitive: input.sensitive === true,
    commute: COMMUTES.includes(input.commute) ? input.commute : "car",
    distance: Number.isFinite(Number(input.distance))
      ? Math.min(MAX_DISTANCE_KM, Math.max(0, Number(input.distance)))
      : DEFAULT_DISTANCE_KM,
    purifier: input.purifier === true,
    budget: input.budget === "flexible" ? "flexible" : "low",
    outdoor: input.outdoor === "evening" ? "evening" : "morning",
  };
}
/**
 * Fixed, clearly-labelled demo scenario for a preset city.
 * @param {string} cityId Preset city id (falls back to the first city).
 * @param {number} [now] Current time in ms.
 * @returns {Air}
 */
export function demoAir(cityId, now = Date.now()) {
  const city = CITIES.find((c) => c.id === cityId) || CITIES[0];
  const demoAqi = city.demo ?? 0;
  const start = Math.floor(now / HOUR_MS) * HOUR_MS;
  return {
    city: city.id,
    mode: "demo",
    fetchedAt: new Date(now).toISOString(),
    observedAt: new Date(start).toISOString(),
    aqi: demoAqi,
    pm25: city.demoPm25 ?? null,
    pm10: city.demoPm10 ?? null,
    hourly: DEMO_HOURLY_OFFSETS.map((offset, i) => ({
      time: new Date(start + i * HOUR_MS).toISOString(),
      aqi: Math.max(MIN_DEMO_AQI, demoAqi + offset),
    })),
  };
}

/**
 * Lowest valid AQI hour in the outlook.
 * @param {Air} air
 * @returns {HourlyPoint | null}
 */
export function bestWindow(air) {
  return (air.hourly || [])
    .filter((h) => category(h.aqi).level >= 0)
    .reduce(
      (/** @type {HourlyPoint | null} */ best, h) => (!best || h.aqi < best.aqi ? h : best),
      null,
    );
}
/**
 * Illustrative daily CO₂ saving from switching a car commute to transit.
 * @param {Partial<Profile>} profile
 * @returns {Impact}
 */
export function impact(profile) {
  const p = normalizeProfile(profile);
  const baseline = CO2_KG_PER_KM[p.commute];
  const alternative = p.commute === "car" ? CO2_KG_PER_KM.transit : baseline;
  return {
    savedKg: Number((p.distance * Math.max(0, baseline - alternative)).toFixed(2)),
    baseline,
    alternative,
    distance: p.distance,
  };
}

/** @typedef {{ category: Category, high: boolean, severe: boolean, unknown: boolean }} Risk */

/**
 * @param {Profile} profile
 * @param {Risk} risk
 * @returns {PlanCard}
 */
function movementCard(profile, risk) {
  let title = "Choose a quieter route for movement";
  let action =
    "Keep away from busy roads. If you are unusually sensitive, shorten activity and watch for symptoms.";
  let why = "Local traffic and your sensitivity matter, even when city-wide air is better.";
  if (risk.high) {
    title = "Bring your movement indoors";
    action =
      "Swap the outdoor workout for gentle movement in a cleaner indoor space. Postpone strenuous outdoor activity.";
    why = `${
      risk.category.label
    } air calls for less outdoor exposure, especially for sensitive household members.`;
  }
  if (risk.unknown) {
    title = "Check local air before heading out";
    action = "Air data is missing. Check your local monitoring station before outdoor exercise.";
    why = "Missing data must never be interpreted as clean air.";
  }
  return {
    id: "move",
    kind: "Your movement",
    time: profile.outdoor === "morning" ? "Morning" : "Evening",
    icon: "sun",
    title,
    action,
    why,
    impact: risk.high
      ? "Less time breathing polluted outdoor air"
      : "Lower exposure to nearby traffic emissions",
  };
}

/**
 * @param {Profile} profile
 * @param {Risk} risk
 * @param {Impact} estimate
 * @returns {PlanCard}
 */
function commuteCard(profile, risk, estimate) {
  let title = "Make the trip with fewer emissions";
  let action =
    "Use public transport or share a ride where feasible. Choose stops away from idling vehicles; do not assume transit air is always cleaner.";
  if (profile.commute === "car") title = "Try transit for today’s commute";
  if (profile.commute === "walk" && risk.high) {
    title = "Swap a long walk for a shorter trip";
    action =
      "Consider an enclosed bus or shared ride if available. Avoid a strenuous walking or cycling commute in poor air.";
  }
  if (risk.severe) {
    title = "Postpone nonessential trips";
    action =
      "If travel is essential, choose an enclosed option where practical and keep outdoor waiting short. Avoid traffic hotspots.";
  }
  if (risk.unknown) {
    title = "Check local advisories before travel";
    action =
      "Current air data is unavailable. Check local monitoring, avoid idling vehicles, and keep unnecessary outdoor waiting short.";
  }
  if (profile.commute === "home") {
    title = "Keep the commute off the calendar";
    action =
      "Working from home avoids travel emissions. Take movement breaks indoors when air is poor.";
  }
  return {
    id: "commute",
    kind: "Your commute",
    time: "On the way",
    icon: "train",
    title,
    action,
    why: `${
      profile.distance
    } km total daily travel. Both the journey’s emissions and your outdoor exposure matter.`,
    impact:
      estimate.savedKg > 0
        ? `Illustrative car → transit saving: ${estimate.savedKg} kg CO₂ per day`
        : "Avoid idling and unnecessary motor journeys",
  };
}

/**
 * @param {Profile} profile
 * @param {Risk} risk
 * @returns {PlanCard}
 */
function homeCard(profile, risk) {
  let title = "Start with the no-cost indoor fixes";
  let action =
    "Damp-dust surfaces and avoid incense, smoking, candles, and aerosol sprays indoors.";
  if (profile.budget === "flexible") {
    title = "Consider a correctly sized HEPA cleaner";
    action = "Choose a particle air cleaner sized for the room; avoid ozone-generating devices.";
  }
  if (profile.purifier) {
    title = "Make one room your cleaner-air space";
    action =
      "Run your particle air cleaner according to its instructions in the room you use most.";
  }
  const ventilation =
    risk.high || risk.unknown
      ? "Keep windows closed during outdoor pollution peaks if it is safe and not too hot; use a cleaner public indoor space if needed."
      : "Ventilate when outdoor air is cleaner, while considering indoor sources and temperature.";
  return {
    id: "home",
    kind: "Your home",
    time: "At home",
    icon: "home",
    title,
    action: `${action} ${ventilation}`,
    why: "Reducing indoor sources limits added particles. Outdoor AQI does not measure the air inside your home.",
    impact: "Fewer indoor particle sources, without needing to buy anything first",
  };
}

/**
 * Whether the air calls for precautions for this household.
 * @param {Category} band
 * @param {Profile} profile
 * @returns {boolean}
 */
function isHighRisk(band, profile) {
  return band.level >= LEVEL.UNHEALTHY || (profile.sensitive && band.level >= LEVEL.SENSITIVE);
}

/**
 * Decide precautions first, then personalize the three independent actions.
 * @param {Air} air
 * @param {Partial<Profile>} input
 * @returns {Plan}
 */
export function makePlan(air, input) {
  const profile = normalizeProfile(input);
  const band = category(air.aqi);
  /** @type {Risk} */
  const risk = {
    category: band,
    high: isHighRisk(band, profile),
    severe: band.level >= LEVEL.VERY_UNHEALTHY,
    unknown: band.level < 0,
  };
  const estimate = impact(profile);
  let headline = "Make room for a better-air day.";
  let summary =
    "Enjoy your routine thoughtfully, avoid traffic hotspots, and keep indoor pollution sources low.";
  if (risk.high) {
    headline = "A little planning. A cleaner-air day.";
    summary =
      "Keep outdoor time short, create a cleaner indoor space, and make essential trips count.";
  }
  if (risk.unknown) {
    headline = "Check the air. Then plan your day.";
    summary = "Current air data is unavailable. Use local monitoring before making outdoor plans.";
  }
  return {
    ...risk,
    cards: [
      movementCard(profile, risk),
      commuteCard(profile, risk, estimate),
      homeCard(profile, risk),
    ],
    best: bestWindow(air),
    impact: estimate,
    headline,
    summary,
  };
}

/**
 * @param {Category} band
 * @param {boolean} high
 * @param {boolean} severe
 */
function exerciseVerdict(band, high, severe) {
  if (severe) return { status: "AVOID", tone: "hazardous" };
  if (high) return { status: "MOVE INDOORS", tone: "unhealthy" };
  if (band.level === LEVEL.GOOD) return { status: "RECOMMENDED", tone: "good" };
  return { status: "LIGHT ONLY", tone: "moderate" };
}

/** @param {number} level */
function kidsVerdict(level) {
  if (level >= LEVEL.UNHEALTHY) return { status: "INDOORS", tone: "unhealthy" };
  if (level >= LEVEL.SENSITIVE) return { status: "LIMIT TIME", tone: "sensitive" };
  return { status: "OK WITH CARE", tone: "good" };
}

/**
 * @param {boolean} high
 * @param {boolean} severe
 */
function maskVerdict(high, severe) {
  if (severe) return { status: "STRONGLY ADVISED", tone: "hazardous" };
  if (high) return { status: "RECOMMENDED", tone: "sensitive" };
  return { status: "OPTIONAL", tone: "good" };
}

/**
 * Deterministic daily activity verdicts derived from US AQI and household sensitivity.
 * @param {Air | null | undefined} air
 * @param {Partial<Profile>} input
 * @returns {Array<{ id: string, label: string, status: string, tone: string, note: string }>}
 */
export function activityReadiness(air, input) {
  const profile = normalizeProfile(input);
  const band = category(air?.aqi);
  if (band.level < 0) {
    return [
      {
        id: "exercise",
        label: "Outdoor Exercise",
        status: "CHECK LOCAL",
        tone: "unknown",
        note: "Air data is unavailable. Verify a nearby monitor first.",
      },
      {
        id: "kids",
        label: "Children & Sensitive",
        status: "CHECK LOCAL",
        tone: "unknown",
        note: "Wait for a valid reading before outdoor play.",
      },
      {
        id: "windows",
        label: "Open Windows",
        status: "USE CAUTION",
        tone: "unknown",
        note: "Avoid trapping indoor smoke or heat while checking outdoor air.",
      },
      {
        id: "mask",
        label: "N95 / FFP2 Mask",
        status: "STANDBY",
        tone: "unknown",
        note: "Keep a well-fitting respirator handy if visibility looks hazy.",
      },
    ];
  }
  const high = isHighRisk(band, profile);
  const severe = band.level >= LEVEL.VERY_UNHEALTHY;
  return [
    {
      id: "exercise",
      label: "Outdoor Exercise",
      ...exerciseVerdict(band, high, severe),
      note: high
        ? "Switch to gentle indoor movement; postpone heavy outdoor cardio."
        : "Prefer quieter streets away from peak traffic.",
    },
    {
      id: "kids",
      label: "Children & Sensitive",
      ...kidsVerdict(band.level),
      note:
        band.level >= LEVEL.SENSITIVE
          ? "Shorten outdoor play and follow any clinician care plan."
          : "Normal outdoor play is generally fine; watch for symptoms.",
    },
    {
      id: "windows",
      label: "Open Windows",
      status: high ? "KEEP CLOSED" : "VENTILATE",
      tone: high ? "unhealthy" : "good",
      note: high
        ? "Keep outdoor peaks out if indoor temperature and cooking fumes allow."
        : "Cross-ventilate during cleaner hours to refresh indoor air.",
    },
    {
      id: "mask",
      label: "N95 / FFP2 Mask",
      ...maskVerdict(high, severe),
      note: high
        ? "Use a well-fitting certified N95/FFP2 for unavoidable outdoor trips."
        : "Not typically required unless near heavy traffic or dust.",
    },
  ];
}

/**
 * Detect symptom phrases that must bypass AI and show urgent-care guidance.
 * @param {string} question
 * @returns {boolean}
 */
export function isEmergency(question) {
  return /chest pain|cannot breathe|can[’']t breathe|severe breath|blue lips/i.test(question);
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
  if (/mask|n95|respirator/.test(q)) {
    return "For unavoidable particle-pollution exposure, a well-fitting certified N95/FFP2 respirator can help reduce inhaled particles, but does not filter all gases. Fit matters; ordinary cloth masks are not equivalent. Respirators may not fit young children. Ask a clinician about suitability for children or people with breathing conditions. Reducing outdoor exposure remains the priority.";
  }
  if (/window|ventilat/.test(q)) {
    return `${
      plan.cards[2].action
    } Outdoor AQI alone cannot establish safe indoor air; avoid trapping combustion fumes and prioritize heat and immediate safety.`;
  }
  if (/school|child|kids|parent|asthma|elder|senior|pregnan/.test(q)) {
    return `For a sensitive household: ${makePlan(air, { ...profile, sensitive: true }).cards[0].action} Follow school/local advisories and a clinician’s existing care plan. Do not change medication based on this app.`;
  }
  if (/commut|travel|bus|car|emission|carbon/.test(q)) {
    return `${plan.cards[1].action} ${plan.cards[1].impact}. Carbon estimates are illustrative and do not predict a personal health improvement.`;
  }
  if (/purif|indoor|home|plant|incense/.test(q)) {
    return `${plan.cards[2].action} Houseplants are not a substitute for source control and effective particle filtration.`;
  }
  if (/walk|run|exercise|outdoor|park/.test(q)) {
    return `${plan.cards[0].action} ${plan.cards[0].why} A lower forecast value is not necessarily safe.`;
  }
  return `${plan.summary} Your priorities: ${plan.cards.map((c) => c.title.toLowerCase()).join("; ")}. Ask me about school runs, ventilation, exercise, masks, or commuting. This local guide uses fixed rules; it is not a generative AI response.`;
}
