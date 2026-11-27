/**
 * Minimal DOM helpers shared by every browser module.
 * All text is assigned through `textContent`, never `innerHTML`.
 */

/**
 * Query a single element. Callers rely on the static markup in index.html, so the
 * result is typed loosely to cover inputs, selects, buttons and dialogs alike.
 * @param {string} selector CSS selector.
 * @returns {any} The matching element, or null.
 */
export const $ = (selector) => document.querySelector(selector);

/**
 * Create an HTML element with an optional class name and text content.
 * @param {string} tag Tag name.
 * @param {string} [className] Space-separated classes.
 * @param {string} [text] Text content (assigned literally, never parsed as HTML).
 * @returns {any}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mark a region of the page as loading. CSS shows skeleton placeholders for every element
 * with a matching `data-skeleton` attribute while `<body data-loading>` contains the region.
 * @param {"air" | "outlook"} region
 * @param {boolean} loading
 */
export function setLoadingRegion(region, loading) {
  const regions = new Set((document.body.dataset.loading ?? "").split(" ").filter(Boolean));
  if (loading) regions.add(region);
  else regions.delete(region);
  document.body.dataset.loading = [...regions].join(" ");
}
