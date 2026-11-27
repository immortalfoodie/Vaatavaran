/**
 * Minimal, strictly typed DOM helpers shared by every browser module.
 * All text is assigned through `textContent`, never `innerHTML`.
 */

/**
 * Query a single required element from the static index.html markup.
 * @param {string} selector CSS selector.
 * @returns {HTMLElement}
 */
export const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
export const $input = (selector) =>
  /** @type {HTMLInputElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLSelectElement}
 */
export const $select = (selector) =>
  /** @type {HTMLSelectElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLButtonElement}
 */
export const $button = (selector) =>
  /** @type {HTMLButtonElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLFormElement}
 */
export const $form = (selector) =>
  /** @type {HTMLFormElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLDialogElement}
 */
export const $dialog = (selector) =>
  /** @type {HTMLDialogElement} */ (document.querySelector(selector));

/**
 * @param {string} selector
 * @returns {HTMLTimeElement}
 */
export const $time = (selector) =>
  /** @type {HTMLTimeElement} */ (document.querySelector(selector));

/**
 * Create an HTML element with an optional class name and text content.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag Tag name.
 * @param {string} [className] Space-separated classes.
 * @param {string} [text] Text content (assigned literally, never parsed as HTML).
 * @returns {HTMLElementTagNameMap[K]}
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
