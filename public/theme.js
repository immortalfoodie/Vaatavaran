/**
 * Colour theme preference. Light is the default; "dark" and "auto" (follow the operating
 * system) are opt-in. CSS does the work: tokens use light-dark() and <html data-theme>
 * selects `color-scheme`. theme-boot.js applies a saved choice before first paint; this
 * module owns the toggle.
 */

/** @typedef {"auto" | "light" | "dark"} Theme */

export const THEME_STORAGE_KEY = "vaatavaran-theme";
/** Theme used until the visitor picks another one. */
export const DEFAULT_THEME = "light";
/** Cycle order for the toggle button, starting from the default. */
export const THEMES = /** @type {const} */ (["light", "dark", "auto"]);

/** Browser UI colour (address bar on mobile) for each resolved theme; matches --bg. */
const THEME_COLORS = { light: "#f7f8f3", dark: "#10150d" };
/** @type {Record<Theme, { icon: string, label: string, description: string }>} */
const THEME_COPY = {
  auto: { icon: "◐", label: "Auto", description: "follows your device" },
  light: { icon: "☀", label: "Light", description: "default" },
  dark: { icon: "☾", label: "Dark", description: "always dark" },
};

/**
 * Coerce an untrusted stored value into a valid theme.
 * @param {unknown} value
 * @returns {Theme}
 */
export function normalizeTheme(value) {
  return THEMES.includes(/** @type {Theme} */ (value))
    ? /** @type {Theme} */ (value)
    : DEFAULT_THEME;
}

/**
 * The theme the toggle switches to next (Light → Dark → Auto → Light).
 * @param {Theme} theme
 * @returns {Theme}
 */
export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/**
 * Accessible name for the toggle. Starts with the visible label so speech-input users can
 * activate it by what they see (WCAG 2.5.3 Label in Name).
 * @param {Theme} theme
 * @returns {string}
 */
export function themeButtonLabel(theme) {
  const current = THEME_COPY[theme];
  const next = THEME_COPY[nextTheme(theme)];
  return `${current.label} theme (${current.description}). Switch to ${next.label.toLowerCase()} theme.`;
}

/** @returns {Theme} */
function readTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** @param {Theme} theme */
function saveTheme(theme) {
  try {
    if (theme === DEFAULT_THEME) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage disabled: the choice still applies for this page view. */
  }
}

/**
 * Point the browser-UI theme colour at the chosen theme, or back at the media-matched
 * defaults for "auto".
 * @param {Theme} theme
 */
function syncThemeColorMeta(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const mediaTheme = meta.getAttribute("media")?.includes("dark") ? "dark" : "light";
    meta.setAttribute("content", THEME_COLORS[theme === "auto" ? mediaTheme : theme]);
  }
}

/**
 * Apply a theme to the page and reflect it on the toggle button.
 * @param {Theme} theme
 * @param {HTMLButtonElement} button
 */
function applyTheme(theme, button) {
  const root = document.documentElement;
  if (theme === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = theme;
  syncThemeColorMeta(theme);

  const copy = THEME_COPY[theme];
  button.dataset.theme = theme;
  button.setAttribute("aria-label", themeButtonLabel(theme));
  button.title = `Theme: ${copy.label} (${copy.description})`;
  /** @type {HTMLElement} */ (button.querySelector(".theme-toggle-icon")).textContent = copy.icon;
  /** @type {HTMLElement} */ (button.querySelector(".theme-toggle-label")).textContent =
    copy.label.toUpperCase();
}

/**
 * Wire the theme toggle button: show the saved theme and cycle on click.
 * @param {HTMLButtonElement | null} button
 */
export function bindThemeToggle(button) {
  if (!button) return;
  let theme = readTheme();
  applyTheme(theme, button);
  button.addEventListener("click", () => {
    theme = nextTheme(theme);
    saveTheme(theme);
    applyTheme(theme, button);
  });
}
