import { category } from "../public/engine.js";

function safeLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function distanceKm(from, to) {
  const radians = degrees => degrees * Math.PI / 180;
  const [lat, lon] = to;
  const a = Math.sin(radians(lat - from.lat) / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(lat))
    * Math.sin(radians(lon - from.lon) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** WAQI pollutant fields are individual AQI values, NOT µg/m³ concentrations. */
export function parseStationAir(payload, city, now = Date.now()) {
  const data = payload?.data;
  if (payload?.status !== "ok" || !data
    || !["number", "string"].includes(typeof data.aqi) || String(data.aqi).trim() === "") {
    throw new Error("Station data unavailable");
  }
  const aqi = Number(data.aqi);
  const timestamp = data.time?.iso || (data.time?.s && data.time?.tz
    ? data.time.s.replace(" ", "T") + data.time.tz : "");
  const observed = Date.parse(timestamp);
  if (category(aqi).level < 0 || !Number.isFinite(observed)
    || now - observed > 3 * 3600000 || observed - now > 15 * 60000) {
    throw new Error("Station reading is missing, stale or invalid");
  }
  const coordinates = data.city?.geo;
  if (!Array.isArray(coordinates) || coordinates.length !== 2
    || !coordinates.every(Number.isFinite)
    || Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) {
    throw new Error("Station location unavailable");
  }
  const distance = distanceKm(city, coordinates);
  if (distance > 75) throw new Error("No nearby station available");
  const name = typeof data.city.name === "string" ? data.city.name.slice(0, 200) : "Nearby station";
  const attributions = (Array.isArray(data.attributions) ? data.attributions : [])
    .filter(item => item && typeof item.name === "string")
    .slice(0, 10).map(item => ({ name: item.name.slice(0, 200), url: safeLink(item.url) }));
  if (!attributions.length) throw new Error("Station attribution unavailable");
  const pollutantIndex = key => {
    const value = data.iaqi?.[key]?.v;
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  };
  return {
    city: city.id, mode: "live", aqi: Math.round(aqi),
    // Do not relabel sub-indices as mass concentrations or mix model PM into this card.
    pm25: null, pm10: null, hourly: [],
    pollutantAqi: { pm25: pollutantIndex("pm25"), pm10: pollutantIndex("pm10") },
    observedAt: new Date(observed).toISOString(), fetchedAt: new Date(now).toISOString(),
    source: { kind: "station", name: "World Air Quality Index", station: name,
      url: safeLink(data.city.url), coordinates, distanceKm: Number(distance.toFixed(1)), attributions },
  };
}

export async function fetchStationAir(fetcher, token, city, now) {
  const url = new URL(`https://api.waqi.info/feed/geo:${city.lat};${city.lon}/`);
  url.searchParams.set("token", token);
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Station provider unavailable");
  return parseStationAir(await response.json(), city, now);
}
