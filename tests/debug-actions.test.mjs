import assert from "node:assert/strict";
import test from "node:test";
import { applyDebugAction, DEBUG_MATERIAL_IDS, DEBUG_MATERIAL_NAMES } from "../app/debug-actions.ts";
import { buyPlot, createInitialState, RESEARCH, SPECIAL_ITEM_IDS, startOrderTracking, stepGame } from "../app/game-engine.ts";
import { resolveWorkerDrop } from "../app/worker-drag.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import { saveValuation } from "../app/save-valuation.ts";

const fresh = () => createInitialState(0, 0);
const maxInvestment = Object.values(RESEARCH).flatMap((entry) => entry.costs).reduce((sum, cost) => sum + cost, 0);
const roundtrip = (state) => parseGameSave(exportGameSave(state)).state;

test("all currency, material and item additions preserve other values and roundtrip through saves", () => {
  const initial = fresh();
  initial.coins = 100.25;
  initial.inventory.raw = 12.5;
  initial.inventory.cans = 19.75;
  const original = structuredClone(initial);
  for (const resource of ["coins", ...DEBUG_MATERIAL_IDS, ...SPECIAL_ITEM_IDS]) {
    const expected = structuredClone(initial);
    if (resource === "coins") expected.coins += 17;
    else if (SPECIAL_ITEM_IDS.includes(resource)) expected.inventory.specials[resource] += 17;
    else expected.inventory[resource] += 17;
    const next = applyDebugAction(initial, { type: "add-resource", resource, amount: 17 });
    assert.deepEqual(next, expected, resource);
    assert.deepEqual(roundtrip(next), expected, `${resource} save roundtrip`);
    assert.deepEqual(initial, original, `${resource} leaves source unchanged`);
  }
  assert.ok(DEBUG_MATERIAL_IDS.every((resource) => typeof DEBUG_MATERIAL_NAMES[resource] === "string"));
});

test("invalid increments and unrecognized resources cannot change the game state", () => {
  const state = fresh();
  const original = structuredClone(state);
  for (const amount of [0, -1, .5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "20", undefined]) {
    assert.throws(() => applyDebugAction(state, { type: "add-resource", resource: "coins", amount }), /大于 0 的安全整数/);
  }
  for (const resource of ["specials", "__proto__", "research", undefined]) {
    assert.throws(() => applyDebugAction(state, { type: "add-resource", resource, amount: 1 }), /请选择有效/);
  }
  assert.throws(() => applyDebugAction(state, { type: "unknown" }), /请选择有效/);
  assert.throws(() => applyDebugAction(state, null), /请选择有效/);
  assert.deepEqual(state, original);
});

test("resource additions reject overflow and invalid existing totals, while allowing the safe limit", () => {
  for (const resource of ["coins", "raw", "goldenOrder"]) {
    const state = fresh();
    const container = resource === "coins" ? state : resource === "raw" ? state.inventory : state.inventory.specials;
    container[resource] = Number.MAX_SAFE_INTEGER - 2;
    const next = applyDebugAction(state, { type: "add-resource", resource, amount: 2 });
    const total = resource === "coins" ? next.coins : resource === "raw" ? next.inventory.raw : next.inventory.specials.goldenOrder;
    assert.equal(total, Number.MAX_SAFE_INTEGER);
    assert.ok(roundtrip(next));
    for (const value of [Number.MAX_SAFE_INTEGER, Infinity, NaN, -1]) {
      container[resource] = value;
      assert.throws(() => applyDebugAction(state, { type: "add-resource", resource, amount: 2 }), /范围|数量无效/);
    }
  }
});

test("max research grants all levels without debiting coins and preserves historical investments", () => {
  const state = fresh();
  state.research.synthesis = 2;
  state.research.management = 1;
  // Legacy synthesis research was more expensive; management may be migrated free.
  state.researchInvestment = 250_000;
  state.orderRefreshCooldown = 137;
  state.schedulerRobots[0].efficiency = 1.2;
  const original = structuredClone(state);
  const next = applyDebugAction(state, { type: "max-research" });
  assert.deepEqual(next.research, Object.fromEntries(Object.entries(RESEARCH).map(([id, info]) => [id, info.costs.length])));
  assert.equal(next.researchInvestment, 250_000 + maxInvestment - 13_000 - 3_000);
  assert.deepEqual({ ...next, research: state.research, researchInvestment: state.researchInvestment }, original);
  assert.deepEqual(state, original);
  assert.deepEqual(applyDebugAction(next, { type: "max-research" }), next);
  assert.deepEqual(roundtrip(next), next);
  assert.equal(saveValuation(next).items.find((item) => item.id === "upgrades").value, next.researchInvestment);
});

test("max research refuses an unsafe investment and does not partially grant levels", () => {
  const state = fresh();
  state.researchInvestment = Number.MAX_SAFE_INTEGER;
  const original = structuredClone(state);
  assert.throws(() => applyDebugAction(state, { type: "max-research" }), /研究投入数量超出/);
  assert.deepEqual(state, original);
});

test("research reset removes only research and its cooldown without refunding paid coins or robot upgrades", () => {
  let state = applyDebugAction(fresh(), { type: "max-research" });
  state.coins = 123.75;
  state.inventory.specials.goldenOrder = 3;
  state.schedulerRobots[0] = { efficiency: 1.2, intervalSeconds: 1.8, duties: { rest: false, work: true, wake: true } };
  state.schedulerSeconds = 3600;
  state.schedulerServiceUnlocked = true;
  state.autoCanSupply = true;
  state.orderRefreshCooldown = 137;
  const original = structuredClone(state);
  const next = applyDebugAction(state, { type: "reset-research" });
  assert.ok(Object.values(next.research).every((level) => level === 0));
  assert.equal(next.researchInvestment, 0);
  assert.equal(next.orderRefreshCooldown, 0);
  assert.deepEqual({ ...next, research: state.research, researchInvestment: state.researchInvestment, orderRefreshCooldown: state.orderRefreshCooldown }, original);
  assert.deepEqual(state, original);
  assert.deepEqual(roundtrip(next), next);
});

test("research reset preserves a placed fishing pond, its occupants and claimed harvest without duplicating rewards", () => {
  let state = applyDebugAction(fresh(), { type: "max-research" });
  state = buyPlot(state, { id: "fishing", type: "fishing", name: "摸鱼池", x: 1_000, y: 500, cols: 4, rows: 4, purchasePrice: 0, enabled: true });
  const originalWorker = state.workers[0];
  const drop = resolveWorkerDrop(originalWorker, originalWorker, { x: 1_208, y: 608 }, true, state.plots, state.workers, []);
  assert.equal(drop.accepted, true);
  state.workers[0] = { ...drop.worker, mood: 0, personality: "slowBurn", fishing: { ...drop.worker.fishing, elapsed: 59 } };
  state = stepGame(state, 1, () => .5, undefined, 60_000);
  assert.equal(state.fishingPlots.fishing.history.length, 1);
  const original = structuredClone(state);
  const next = applyDebugAction(state, { type: "reset-research" });
  assert.equal(next.research.fishing, 1, "the existing pond must retain the research required by save validation");
  assert.ok(Object.entries(next.research).every(([id, level]) => level === (id === "fishing" ? 1 : 0)));
  assert.equal(next.researchInvestment, 0);
  assert.deepEqual(next.plots, state.plots);
  assert.deepEqual(next.workers, state.workers);
  assert.deepEqual(next.fishingPlots, state.fishingPlots);
  assert.deepEqual(next.inventory, state.inventory);
  assert.deepEqual(state, original);
  assert.deepEqual(roundtrip(next), next);
  const repeated = roundtrip(applyDebugAction(next, { type: "reset-research" }));
  assert.deepEqual(repeated.inventory, next.inventory);
  assert.deepEqual(repeated.fishingPlots, next.fishingPlots);
  const resumed = stepGame(repeated, 1, () => .5, undefined, 61_000);
  assert.equal(resumed.workers[0].status, "fishing");
  assert.equal(resumed.workers[0].mood, 0);
  assert.equal(resumed.workers[0].fishing.elapsed, 1);
  assert.deepEqual(resumed.fishingPlots, repeated.fishingPlots, "the completed catch is not awarded again after reset and reload");
});

function trackingFactory() {
  const state = fresh();
  state.research.planning = 1;
  state.researchInvestment = RESEARCH.planning.costs[0];
  state.inventory.raw = 1_000;
  state.inventory.rough = 50;
  state.inventory.cans = 100;
  state.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
  state.synthesisPlots.synthesis = { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
  state.workers = ["process", "synthesis"].map((zoneId) => ({ ...state.workers[0], id: `worker-${zoneId}`, zoneId, status: "idle" }));
  state.orders = [{ id: "tracked", remaining: 300, duration: 300, processed: { kind: "refined", amount: 1 }, synthesized: { kind: "screws", amount: 10 }, reward: "coins" }];
  return state;
}

test("reset immediately ends active tracking, refunds reserved inputs and saves without planning research", () => {
  const initial = trackingFactory();
  const tracked = stepGame(startOrderTracking(initial, "tracked"), 1, () => 1);
  assert.equal(tracked.processPlots.process.recipe, "refined");
  assert.equal(tracked.synthesisPlots.synthesis.recipe, "screws");
  assert.equal(tracked.processPlots.process.batch.active, true);
  assert.equal(tracked.synthesisPlots.synthesis.batch.active, true);
  const original = structuredClone(tracked);
  const next = applyDebugAction(tracked, { type: "reset-research" });
  assert.equal(next.productionPlan, null);
  assert.equal(next.inventory.raw, initial.inventory.raw);
  assert.equal(next.inventory.rough, initial.inventory.rough);
  assert.deepEqual(next.processPlots.process, initial.processPlots.process);
  assert.deepEqual(next.synthesisPlots.synthesis, initial.synthesisPlots.synthesis);
  assert.deepEqual(next.workers, tracked.workers);
  assert.deepEqual(next.plots, tracked.plots);
  assert.deepEqual(next.orders, tracked.orders);
  assert.deepEqual(tracked, original);
  assert.deepEqual(roundtrip(next), next);
  const again = applyDebugAction(next, { type: "reset-research" });
  assert.deepEqual(again.inventory, next.inventory, "repeated reset cannot refund twice");
});

test("reset leaves unmanaged batches intact and restores already-restoring plans", () => {
  const state = trackingFactory();
  state.productionPlan = { orderId: "tracked", phase: "restoring", process: {}, synthesis: { synthesis: "cans" }, pausedPlotIds: [] };
  state.processPlots.process = { recipe: "refined", produced: 3, batch: { active: true, progress: .5, reservedRaw: 200 } };
  state.synthesisPlots.synthesis = { recipe: "rebar", produced: 7, batch: { active: true, progress: .5, reserved: { rough: 10, refined: 5, screws: 2 } } };
  const next = applyDebugAction(state, { type: "reset-research" });
  assert.equal(next.productionPlan, null);
  assert.deepEqual(next.processPlots.process, state.processPlots.process);
  assert.equal(next.inventory.raw, state.inventory.raw);
  assert.equal(next.inventory.rough, state.inventory.rough + 10);
  assert.equal(next.inventory.refined, state.inventory.refined + 5);
  assert.equal(next.inventory.screws, state.inventory.screws + 2);
  assert.equal(next.synthesisPlots.synthesis.recipe, "cans");
  assert.equal(next.synthesisPlots.synthesis.batch.active, false);
  assert.deepEqual(roundtrip(next), next);
});

test("reset rejects overflowing batch refunds without losing resources or research", () => {
  const state = stepGame(startOrderTracking(trackingFactory(), "tracked"), 1, () => 1);
  state.inventory.raw = Number.MAX_SAFE_INTEGER;
  const original = structuredClone(state);
  assert.throws(() => applyDebugAction(state, { type: "reset-research" }), /原料数量超出/);
  assert.deepEqual(state, original);
});
