/** Shared, deterministic decision logic. AQI values use the US scale throughout. */
export const CITIES = [
  {
    id: "delhi",
    name: "New Delhi",
    region: "Delhi, India",
    lat: 28.6139,
    lon: 77.209,
    zone: "Asia/Kolkata",
    demo: 286,
  },
  {
    id: "mumbai",
    name: "Mumbai",
    region: "Maharashtra, India",
    lat: 19.076,
    lon: 72.8777,
    zone: "Asia/Kolkata",
    demo: 142,
  },
  {
    id: "bengaluru",
    name: "Bengaluru",
    region: "Karnataka, India",
    lat: 12.9716,
    lon: 77.5946,
    zone: "Asia/Kolkata",
    demo: 72,
  },
  {
    id: "kolkata",
    name: "Kolkata",
    region: "West Bengal, India",
    lat: 22.5726,
    lon: 88.3639,
    zone: "Asia/Kolkata",
    demo: 178,
  },
  {
    id: "lucknow",
    name: "Lucknow",
    region: "Uttar Pradesh, India",
    lat: 26.8467,
    lon: 80.9462,
    zone: "Asia/Kolkata",
    demo: 224,
  },
  {
    id: "chennai",
    name: "Chennai",
    region: "Tamil Nadu, India",
    lat: 13.0827,
    lon: 80.2707,
    zone: "Asia/Kolkata",
    demo: 48,
  },
  {
    id: "hyderabad",
    name: "Hyderabad",
    region: "Telangana, India",
    lat: 17.385,
    lon: 78.4867,
    zone: "Asia/Kolkata",
    demo: 96,
  },
  {
    id: "pune",
    name: "Pune",
    region: "Maharashtra, India",
    lat: 18.5204,
    lon: 73.8567,
    zone: "Asia/Kolkata",
    demo: 112,
  },
  {
    id: "ahmedabad",
    name: "Ahmedabad",
    region: "Gujarat, India",
    lat: 23.0225,
    lon: 72.5714,
    zone: "Asia/Kolkata",
    demo: 158,
  },
  {
    id: "jaipur",
    name: "Jaipur",
    region: "Rajasthan, India",
    lat: 26.9124,
    lon: 75.7873,
    zone: "Asia/Kolkata",
    demo: 184,
  },
];
export const DEFAULT_PROFILE = {
  sensitive: true,
  commute: "car",
  distance: 12,
  purifier: false,
  budget: "low",
  outdoor: "morning",
};
export function category(value) {
  if (!Number.isFinite(value) || value < 0 || value > 500)
    return { label: "Unavailable", tone: "unknown", level: -1 };
  const thresholds = [50, 100, 150, 200, 300, 500];
  const labels = [
    "Good",
    "Moderate",
    "Unhealthy for sensitive groups",
    "Unhealthy",
    "Very unhealthy",
    "Hazardous",
  ];
  const tones = [
    "good",
    "moderate",
    "sensitive",
    "unhealthy",
    "very",
    "hazardous",
  ];
  const level = thresholds.findIndex((n) => Math.round(value) <= n);
  return { label: labels[level], tone: tones[level], level };
}
export function normalizeProfile(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  return {
    sensitive: input.sensitive === true,
    commute: ["car", "transit", "walk", "home"].includes(input.commute)
      ? input.commute
      : "car",
    distance: Number.isFinite(Number(input.distance))
      ? Math.min(100, Math.max(0, Number(input.distance)))
      : 12,
    purifier: input.purifier === true,
    budget: input.budget === "flexible" ? "flexible" : "low",
    outdoor: input.outdoor === "evening" ? "evening" : "morning",
  };
}
export function demoAir(cityId, now = Date.now()) {
  const city = CITIES.find((c) => c.id === cityId) || CITIES[0];
  const start = Math.floor(now / 3600000) * 3600000;
  const offsets = [0, 8, 13, 4, -15, -32, -49, -55, -43, -29, -10, 6];
  return {
    city: city.id,
    mode: "demo",
    fetchedAt: new Date(now).toISOString(),
    observedAt: new Date(start).toISOString(),
    aqi: city.demo,
    pm25: {
      delhi: 156,
      mumbai: 51,
      bengaluru: 21,
      kolkata: 88,
      lucknow: 124,
      chennai: 8,
      hyderabad: 34,
      pune: 40,
      ahmedabad: 68,
      jaipur: 94,
    }[city.id],
    pm10: {
      delhi: 218,
      mumbai: 83,
      bengaluru: 42,
      kolkata: 128,
      lucknow: 180,
      chennai: 19,
      hyderabad: 58,
      pune: 69,
      ahmedabad: 114,
      jaipur: 146,
    }[city.id],
    hourly: offsets.map((offset, i) => ({
      time: new Date(start + i * 3600000).toISOString(),
      aqi: Math.max(12, city.demo + offset),
    })),
  };
}
export function bestWindow(air) {
  return (air.hourly || [])
    .filter((h) => category(h.aqi).level >= 0)
    .reduce((best, h) => (!best || h.aqi < best.aqi ? h : best), null);
}
export function impact(profile) {
  const p = normalizeProfile(profile);
  // Illustrative per-passenger factors, not a verified carbon inventory.
  const baseline =
    p.commute === "car" ? 0.17 : p.commute === "transit" ? 0.06 : 0;
  const alternative = p.commute === "car" ? 0.06 : baseline;
  return {
    savedKg: Number(
      (p.distance * Math.max(0, baseline - alternative)).toFixed(2),
    ),
    baseline,
    alternative,
    distance: p.distance,
  };
}
function movementCard(profile, risk) {
  let title = "Choose a quieter route for movement";
  let action =
    "Keep away from busy roads. If you are unusually sensitive, shorten activity and watch for symptoms.";
  let why =
    "Local traffic and your sensitivity matter, even when city-wide air is better.";
  if (risk.high) {
    title = "Bring your movement indoors";
    action =
      "Swap the outdoor workout for gentle movement in a cleaner indoor space. Postpone strenuous outdoor activity.";
    why =
      risk.category.label +
      " air calls for less outdoor exposure, especially for sensitive household members.";
  }
  if (risk.unknown) {
    title = "Check local air before heading out";
    action =
      "Air data is missing. Check your local monitoring station before outdoor exercise.";
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
    why:
      profile.distance +
      " km total daily travel. Both the journey’s emissions and your outdoor exposure matter.",
    impact:
      estimate.savedKg > 0
        ? "Illustrative car → transit saving: " +
          estimate.savedKg +
          " kg CO₂ per day"
        : "Avoid idling and unnecessary motor journeys",
  };
}

function homeCard(profile, risk) {
  let title = "Start with the no-cost indoor fixes";
  let action =
    "Damp-dust surfaces and avoid incense, smoking, candles, and aerosol sprays indoors.";
  if (profile.budget === "flexible") {
    title = "Consider a correctly sized HEPA cleaner";
    action =
      "Choose a particle air cleaner sized for the room; avoid ozone-generating devices.";
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
    action: action + " " + ventilation,
    why: "Reducing indoor sources limits added particles. Outdoor AQI does not measure the air inside your home.",
    impact:
      "Fewer indoor particle sources, without needing to buy anything first",
  };
}

/** Decide precautions first, then personalize the three independent actions. */
export function makePlan(air, input) {
  const profile = normalizeProfile(input);
  const band = category(air.aqi);
  const risk = {
    category: band,
    high: band.level >= 3 || (profile.sensitive && band.level >= 2),
    severe: band.level >= 4,
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
    summary =
      "Current air data is unavailable. Use local monitoring before making outdoor plans.";
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

function exerciseVerdict(band, high, severe) {
  if (severe) return { status: "AVOID", tone: "hazardous" };
  if (high) return { status: "MOVE INDOORS", tone: "unhealthy" };
  if (band.level === 0) return { status: "RECOMMENDED", tone: "good" };
  return { status: "LIGHT ONLY", tone: "moderate" };
}

function kidsVerdict(level) {
  if (level >= 3) return { status: "INDOORS", tone: "unhealthy" };
  if (level >= 2) return { status: "LIMIT TIME", tone: "sensitive" };
  return { status: "OK WITH CARE", tone: "good" };
}

function maskVerdict(high, severe) {
  if (severe) return { status: "STRONGLY ADVISED", tone: "hazardous" };
  if (high) return { status: "RECOMMENDED", tone: "sensitive" };
  return { status: "OPTIONAL", tone: "good" };
}

/** Deterministic daily activity verdicts derived from US AQI and household sensitivity. */
export function activityReadiness(air, input) {
  const profile = normalizeProfile(input);
  const band = category(air?.aqi);
  if (band.level < 0) {
    return [
      { id: "exercise", label: "Outdoor Exercise", status: "CHECK LOCAL", tone: "unknown", note: "Air data is unavailable. Verify a nearby monitor first." },
      { id: "kids", label: "Children & Sensitive", status: "CHECK LOCAL", tone: "unknown", note: "Wait for a valid reading before outdoor play." },
      { id: "windows", label: "Open Windows", status: "USE CAUTION", tone: "unknown", note: "Avoid trapping indoor smoke or heat while checking outdoor air." },
      { id: "mask", label: "N95 / FFP2 Mask", status: "STANDBY", tone: "unknown", note: "Keep a well-fitting respirator handy if visibility looks hazy." },
    ];
  }
  const high = band.level >= 3 || (profile.sensitive && band.level >= 2);
  const severe = band.level >= 4;
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
        band.level >= 2
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

export function isEmergency(question) {
  return /chest pain|cannot breathe|can[’']t breathe|severe breath|blue lips/i.test(
    question,
  );
}

export function localAnswer(question, air, profile) {
  const plan = makePlan(air, profile);
  const q = question.toLowerCase();
  if (isEmergency(question))
    return "Severe breathing difficulty or chest pain needs urgent medical attention. Contact local emergency services now. This assistant cannot diagnose or manage an emergency.";
  if (/mask|n95|respirator/.test(q))
    return "For unavoidable particle-pollution exposure, a well-fitting certified N95/FFP2 respirator can help reduce inhaled particles, but does not filter all gases. Fit matters; ordinary cloth masks are not equivalent. Respirators may not fit young children. Ask a clinician about suitability for children or people with breathing conditions. Reducing outdoor exposure remains the priority.";
  if (/window|ventilat/.test(q))
    return (
      plan.cards[2].action +
      " Outdoor AQI alone cannot establish safe indoor air; avoid trapping combustion fumes and prioritize heat and immediate safety."
    );
  if (/school|child|kids|parent|asthma|elder|senior|pregnan/.test(q))
    return `For a sensitive household: ${makePlan(air, { ...profile, sensitive: true }).cards[0].action} Follow school/local advisories and a clinician’s existing care plan. Do not change medication based on this app.`;
  if (/commut|travel|bus|car|emission|carbon/.test(q))
    return `${plan.cards[1].action} ${plan.cards[1].impact}. Carbon estimates are illustrative and do not predict a personal health improvement.`;
  if (/purif|indoor|home|plant|incense/.test(q))
    return `${plan.cards[2].action} Houseplants are not a substitute for source control and effective particle filtration.`;
  if (/walk|run|exercise|outdoor|park/.test(q))
    return `${plan.cards[0].action} ${plan.cards[0].why} A lower forecast value is not necessarily safe.`;
  return `${plan.summary} Your priorities: ${plan.cards.map((c) => c.title.toLowerCase()).join("; ")}. Ask me about school runs, ventilation, exercise, masks, or commuting. This local guide uses fixed rules; it is not a generative AI response.`;
}
