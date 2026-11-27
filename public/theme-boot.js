/*
 * Applies a saved explicit colour theme before first paint, so the page never flashes the
 * wrong theme. Loaded as a classic (blocking) script in <head> because the CSP forbids inline
 * scripts and module scripts run too late. Everything else lives in theme.js.
 * Light is the default (no attribute); only the opt-in themes need applying here.
 * Keep the storage key and values in sync with THEME_STORAGE_KEY / THEMES in theme.js.
 */
try {
  const saved = localStorage.getItem("vaatavaran-theme");
  if (saved === "dark" || saved === "auto") document.documentElement.dataset.theme = saved;
} catch {
  /* Storage disabled: keep the default light theme. */
}
