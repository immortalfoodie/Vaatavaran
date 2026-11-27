/**
 * Modal dialog management with accessible keyboard focus restoration and profile form handling.
 */
import { normalizeProfile } from "./engine.js";
import { ALERT_THRESHOLDS } from "./state.js";
import { $dialog, $form } from "./dom.js";

/** @typedef {import("./state.js").AppState} AppState */

/**
 * Open a native modal dialog and restore keyboard focus to the triggering element on close.
 * @param {HTMLDialogElement} dialog
 * @param {HTMLElement | null} [focusTarget] Optional control to focus once opened.
 */
export function openModal(dialog, focusTarget = null) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (opener) {
    dialog.addEventListener("close", () => opener.focus(), { once: true });
  }
  dialog.showModal();
  focusTarget?.focus();
}

/**
 * Populate and open the Household Preferences modal from current state.
 * @param {AppState} state
 * @param {() => void} onBeforeOpen
 */
export function openProfileDialog(state, onBeforeOpen) {
  onBeforeOpen();
  const form = $form("#profile-form");
  for (const [key, value] of Object.entries(state.profile)) {
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
      field.value = String(value);
    }
  }
  const alertField = form.elements.namedItem("alertAbove");
  if (alertField instanceof HTMLSelectElement) {
    alertField.value = String(state.alertAbove);
  }
  openModal($dialog("#profile-dialog"));
}

/**
 * Validate and apply the Household Preferences form submission.
 * @param {SubmitEvent} event
 * @param {AppState} state
 * @param {{ onSaved: () => void }} callbacks
 */
export function submitProfileForm(event, state, { onSaved }) {
  event.preventDefault();
  const data = new FormData(/** @type {HTMLFormElement} */ (event.currentTarget));
  state.profile = normalizeProfile({
    ...Object.fromEntries(data),
    sensitive: data.has("sensitive"),
    purifier: data.has("purifier"),
  });
  const threshold = Number(data.get("alertAbove"));
  state.alertAbove = ALERT_THRESHOLDS.has(threshold) ? threshold : 0;
  state.completed.clear();
  $dialog("#profile-dialog").close();
  onSaved();
}

/** Wire all `[data-close="<dialog-id>"]` close buttons inside modal dialogs. */
export function bindDialogClosers() {
  document.querySelectorAll("[data-close]").forEach((button) =>
    button.addEventListener("click", () => {
      const dialogId = /** @type {HTMLElement} */ (button).dataset.close ?? "";
      const dialog = document.getElementById(dialogId);
      if (dialog instanceof HTMLDialogElement) dialog.close();
    }),
  );
}
