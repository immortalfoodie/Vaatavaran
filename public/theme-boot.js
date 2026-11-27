/*
 * Applies a saved explicit colour theme before first paint, so the page never flashes the
 * wrong theme. Loaded as a classic (blocking) script in <head> because the CSP forbids inline
 * scripts and module scripts run too late. Everything else lives in theme.js.
 * Keep the storage key and values in sync with THEME_STORAGE_KEY / THEMES in theme.js.
 */
try {
  const saved = localStorage.getItem("vaatavaran-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  /* Storage disabled: follow the operating-system theme. */
}
