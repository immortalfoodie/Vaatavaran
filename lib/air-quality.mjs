import { category, demoAir } from "../public/engine.js";
import { fetchStationAir } from "./station-air.mjs";

export function parseAir(data, city, now = Date.now()) {
  const hourly = data?.hourly;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.us_aqi))
    throw new Error("Invalid upstream data");
  const rows = hourly.time.map((t, i) => ({
    time: new Date(Number(t) * 1000).toISOString(),
    aqi: hourly.us_aqi[i],
    pm25: hourly.pm2_5?.[i],
    pm10: hourly.pm10?.[i],
  }));
  const current = rows.filter((r) => Date.parse(r.time) <= now).at(-1);
  if (
    !current ||
    now - Date.parse(current.time) > 7200000 ||
    category(current.aqi).level < 0
  )
    throw new Error("Missing or stale air quality");
  const currentTs = Date.parse(current.time);
  const currentAqi = Math.round(current.aqi);
  const targetYesterday = currentTs - 86400000;
  const yesterdayRow = rows.find(
    (r) =>
      Math.abs(Date.parse(r.time) - targetYesterday) <= 3600000 &&
      category(r.aqi).level >= 0,
  );
  const yesterdayAqi = yesterdayRow ? Math.round(yesterdayRow.aqi) : null;
  const delta24h = yesterdayAqi !== null ? currentAqi - yesterdayAqi : null;
  const pollutant = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  return {
    city,
    mode: "live",
    source: {
      kind: "model",
      name: "Open-Meteo / CAMS",
      url: "https://open-meteo.com/en/docs/air-quality-api",
      resolutionKm: 45,
      pmAqiAveragingHours: 24,
    },
    fetchedAt: new Date(now).toISOString(),
    observedAt: current.time,
    aqi: currentAqi,
    yesterdayAqi,
    delta24h,
    pm25: pollutant(current.pm25),
    pm10: pollutant(current.pm10),
    hourly: rows
      .filter(
        (r) => Date.parse(r.time) >= currentTs && category(r.aqi).level >= 0,
      )
      .slice(0, 12)
      .map(({ time, aqi }) => ({ time, aqi: Math.round(aqi) })),
  };
}

/** Search cities via Open-Meteo Geocoding API (no API key required). */
export async function searchCities(fetcher, query) {
  const clean = String(query || "").trim();
  if (clean.length < 2 || clean.length > 80) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: clean,
    count: "6",
    language: "en",
    format: "json",
  });
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Location search unavailable");
  const data = await response.json();
  if (!Array.isArray(data?.results)) return [];
  return data.results
    .filter(
      (r) =>
        typeof r?.name === "string" &&
        Number.isFinite(r.latitude) &&
        Number.isFinite(r.longitude),
    )
    .slice(0, 6)
    .map((r) => ({
      name: r.name.slice(0, 80),
      region: [r.admin1, r.country].filter(Boolean).join(", ").slice(0, 100),
      lat: Number(r.latitude.toFixed(4)),
      lon: Number(r.longitude.toFixed(4)),
      zone: typeof r.timezone === "string" ? r.timezone : "Asia/Kolkata",
    }));
}

/** Fetch, validate and cache one model response per city/coord. Concurrent callers share work. */
export function createAirService(fetcher, clock, stationToken = "") {
  const cache = new Map(),
    pending = new Map();
  return async function airFor(city, mode) {
    if (mode === "demo") return demoAir(city.id, clock());
    // Station failures stay failures: never silently replace them with a forecast.
    // Station data is fetched fresh and is not persisted or redistributed as a cache.
    if (mode === "live" && stationToken)
      return fetchStationAir(fetcher, stationToken, city, clock());
    const cacheKey = `${city.id}:${city.lat.toFixed(3)},${city.lon.toFixed(3)}`;
    const cached = cache.get(cacheKey);
    if (cached && clock() - cached.saved < 600000)
      return { ...cached.data, mode };
    if (pending.has(cacheKey)) return { ...(await pending.get(cacheKey)), mode };
    const operation = (async () => {
      const url = new URL(
        "https://air-quality-api.open-meteo.com/v1/air-quality",
      );
      url.search = new URLSearchParams({
        latitude: city.lat,
        longitude: city.lon,
        hourly: "us_aqi,pm2_5,pm10",
        timezone: "GMT",
        timeformat: "unixtime",
        past_days: "1",
        forecast_days: "2",
      });
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Air service unavailable");
      const data = parseAir(await response.json(), city.id, clock());
      if (cache.size > 200) cache.clear();
      cache.set(cacheKey, { data, saved: clock() });
      return data;
    })();
    pending.set(cacheKey, operation);
    try {
      return { ...(await operation), mode };
    } finally {
      pending.delete(cacheKey);
    }
  };
}
