import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHESIS_RECIPES,
  cancelOrderTracking,
  changeRecipe,
  changeSynthesisRecipe,
  createInitialState,
  getOrderProductionStatus,
  parseSavedState,
  refreshOrder,
  startOrderTracking,
  stepGame,
  submitOrder,
  togglePlotEnabled,
} from "../app/game-engine.ts";
import { isPlannedPlotPaused, productionPlanCanReserve, refreshProductionPlan } from "../app/order-production-plan.ts";

function factory({ processes = 1, syntheses = 1, processed = "rough", processedAmount = 4, synthesized = "rebar", synthesizedAmount = 10 } = {}) {
  const state = createInitialState(0, 0);
  state.research.planning = 1;
  state.inventory.raw = 1_000_000;
  state.inventory.cans = 200;
  state.workers = [];
  state.plots = state.plots.filter((plot) => plot.type !== "process");
  state.processPlots = {};
  for (let index = 0; index < processes; index += 1) {
    const id = `process-${index}`;
    state.plots.push({ id, type: "process", name: "加工区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
    state.processPlots[id] = { recipe: "rough", produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } };
    addStaff(state, id);
  }
  for (let index = 0; index < syntheses; index += 1) {
    const id = `synthesis-${index}`;
    state.plots.push({ id, type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
    state.synthesisPlots[id] = { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
    addStaff(state, id);
  }
  state.orders = [{ id: "tracked", remaining: 10_000, processed: { kind: processed, amount: processedAmount }, synthesized: { kind: synthesized, amount: synthesizedAmount }, reward: "coins", refreshed: false }];
  return state;
}

function addStaff(state, zoneId) {
  const worker = createInitialState(0, 0).workers[0];
  state.workers.push({ ...worker, id: `foreman-${zoneId}`, role: "foreman", zoneId, status: "idle" });
}

function until(state, predicate, limit = 1500) {
  for (let elapsed = 0; elapsed < limit && !predicate(state); elapsed += 1) state = stepGame(state, 1, () => 1);
  assert.ok(predicate(state), `simulation did not finish: ${JSON.stringify({ inventory: state.inventory, plan: state.productionPlan, processes: state.processPlots, synthesis: state.synthesisPlots })}`);
  return state;
}

const ready = (state) => getOrderProductionStatus(state).phase === "ready";

test("tracking requires its research and preserves the previous state", () => {
  const locked = factory();
  locked.research.planning = 0;
  assert.equal(startOrderTracking(locked, "tracked"), locked);
  const initial = factory();
  const original = structuredClone(initial);
  const tracked = startOrderTracking(initial, "tracked");
  assert.deepEqual(initial, original);
  assert.equal(tracked.productionPlan.orderId, "tracked");
  assert.equal(startOrderTracking(tracked, "tracked"), tracked);
  assert.equal(startOrderTracking(initial, "missing"), initial);
});

test("one processing and one synthesis plot complete the entire rebar chain and protect the delivery stock", () => {
  let state = startOrderTracking(factory(), "tracked");
  const processRecipes = new Set();
  const synthesisRecipes = new Set();
  state = until(state, (current) => {
    processRecipes.add(current.processPlots["process-0"].recipe);
    synthesisRecipes.add(current.synthesisPlots["synthesis-0"].recipe);
    return ready(current);
  });
  assert.deepEqual([...processRecipes].sort(), ["refined", "rough"]);
  assert.ok(synthesisRecipes.has("screws") && synthesisRecipes.has("rebar"));
  assert.equal(state.inventory.rough, 4);
  assert.equal(state.inventory.refined, 0);
  assert.equal(state.inventory.screws, 8);
  assert.equal(state.inventory.rebar, 10);
  assert.equal(state.synthesisPlots["synthesis-0"].batch.active, false);
  assert.equal(state.processPlots["process-0"].batch.active, false);
  const settled = structuredClone(state.inventory);
  for (let tick = 0; tick < 100; tick += 1) state = stepGame(state, 1, () => 1);
  assert.deepEqual(state.inventory, settled);
  const delivered = submitOrder(state, "tracked");
  assert.equal(delivered.productionPlan, null);
  assert.equal(delivered.processPlots["process-0"].recipe, "rough");
  assert.equal(delivered.synthesisPlots["synthesis-0"].recipe, "cans");
});

test("multiple plots share one budget and do not duplicate a single synthesis batch", () => {
  let state = startOrderTracking(factory({ processes: 4, syntheses: 3, processedAmount: 3, synthesized: "screws" }), "tracked");
  let maxScrewBatches = 0;
  state = until(state, (current) => {
    maxScrewBatches = Math.max(maxScrewBatches, Object.values(current.synthesisPlots).filter((plot) => plot.recipe === "screws" && plot.batch.active).length);
    return ready(current);
  });
  assert.equal(maxScrewBatches, 1);
  assert.equal(state.inventory.screws, 10);
  assert.equal(state.inventory.rough, 3);
  assert.equal(state.inventory.raw, 1_000_000 - 23 * 75);
  assert.ok(Object.keys(state.productionPlan.process).every((id) => isPlannedPlotPaused(state, id)));
  assert.ok(Object.keys(state.productionPlan.synthesis).every((id) => isPlannedPlotPaused(state, id)));
});

test("new tracking preserves a running recipe until its batch finishes", () => {
  const initial = factory({ processed: "refined", synthesized: "screws" });
  initial.processPlots["process-0"].batch = { active: true, progress: .9, reservedRaw: 75 };
  initial.synthesisPlots["synthesis-0"].batch = { active: true, progress: .2, reserved: { rough: 1, refined: 1 } };
  let state = startOrderTracking(initial, "tracked");
  assert.equal(state.processPlots["process-0"].recipe, "rough");
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "cans");
  state = stepGame(state, 1, () => 1);
  assert.equal(state.inventory.rough, 1);
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "cans");
  assert.ok(state.synthesisPlots["synthesis-0"].batch.progress > .2);
  state = until(state, ready);
  assert.equal(state.inventory.screws, 10);
});

test("cancellation keeps restoration snapshots through a save until running batches finish", () => {
  const initial = factory({ processed: "refined", processedAmount: 1, synthesized: "screws" });
  for (const worker of initial.workers) delete worker.role;
  initial.inventory.rough = 50;
  let state = stepGame(startOrderTracking(initial, "tracked"), 1, () => 1);
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "screws");
  const before = structuredClone(state);
  state = cancelOrderTracking(state);
  assert.deepEqual(before.synthesisPlots["synthesis-0"].batch, state.synthesisPlots["synthesis-0"].batch);
  assert.equal(state.productionPlan.phase, "restoring");
  assert.equal(before.productionPlan.phase, "tracking");
  state.orders = [];
  state = parseSavedState(JSON.stringify(state));
  assert.ok(state);
  assert.equal(state.productionPlan.phase, "restoring");
  state = until(state, (current) => current.productionPlan === null);
  assert.equal(state.processPlots["process-0"].recipe, "rough");
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "cans");
});

test("unattended cancellation refunds reserved ingredients and restores immediately", () => {
  const initial = factory({ processed: "refined", processedAmount: 1, synthesized: "screws" });
  initial.inventory.rough = 50;
  let state = stepGame(startOrderTracking(initial, "tracked"), 1, () => 1);
  state.workers = [];
  state = cancelOrderTracking(state);
  assert.equal(state.productionPlan, null);
  assert.equal(state.inventory.raw, initial.inventory.raw);
  assert.equal(state.inventory.rough, initial.inventory.rough);
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "cans");
});

test("manual recipe changes leave management and cancellation does not overwrite them", () => {
  const initial = factory({ processed: "refined", processedAmount: 1, synthesized: "screws" });
  initial.inventory.rough = 50;
  let state = startOrderTracking(initial, "tracked");
  assert.equal(state.processPlots["process-0"].recipe, "refined");
  state = changeRecipe(state, "process-0", "rough");
  assert.equal(state.productionPlan.process["process-0"], undefined);
  state = changeSynthesisRecipe(state, "synthesis-0", "rebar");
  assert.equal(state.productionPlan, null);
  state = cancelOrderTracking(state);
  assert.equal(state.synthesisPlots["synthesis-0"].recipe, "rebar");
});

test("expiry and customer replacement both restore the original recipes", () => {
  let expiring = factory({ synthesized: "screws" });
  expiring.orders[0].remaining = .1;
  expiring = stepGame(startOrderTracking(expiring, "tracked"), 1, () => 1);
  assert.equal(expiring.productionPlan.phase, "restoring");
  expiring = until(expiring, (current) => !current.productionPlan);
  assert.equal(expiring.synthesisPlots["synthesis-0"].recipe, "cans");
  let replaced = factory({ synthesized: "screws" });
  replaced.research.negotiation = 1;
  replaced = startOrderTracking(replaced, "tracked");
  replaced = refreshOrder(replaced, "tracked", () => .5);
  assert.equal(replaced.productionPlan, null);
  assert.equal(replaced.synthesisPlots["synthesis-0"].recipe, "cans");
});

test("food is replenished before order production and the original can plot can then make the order", () => {
  const initial = factory();
  initial.inventory.cans = 0;
  const expectedFood = productionPlanCanReserve(initial);
  let state = startOrderTracking(initial, "tracked");
  let sawCans = false;
  let sawScrews = false;
  let sawRebar = false;
  state = until(state, (current) => {
    if (current.synthesisPlots["synthesis-0"].batch.active) {
      const kind = current.synthesisPlots["synthesis-0"].recipe;
      sawCans ||= kind === "cans";
      sawScrews ||= kind === "screws";
      sawRebar ||= kind === "rebar";
      if (kind !== "cans") assert.ok(current.inventory.cans >= expectedFood);
    }
    return ready(current);
  });
  assert.ok(sawCans && sawScrews && sawRebar);
  assert.equal(state.inventory.cans, expectedFood);
  assert.equal(state.inventory.rough, initial.orders[0].processed.amount);
});

test("a disabled tracked plot restores and does not strand a paused plot id in saves", () => {
  const initial = factory({ processes: 2, synthesized: "screws" });
  let state = stepGame(startOrderTracking(initial, "tracked"), 1, () => 1);
  const reserved = state.processPlots["process-0"].batch.reservedRaw;
  const raw = state.inventory.raw;
  state = togglePlotEnabled(state, "process-0");
  refreshProductionPlan(state, SYNTHESIS_RECIPES);
  assert.equal(state.productionPlan.process["process-0"], undefined);
  assert.ok(!state.productionPlan.pausedPlotIds.includes("process-0"));
  assert.equal(state.inventory.raw, raw + reserved);
  assert.equal(state.processPlots["process-0"].batch.active, false);
});


test("preexisting disabled batches cannot satisfy projected demand and block the available production line", () => {
  const initial = factory({ processes: 2, syntheses: 2, processedAmount: 1, synthesized: "screws" });
  initial.plots.find((plot) => plot.id === "process-1").enabled = false;
  initial.plots.find((plot) => plot.id === "synthesis-1").enabled = false;
  initial.processPlots["process-1"].batch = { active: true, progress: .5, reservedRaw: 75 };
  initial.synthesisPlots["synthesis-1"] = { recipe: "screws", produced: 0, batch: { active: true, progress: .5, reserved: { rough: 20 } } };
  const state = until(startOrderTracking(initial, "tracked"), ready);
  assert.equal(state.inventory.rough, 1);
  assert.equal(state.inventory.screws, 10);
  assert.equal(state.synthesisPlots["synthesis-1"].batch.progress, .5);
  assert.equal(state.productionPlan.synthesis["synthesis-1"], undefined);
});
