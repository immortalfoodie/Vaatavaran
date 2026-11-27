/**
 * Clean-room calculator form on the Home view. Recalculates as the household types;
 * the maths lives in clean-room.js.
 */
import { DIY_BOX_CADR_M3H, TARGET_ACH, estimateCleanRoom } from "./clean-room.js";
import { $, $form, $input, $select } from "./dom.js";

/** @typedef {import("./clean-room.js").RoomEstimate} RoomEstimate */

/** @type {Record<RoomEstimate["verdict"], { label: string, tone: string }>} */
const VERDICTS = {
  good: { label: "WELL SIZED FOR THIS ROOM", tone: "good" },
  helps: { label: "HELPS · UNDERSIZED", tone: "moderate" },
  undersized: { label: "TOO SMALL FOR THIS ROOM", tone: "unhealthy" },
};

/**
 * Read the form; the DIY option substitutes the typical DIY box rating.
 * @param {HTMLFormElement} form
 */
function readForm(form) {
  const data = new FormData(form);
  const diy = data.get("source") === "diy";
  return {
    lengthM: Number(data.get("length")),
    widthM: Number(data.get("width")),
    heightM: Number(data.get("height")),
    cadr: diy ? DIY_BOX_CADR_M3H : Number(data.get("cadr")),
    unit: /** @type {"m3h" | "cfm"} */ (diy ? "m3h" : data.get("unit")),
    diy,
  };
}

/**
 * @param {RoomEstimate | null} estimate
 */
function renderEstimate(estimate) {
  const result = $("#clean-room-result");
  result.hidden = !estimate;
  $("#clean-room-invalid").hidden = Boolean(estimate);
  if (!estimate) return;
  const verdict = VERDICTS[estimate.verdict];
  $("#clean-room-ach").textContent = String(estimate.ach);
  const tag = $("#clean-room-verdict");
  tag.textContent = verdict.label;
  tag.className = `status-tag ${verdict.tone}`;
  $("#clean-room-time").textContent =
    `About ${estimate.minutesTo90} minutes to remove ~90% of particles with doors and windows closed.`;
  $("#clean-room-target").textContent =
    `This ${estimate.volumeM3} m³ room needs a CADR of about ${estimate.recommendedCadrM3h} m³/h ` +
    `(${estimate.recommendedCadrCfm} CFM) for ${TARGET_ACH} air changes per hour.`;
}

/** Wire the calculator; safe to call when the form is absent. */
export function bindCleanRoom() {
  const form = $form("#clean-room-form");
  if (!form) return;
  const update = () => {
    const values = readForm(form);
    $input("#clean-room-cadr").disabled = values.diy;
    $select("#clean-room-unit").disabled = values.diy;
    renderEstimate(estimateCleanRoom(values));
  };
  form.addEventListener("input", update);
  form.addEventListener("submit", (event) => event.preventDefault());
  update();
}
