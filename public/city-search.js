/**
 * Worldwide city search (Open-Meteo geocoding via the server) and the multi-city comparison.
 */
import { CITIES } from "./engine.js";
import { fetchAir, searchLocations } from "./api.js";
import { renderCityComparison } from "./views.js";
import { openModal } from "./dialogs.js";
import { $, $button, $dialog, $input, el } from "./dom.js";

/** @typedef {import("./types.js").City} City */
/** @typedef {import("./state.js").CustomCity} CustomCity */

const MIN_QUERY_LENGTH = 2;
const COMPARISON_CITY_COUNT = 6;

/** @param {string} text */
const caption = (text) => el("p", "source-caption", text);

/**
 * Render one selectable search result.
 * @param {{ name: string, region: string }} loc
 * @param {() => void} onPick
 */
function resultButton(loc, onPick) {
  const btn = el("button", "city-result-btn");
  btn.type = "button";
  const left = el("div");
  left.append(el("strong", "", loc.name), el("span", "", loc.region));
  btn.append(left, el("span", "row-key", "SELECT ↗"));
  btn.addEventListener("click", onPick);
  return btn;
}

/**
 * Search for a place name and list the matches.
 * @param {string} query
 * @param {(loc: CustomCity) => void} onSelect
 */
async function searchAnyCity(query, onSelect) {
  const container = $("#city-search-results");
  const submit = $button("#city-search-submit");
  container.replaceChildren(caption("Searching locations…"));
  submit.disabled = true;
  try {
    const results = await searchLocations(query);
    container.replaceChildren();
    if (!results.length) {
      container.append(caption("No matching cities found. Try another spelling."));
      return;
    }
    for (const loc of results) container.append(resultButton(loc, () => onSelect(loc)));
  } catch (error) {
    container.replaceChildren(caption(/** @type {Error} */ (error).message));
  } finally {
    submit.disabled = false;
  }
}

/**
 * Wire the "Search any city" dialog.
 * @param {(loc: CustomCity) => void} onSelect Called with the chosen location.
 */
export function bindCitySearch(onSelect) {
  $("#city-search-open")?.addEventListener("click", () => {
    openModal($dialog("#city-dialog"), $input("#city-query"));
  });
  $("#city-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $input("#city-query").value.trim();
    if (query.length >= MIN_QUERY_LENGTH) searchAnyCity(query, onSelect);
  });
}

/**
 * Fetch regional readings for several preset cities and render them most-polluted first.
 * Cities that fail to load are skipped rather than shown with invented values.
 * @param {string} activeCityId
 * @param {(cityId: string) => void} onPick
 */
export async function loadCityComparison(activeCityId, onPick) {
  const btn = $button("#compare-load");
  btn.disabled = true;
  $("#city-compare-list").replaceChildren(
    caption("Fetching live regional readings across cities…"),
  );
  const settled = await Promise.allSettled(
    CITIES.slice(0, COMPARISON_CITY_COUNT).map(async (city) => ({
      city,
      aqi: (await fetchAir(city, "model")).aqi,
    })),
  );
  /** @type {Array<{ city: City, aqi: number | null }>} */
  const rows = settled
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  renderCityComparison(rows, activeCityId, onPick);
  btn.disabled = false;
}
