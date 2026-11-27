/**
 * "Ask Vaatavaran" chat dialog: emergency bypass, server/AI answers, and honest fallbacks.
 * Messages live only in the DOM for this page; nothing is persisted.
 */
import { localAnswer, isEmergency } from "./engine.js";
import { postChat } from "./api.js";
import { $, el } from "./dom.js";

/** @typedef {import("./types.js").Air} Air */
/** @typedef {import("./types.js").City} City */
/** @typedef {import("./types.js").DataMode} DataMode */
/** @typedef {import("./types.js").Profile} Profile */

/**
 * @typedef {object} ChatSnapshot
 * @property {string} cityId Preset id or "custom".
 * @property {City} city Active city.
 * @property {DataMode} mode
 * @property {Profile} profile
 * @property {Air} air Reading shown on screen when the question was asked.
 */

const WELCOME =
  "I can help turn air-quality information into everyday choices. What would make today easier?";

/**
 * Append one chat message.
 * @param {string} text
 * @param {string} who CSS modifier: "user", "assistant", "assistant pending" or "error".
 * @param {string} label Visible source label.
 * @returns {HTMLElement}
 */
function addMessage(text, who, label) {
  const message = el("div", `message ${who}`);
  message.append(el("span", "message-label", label), el("p", "", text));
  $("#chat-messages").append(message);
  message.scrollIntoView({ block: "nearest" });
  return message;
}

/** Clear the conversation and show the welcome message. */
export function resetChat() {
  $("#chat-messages").replaceChildren();
  addMessage(WELCOME, "assistant", "LOCAL GUIDE");
}

/**
 * @param {ChatSnapshot} snapshot
 * @param {string} question
 */
function buildContext(snapshot, question) {
  const { city } = snapshot;
  const custom =
    city.id === "custom"
      ? { lat: city.lat, lon: city.lon, cityName: city.name, zone: city.zone }
      : {};
  return {
    city: snapshot.cityId,
    ...custom,
    mode: snapshot.mode,
    profile: { ...snapshot.profile },
    question,
    useAI: $("#ai-optin").checked,
  };
}

/**
 * @param {string} question
 * @param {ChatSnapshot} snapshot
 * @param {Error} error
 */
function showFailure(question, snapshot, error) {
  if (snapshot.mode === "demo") {
    addMessage(
      `The server could not answer (${error.message}). Using the on-device guide.\n\n${localAnswer(question, snapshot.air, snapshot.profile)}`,
      "assistant",
      "ON-DEVICE GUIDE · DEMO DATA",
    );
    return;
  }
  addMessage(
    `${error.message} Please retry, or explicitly switch to demo mode.`,
    "error",
    "COULD NOT VERIFY LIVE CONTEXT",
  );
}

/**
 * Create the chat controller.
 * @param {() => ChatSnapshot} getSnapshot Reads the current app state when a question is asked.
 * @returns {{ ask: (question: string) => Promise<void> }}
 */
export function createChat(getSnapshot) {
  let busy = false;

  /** @param {boolean} value */
  function setBusy(value) {
    busy = value;
    $("#send-question").disabled = value;
  }

  async function ask(/** @type {string} */ rawQuestion) {
    const question = rawQuestion.trim();
    if (busy || !question) return;
    const snapshot = getSnapshot();
    $("#question").value = "";
    addMessage(question, "user", "YOU");

    if (isEmergency(question)) {
      addMessage(
        localAnswer(question, snapshot.air, snapshot.profile),
        "assistant",
        "URGENT GUIDANCE · ON DEVICE",
      );
      return;
    }

    setBusy(true);
    const waiting = addMessage(
      "Checking your air and household context…",
      "assistant pending",
      "VAATAVARAN",
    );
    try {
      const reply = await postChat(buildContext(snapshot, question));
      const sourceLabel = reply.source === "ai" ? "GEMINI · VERIFY GUIDANCE" : "LOCAL GUIDE";
      addMessage(
        (reply.notice ? `${reply.notice}\n\n` : "") + reply.answer,
        "assistant",
        `${sourceLabel} · ${snapshot.mode.toUpperCase()} DATA`,
      );
    } catch (error) {
      showFailure(question, snapshot, /** @type {Error} */ (error));
    } finally {
      waiting.remove();
      setBusy(false);
      $("#question").focus();
    }
  }

  return { ask };
}
