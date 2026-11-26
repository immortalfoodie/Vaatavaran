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
  const pollutant = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  return {
    city,
    mode: "live",
    source: { kind: "model", name: "Open-Meteo / CAMS", url: "https://open-meteo.com/en/docs/air-quality-api", resolutionKm: 45, pmAqiAveragingHours: 24 },
    fetchedAt: new Date(now).toISOString(),
    observedAt: current.time,
    aqi: Math.round(current.aqi),
    pm25: pollutant(current.pm25),
    pm10: pollutant(current.pm10),
    hourly: rows
      .filter(
        (r) =>
          Date.parse(r.time) >= Date.parse(current.time) &&
          category(r.aqi).level >= 0,
      )
      .slice(0, 12)
      .map(({ time, aqi }) => ({ time, aqi: Math.round(aqi) })),
  };
}
/** Fetch, validate and cache one model response per city. Concurrent callers share work. */
export function createAirService(fetcher, clock, stationToken = "") {
  const cache = new Map(),
    pending = new Map();
  return async function airFor(city, mode) {
    if (mode === "demo") return demoAir(city.id, clock());
    // Station failures stay failures: never silently replace them with a forecast.
    // Station data is fetched fresh and is not persisted or redistributed as a cache.
    if (mode === "live" && stationToken) return fetchStationAir(fetcher, stationToken, city, clock());
    const cached = cache.get(city.id);
    if (cached && clock() - cached.saved < 600000) return { ...cached.data, mode };
    if (pending.has(city.id)) return { ...await pending.get(city.id), mode };
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
        forecast_days: "2",
      });
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Air service unavailable");
      const data = parseAir(await response.json(), city.id, clock());
      cache.set(city.id, { data, saved: clock() });
      return data;
    })();
    pending.set(city.id, operation);
    try {
      return { ...await operation, mode };
    } finally {
      pending.delete(city.id);
    }
  };
}
