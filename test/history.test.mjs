import test from "node:test";
import assert from "node:assert/strict";
import {
  RETENTION_DAYS,
  emptyHistory,
  normalizeHistory,
  recordChecklist,
  recordPlan,
  summarizeMonth,
} from "../public/history.js";
import { impactTiles, monthLabel } from "../public/history-view.js";

const plan = { moved: 2, indoors: 1, baselineDose: 6000, plannedDose: 4000 };

test("Monthly totals add up checklist actions, CO₂ and followed plans", () => {
  let history = emptyHistory();
  history = recordChecklist(history, "2026-11-25", { completed: ["move", "commute"], co2Kg: 1.32 });
  history = recordChecklist(history, "2026-11-26", { completed: ["home"], co2Kg: 0 });
  history = recordPlan(history, "2026-11-26", plan);
  history = recordChecklist(history, "2026-10-30", { completed: ["move"], co2Kg: 1 });

  const november = summarizeMonth(history, "2026-11");
  assert.deepEqual(november, {
    activeDays: 2,
    actionsCompleted: 3,
    co2Kg: 1.32,
    activitiesMoved: 2,
    movedIndoors: 1,
    exposureReduction: 1 - 4000 / 6000,
  });
  assert.equal(summarizeMonth(history, "2026-10").exposureReduction, null, "no plan followed");
});

test("Re-recording a day replaces it, so unticking or re-planning never double counts", () => {
  let history = recordChecklist(emptyHistory(), "2026-11-27", {
    completed: ["move", "home"],
    co2Kg: 0,
  });
  history = recordChecklist(history, "2026-11-27", { completed: ["home"], co2Kg: 0 });
  history = recordPlan(history, "2026-11-27", plan);
  history = recordPlan(history, "2026-11-27", { ...plan, moved: 1 });
  const summary = summarizeMonth(history, "2026-11");
  assert.equal(summary.actionsCompleted, 1);
  assert.equal(summary.activitiesMoved, 1);
});

test("Only the most recent days are kept on the device", () => {
  let history = emptyHistory();
  for (let i = 0; i < RETENTION_DAYS + 10; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    history = recordChecklist(history, day, { completed: ["move"], co2Kg: 0 });
  }
  assert.equal(Object.keys(history.days).length, RETENTION_DAYS);
  assert.ok(!history.days["2026-01-01"], "oldest days are dropped");
});

test("Corrupted or tampered storage is cleaned rather than trusted", () => {
  const history = normalizeHistory({
    days: {
      "2026-11-27": { completed: ["move", "move", "hack"], co2Kg: 1e9, plan: { moved: -3 } },
      "not-a-day": { completed: ["move"] },
      "2026-11-28": "garbage",
    },
  });
  assert.deepEqual(Object.keys(history.days), ["2026-11-27"]);
  assert.deepEqual(history.days["2026-11-27"].completed, ["move"]);
  assert.equal(history.days["2026-11-27"].co2Kg, 100, "capped");
  assert.equal(history.days["2026-11-27"].plan.moved, 0);
  assert.deepEqual(normalizeHistory(null), emptyHistory());
  assert.deepEqual(normalizeHistory("[]"), emptyHistory());
});

test("Impact tiles show particle savings only when a plan was followed", () => {
  const base = {
    activeDays: 3,
    actionsCompleted: 5,
    co2Kg: 2.6,
    activitiesMoved: 4,
    movedIndoors: 0,
    exposureReduction: null,
  };
  assert.equal(impactTiles(base).length, 4);
  const tiles = impactTiles({ ...base, exposureReduction: 0.31 });
  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles[4][0], "31%");
  assert.equal(tiles[3][0], "2.6");
  assert.equal(monthLabel("2026-11"), "November 2026");
});
