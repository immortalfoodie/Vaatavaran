/**
 * Small runtime type guards shared by browser and server modules.
 * Keeps strict TypeScript (`tsc --checkJs`) free of `any` when validating untrusted inputs.
 */

/**
 * Narrow an unknown value to a plain key-value record (excludes null and arrays).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
