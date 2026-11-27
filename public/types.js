/**
 * Shared JSDoc type definitions. This module has no runtime code; it is imported only
 * from JSDoc `import()` types so `tsc --checkJs` can validate every module.
 */

/** @typedef {"demo" | "live" | "model"} DataMode */
/** @typedef {"car" | "transit" | "walk" | "home"} Commute */

/**
 * @typedef {object} City
 * @property {string} id Stable identifier (preset id, "custom", or "custom:lat,lon").
 * @property {string} name Display name.
 * @property {string} [region] Region / country label.
 * @property {number} lat Latitude in degrees.
 * @property {number} lon Longitude in degrees.
 * @property {string} zone IANA time zone.
 * @property {number} [demo] Fixed demo-scenario US AQI.
 * @property {number} [demoPm25] Fixed demo-scenario PM2.5 (µg/m³).
 * @property {number} [demoPm10] Fixed demo-scenario PM10 (µg/m³).
 */

/**
 * @typedef {object} Profile
 * @property {boolean} sensitive Household includes a sensitive member (user-selected precaution).
 * @property {Commute} commute Usual travel mode.
 * @property {number} distance Total daily travel distance in km (0–100).
 * @property {boolean} purifier A particle air cleaner is available.
 * @property {"low" | "flexible"} budget Spending preference.
 * @property {"morning" | "evening"} outdoor Preferred exercise time.
 */

/**
 * @typedef {object} HourlyPoint
 * @property {string} time ISO timestamp.
 * @property {number} aqi US AQI for the hour.
 */

/**
 * @typedef {object} Attribution
 * @property {string} name
 * @property {string | null} [url]
 */

/**
 * @typedef {object} AirSource
 * @property {"model" | "google" | "station"} kind
 * @property {string} name
 * @property {string | null} [url]
 * @property {number} [resolutionKm]
 * @property {number} [pmAqiAveragingHours]
 * @property {string} [station]
 * @property {number[]} [coordinates]
 * @property {number} [distanceKm]
 * @property {Attribution[]} [attributions]
 */

/**
 * @typedef {object} Air
 * @property {string} [city]
 * @property {DataMode} [mode]
 * @property {number | null} aqi US AQI, or null when unavailable.
 * @property {number | null} [pm25]
 * @property {number | null} [pm10]
 * @property {HourlyPoint[]} [hourly]
 * @property {string} [observedAt]
 * @property {string} [fetchedAt]
 * @property {number | null} [yesterdayAqi]
 * @property {number | null} [delta24h]
 * @property {AirSource} [source]
 * @property {{ pm25: number | null, pm10: number | null }} [pollutantAqi]
 * @property {{ name: string, aqi: number, category: string } | null} [localIndex]
 */

/**
 * @typedef {object} Category
 * @property {string} label
 * @property {string} tone
 * @property {number} level -1 when unavailable, otherwise 0–5.
 */

/**
 * @typedef {object} PlanCard
 * @property {"move" | "commute" | "home"} id
 * @property {string} kind
 * @property {string} time
 * @property {string} icon
 * @property {string} title
 * @property {string} action
 * @property {string} why
 * @property {string} impact
 */

/**
 * @typedef {object} Impact
 * @property {number} savedKg
 * @property {number} baseline
 * @property {number} alternative
 * @property {number} distance
 */

/**
 * @typedef {object} Plan
 * @property {Category} category
 * @property {boolean} high
 * @property {boolean} severe
 * @property {boolean} unknown
 * @property {PlanCard[]} cards
 * @property {HourlyPoint | null} best
 * @property {Impact} impact
 * @property {string} headline
 * @property {string} summary
 */

export {};
