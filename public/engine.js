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
    }[city.id],
    pm10: {
      delhi: 218,
      mumbai: 83,
      bengaluru: 42,
      kolkata: 128,
      lucknow: 180,
      chennai: 19,
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
export function makePlan(air, profile) {
  const p = normalizeProfile(profile);
  const cat = category(air.aqi);
  const high = cat.level >= 3 || (p.sensitive && cat.level >= 2);
  const severe = cat.level >= 4;
  const unknown = cat.level < 0;
  const cards = [];
  cards.push({
    id: "move",
    kind: "Your movement",
    time: p.outdoor === "morning" ? "Morning" : "Evening",
    icon: "sun",
    title: unknown
      ? "Check local air before heading out"
      : high
        ? "Bring your movement indoors"
        : "Choose a quieter route for movement",
    action: unknown
      ? "Air data is missing. Check your local monitoring station before outdoor exercise."
      : high
        ? "Swap the outdoor workout for gentle movement in a cleaner indoor space. Postpone strenuous outdoor activity."
        : "Keep away from busy roads. If you are unusually sensitive, shorten activity and watch for symptoms.",
    why: unknown
      ? "Missing data must never be interpreted as clean air."
      : `${cat.label} air${p.sensitive ? " and a sensitive household member" : ""} ${high ? "make reducing inhaled pollution the priority" : "still call for attention to local conditions"}.`,
    impact: high
      ? "Less time breathing polluted outdoor air"
      : "Lower exposure to nearby traffic emissions",
  });
  cards.push({
    id: "commute",
    kind: "Your commute",
    time: "On the way",
    icon: "train",
    title:
      p.commute === "home"
        ? "Keep the commute off the calendar"
        : severe
          ? "Postpone nonessential trips"
          : p.commute === "car"
            ? "Try transit for today’s commute"
            : p.commute === "walk" && high
              ? "Swap a long walk for a shorter trip"
              : "Make the trip with fewer emissions",
    action:
      p.commute === "home"
        ? "Working from home avoids travel emissions. Take movement breaks indoors when air is poor."
        : severe
          ? "If travel is essential, choose an enclosed option where practical and keep outdoor waiting short. Avoid traffic hotspots."
          : p.commute === "walk" && high
            ? "Consider an enclosed bus or shared ride if available. Avoid a strenuous walking or cycling commute in poor air."
            : "Use public transport or share a ride where feasible. Choose stops away from idling vehicles; do not assume transit air is always cleaner.",
    why: `${p.distance} km total daily travel; ${p.commute === "car" ? "switching a solo car journey can reduce emissions" : "your travel mode and outdoor exposure both matter"}.`,
    impact:
      impact(p).savedKg > 0
        ? `Illustrative car → transit saving: ${impact(p).savedKg} kg CO₂ per day`
        : "Avoid idling and unnecessary motor journeys",
  });
  cards.push({
    id: "home",
    kind: "Your home",
    time: "At home",
    icon: "home",
    title: p.purifier
      ? "Make one room your cleaner-air space"
      : p.budget === "low"
        ? "Start with the no-cost indoor fixes"
        : "Consider a correctly sized HEPA cleaner",
    action: `${p.purifier ? "Run your particle air cleaner according to its instructions in the room you use most." : p.budget === "low" ? "Damp-dust surfaces and avoid incense, smoking, candles, and aerosol sprays indoors." : "Choose a particle air cleaner sized for the room; avoid ozone-generating devices."} ${high || unknown ? "Keep windows closed during outdoor pollution peaks if it is safe and not too hot; use a cleaner public indoor space if needed." : "Ventilate when outdoor air is cleaner, while considering indoor sources and temperature."}`,
    why: "Reducing indoor sources limits added particles. Outdoor AQI does not measure the air inside your home.",
    impact: "Fewer indoor particle sources; no invented reduction percentage",
  });
  return {
    category: cat,
    high,
    severe,
    cards,
    best: bestWindow(air),
    impact: impact(p),
    headline: unknown
      ? "Check the air. Then plan your day."
      : high
        ? "A little planning. A cleaner-air day."
        : "Make room for a better-air day.",
    summary: unknown
      ? "Current air data is unavailable. Use local monitoring before making outdoor plans."
      : high
        ? "Keep outdoor time short, create a cleaner indoor space, and make essential trips count."
        : "Enjoy your routine thoughtfully, avoid traffic hotspots, and keep indoor pollution sources low.",
  };
}
export function localAnswer(question, air, profile) {
  const plan = makePlan(air, profile);
  const q = question.toLowerCase();
  if (/chest pain|cannot breathe|can't breathe|severe breath|blue lips/.test(q))
    return "Severe breathing difficulty or chest pain needs urgent medical attention. Contact local emergency services now. This assistant cannot diagnose or manage an emergency.";
  if (/mask|n95|respirator/.test(q))
    return "For unavoidable particle-pollution exposure, a well-fitting certified N95/FFP2 respirator can help reduce inhaled particles, but does not filter all gases. Fit matters; ordinary cloth masks are not equivalent. Respirators may not fit young children. Ask a clinician about suitability for children or people with breathing conditions. Reducing outdoor exposure remains the priority.";
  if (/window|ventilat/.test(q))
    return (
      plan.cards[2].action +
      " Outdoor AQI alone cannot establish safe indoor air; avoid trapping combustion fumes and prioritize heat and immediate safety."
    );
  if (/school|child|parent|asthma|elder/.test(q))
    return `For a sensitive household: ${plan.cards[0].action} Follow school/local advisories and a clinician’s existing care plan. Do not change medication based on this app.`;
  if (/commut|travel|bus|car|emission|carbon/.test(q))
    return `${plan.cards[1].action} ${plan.cards[1].impact}. Carbon estimates are illustrative and do not predict a personal health improvement.`;
  if (/purif|indoor|home|plant|incense/.test(q))
    return `${plan.cards[2].action} Houseplants are not a substitute for source control and effective particle filtration.`;
  if (/walk|run|exercise|outdoor|park/.test(q))
    return `${plan.cards[0].action} ${plan.cards[0].why} A lower forecast value is not necessarily safe.`;
  return `${plan.summary} Your priorities: ${plan.cards.map((c) => c.title.toLowerCase()).join("; ")}. Ask me about school runs, ventilation, exercise, masks, or commuting. This local guide uses fixed rules; it is not a generative AI response.`;
}
