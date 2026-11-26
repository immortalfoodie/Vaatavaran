import { category } from "../public/engine.js";

/** Official US EPA PM2.5 (2024) and PM10 concentration (µg/m³) to US AQI breakpoints. */
const PM25_BP = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 400],
  [325.5, 500.4, 401, 500],
];

const PM10_BP = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 504, 301, 400],
  [505, 604, 401, 500],
];

export function subIndex(value, breakpoints, decimals = 0) {
  if (!Number.isFinite(value) || value < 0) return null;
  const factor = 10 ** decimals;
  const c = Math.floor(value * factor) / factor;
  for (const [cLow, cHigh, iLow, iHigh] of breakpoints) {
    if (c <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow);
    }
  }
  return 500;
}

export function usAqiFromPm(pm25, pm10) {
  const a = subIndex(pm25, PM25_BP, 1);
  const b = subIndex(pm10, PM10_BP, 0);
  if (a === null && b === null) return null;
  return Math.max(a ?? -1, b ?? -1);
}

/** Parse Google Air Quality API currentConditions:lookup payload into Vaatavaran's US AQI shape. */
export function parseGoogleAir(payload, city, now = Date.now()) {
  if (!payload || typeof payload !== "object")
    throw new Error("Google Air Quality data unavailable");
  const observed = Date.parse(payload.dateTime || "");
  if (
    !Number.isFinite(observed) ||
    now - observed > 6 * 3600000 ||
    observed - now > 15 * 60000
  ) {
    throw new Error("Google Air Quality reading is missing or stale");
  }
  const pollutants = Array.isArray(payload.pollutants) ? payload.pollutants : [];
  const findConc = (code) => {
    const item = pollutants.find((p) => p?.code === code);
    const val = item?.concentration?.value;
    return Number.isFinite(val) && val >= 0 ? Number(val.toFixed(1)) : null;
  };
  const pm25 = findConc("pm25");
  const pm10 = findConc("pm10");

  const indexes = Array.isArray(payload.indexes) ? payload.indexes : [];
  const usaIdx = indexes.find((idx) => idx?.code === "usa_epa");
  const localIdx = indexes.find((idx) => idx?.code && idx.code !== "uaqi");
  const aqi = Number.isFinite(usaIdx?.aqi)
    ? Math.round(usaIdx.aqi)
    : usAqiFromPm(pm25, pm10);

  if (category(aqi).level < 0)
    throw new Error("Google Air Quality AQI could not be determined");

  return {
    city: city.id,
    mode: "live",
    aqi,
    pm25,
    pm10,
    hourly: [],
    localIndex:
      localIdx && Number.isFinite(localIdx.aqi)
        ? {
            name: String(localIdx.displayName || localIdx.code).slice(0, 60),
            aqi: Math.round(localIdx.aqi),
            category: String(localIdx.category || "").slice(0, 60),
          }
        : null,
    observedAt: new Date(observed).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    source: {
      kind: "google",
      name: "Google Air Quality API",
      url: "https://developers.google.com/maps/documentation/air-quality",
      resolutionKm: 0.5,
      attributions: [],
    },
  };
}

export async function fetchGoogleAir(fetcher, apiKey, city, now) {
  const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`;
  const response = await fetcher(url, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: { latitude: city.lat, longitude: city.lon },
      extraComputations: ["POLLUTANT_CONCENTRATION", "LOCAL_AQI"],
      customLocalAqis: [{ regionCode: "in", aqi: "usa_epa" }],
      universalAqi: true,
    }),
  });
  if (!response.ok) throw new Error("Google Air Quality service unavailable");
  return parseGoogleAir(await response.json(), city, now);
}
