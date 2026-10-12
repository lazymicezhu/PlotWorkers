import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, stepGame } from "../app/game-engine.ts";
import {
  FIRST_REBIRTH_ASSET_REQUIREMENT,
  canFirstRebirth,
  createRebirthPreviewState,
  createRebornPreviewState,
} from "./fixtures/rebirth-preview-state.ts";
import { saveValuation } from "../app/save-valuation.ts";

test("rebirth preview has 5.2 million total assets and has not received its foreman", () => {
  const state = createRebirthPreviewState();
  assert.equal(saveValuation(state).total, 5_200_000);
  assert.equal(state.workers.some((worker) => worker.role === "foreman"), false);
  assert.equal(state.rebirthCount, 0);
  assert.equal(state.workers.length, 7);
  assert.equal(state.plots.length, 4);
  assert.ok(state.inventory.raw > 0);
  assert.ok(state.schedulerSeconds > 0);
  assert.equal(canFirstRebirth(state), true);
});

test("first rebirth unlocks at exactly five million total assets", () => {
  assert.equal(FIRST_REBIRTH_ASSET_REQUIREMENT, 5_000_000);
  const state = createInitialState(0, 0);
  state.coins += FIRST_REBIRTH_ASSET_REQUIREMENT - saveValuation(state).total;
  assert.equal(saveValuation(state).total, FIRST_REBIRTH_ASSET_REQUIREMENT);
  assert.equal(canFirstRebirth(state), true);
  state.coins -= 1;
  assert.equal(saveValuation(state).total, FIRST_REBIRTH_ASSET_REQUIREMENT - 1);
  assert.equal(canFirstRebirth(state), false);
});

test("rebirth eligibility includes owned assets and does not require five million cash", () => {
  const state = createInitialState(0, 0);
  state.coins = 0;
  state.inventory.cans = 2_500_000;
  const before = structuredClone(state);
  assert.equal(canFirstRebirth(state), true);
  assert.deepEqual(state, before);
});

test("reborn workshop resets progress to the formal initial game and adds one foreman", () => {
  const state = createRebornPreviewState();
  const initial = createInitialState(998, 853);
  initial.rebirthCount = 1;
  const foreman = state.workers.find((worker) => worker.role === "foreman");
  assert.equal(state.workers.length, 2);
  assert.equal(state.workers.filter((worker) => worker.role === "foreman").length, 1);
  assert.deepEqual({ ...state, workers: state.workers.filter((worker) => worker.role !== "foreman") }, initial);
  assert.equal(state.coins, 100);
  assert.equal(state.inventory.cans, 20);
  assert.equal(foreman.id, "foreman-1");
  assert.equal(foreman.name, "包工头");
  assert.equal(foreman.zoneId, "gather");
  assert.equal(foreman.status, "gathering");
  assert.equal(foreman.mood, 100);
  const plot = state.plots.find((item) => item.id === foreman.zoneId);
  assert.ok(foreman.u > 0 && foreman.u < plot.cols);
  assert.ok(foreman.v > 0 && foreman.v < plot.rows);
  assert.equal(foreman.x, plot.x + (foreman.u - foreman.v) * 52 + plot.rows * 52);
  assert.equal(foreman.y, plot.y + (foreman.u + foreman.v) * 27);
  // The reward immediately uses the existing guard rules and costs no mood.
  const stepped = stepGame(state, 1, () => 1);
  assert.equal(stepped.inventory.raw, 20);
  assert.equal(stepped.workers.find((worker) => worker.role === "foreman").mood, 100);
});

test("starting a reborn preview leaves the prior scene and other fresh games independent", () => {
  const oldState = createRebirthPreviewState();
  const before = structuredClone(oldState);
  const reborn = createRebornPreviewState();
  const second = createRebornPreviewState();
  reborn.inventory.cans = 0;
  reborn.research.synthesis = 2;
  reborn.plots[0].enabled = false;
  reborn.workers[1].mood = 0;
  assert.deepEqual(oldState, before);
  assert.deepEqual(second, createRebornPreviewState());
  assert.equal(createInitialState(998, 853).workers.some((worker) => worker.role === "foreman"), false);
});
