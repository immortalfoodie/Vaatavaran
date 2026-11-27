/**
 * Clean-room calculator: how well an air cleaner suits a room. Pure; no DOM access.
 *
 * Model: a well-mixed room with doors and windows closed, where the cleaner removes
 * particles at its CADR (clean air delivery rate). Particle levels then fall exponentially,
 * C(t) = C₀·e^(−ACH·t), so a 90% reduction takes ln(10) / ACH hours. Infiltration, indoor
 * sources and placement make real rooms slower, so results are labelled as estimates.
 */

/** 1 cubic foot per minute in cubic metres per hour. */
export const CFM_TO_M3H = 1.699;
/**
 * Target air changes per hour. AHAM's guideline (CADR in CFM ≈ 2/3 of floor area in ft²)
 * works out to 5 ACH for an 8-foot ceiling.
 */
export const TARGET_ACH = 5;
/** Below this, the cleaner still helps but is clearly undersized for the room. */
const MINIMUM_HELPFUL_ACH = 2;
/**
 * Typical CADR of a home-built 4-filter Corsi-Rosenthal box (box fan + four MERV-13
 * filters): 352 ± 40 m³/h measured across first-time builds (Environ. Sci.: Processes &
 * Impacts, 2025). Published values range from 285 to 1,448 m³/h.
 */
export const DIY_BOX_CADR_M3H = 350;
const MAX_DIMENSION_M = 50;
const MAX_CEILING_M = 10;
const MAX_CADR_M3H = 5000;
const REDUCTION_90_PERCENT = Math.log(10);
const MINUTES_PER_HOUR = 60;

/**
 * @typedef {object} RoomInput
 * @property {number} lengthM Room length (m).
 * @property {number} widthM Room width (m).
 * @property {number} heightM Ceiling height (m).
 * @property {number} cadr Cleaner rating, in `unit`.
 * @property {"m3h" | "cfm"} unit
 */

/**
 * @typedef {object} RoomEstimate
 * @property {number} volumeM3
 * @property {number} cadrM3h
 * @property {number} ach Clean air changes per hour.
 * @property {number} minutesTo90 Minutes to remove ~90% of particles (closed, well-mixed room).
 * @property {number} recommendedCadrM3h CADR needed for TARGET_ACH.
 * @property {number} recommendedCadrCfm
 * @property {"good" | "helps" | "undersized"} verdict
 */

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {number | null} Positive number within bounds, or null.
 */
function positive(value, max) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

/**
 * Convert a CADR to m³/h.
 * @param {number} cadr
 * @param {"m3h" | "cfm"} unit
 */
export const toCubicMetresPerHour = (cadr, unit) => (unit === "cfm" ? cadr * CFM_TO_M3H : cadr);

/**
 * @param {number} ach
 * @returns {RoomEstimate["verdict"]}
 */
function verdictFor(ach) {
  if (ach >= TARGET_ACH) return "good";
  if (ach >= MINIMUM_HELPFUL_ACH) return "helps";
  return "undersized";
}

/**
 * Estimate air changes and clean-down time for a room and cleaner.
 * @param {Partial<RoomInput>} input Untrusted form values.
 * @returns {RoomEstimate | null} Null when any dimension or the rating is missing or invalid.
 */
export function estimateCleanRoom(input) {
  const length = positive(input.lengthM, MAX_DIMENSION_M);
  const width = positive(input.widthM, MAX_DIMENSION_M);
  const height = positive(input.heightM, MAX_CEILING_M);
  const unit = input.unit === "cfm" ? "cfm" : "m3h";
  const rating = positive(input.cadr, unit === "cfm" ? MAX_CADR_M3H / CFM_TO_M3H : MAX_CADR_M3H);
  if (length === null || width === null || height === null || rating === null) return null;

  const volumeM3 = length * width * height;
  const cadrM3h = toCubicMetresPerHour(rating, unit);
  const ach = cadrM3h / volumeM3;
  const recommendedCadrM3h = TARGET_ACH * volumeM3;
  return {
    volumeM3: Number(volumeM3.toFixed(1)),
    cadrM3h: Math.round(cadrM3h),
    ach: Number(ach.toFixed(1)),
    minutesTo90: Math.round((REDUCTION_90_PERCENT / ach) * MINUTES_PER_HOUR),
    recommendedCadrM3h: Math.round(recommendedCadrM3h),
    recommendedCadrCfm: Math.round(recommendedCadrM3h / CFM_TO_M3H),
    verdict: verdictFor(ach),
  };
}
