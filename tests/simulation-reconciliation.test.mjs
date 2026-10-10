import assert from "node:assert/strict";
import test from "node:test";
import {
  changeRecipe,
  changeSynthesisRecipe,
  createInitialState,
  sellProducts,
  submitOrder,
} from "../app/game-engine.ts";
import { reconcileSimulation, simulateElapsed } from "../app/simulation-protocol.ts";

const random = () => .5;
const visualFields = ["u", "v", "x", "y", "duration", "facing"];

function workingState() {
  const state = createInitialState(0, 0);
  state.workers[0] = { ...state.workers[0], zoneId: "gather", status: "idle" };
  return state;
}

function moveWorker(state, coordinate = 7) {
  return {
    ...state,
    workers: state.workers.map((worker) => ({
      ...worker, u: coordinate, v: coordinate, x: coordinate * 100, y: coordinate * 50,
      duration: 5200, facing: "left",
    })),
  };
}

function reconcileChange(base, current, seconds = 1) {
  return reconcileSimulation(base, current, simulateElapsed(base, seconds, random), seconds, random);
}

test("unchanged state accepts the background result without recomputing", () => {
  const base = workingState();
  const result = simulateElapsed(base, 1, random);
  assert.equal(reconcileSimulation(base, base, result, 1, () => { throw new Error("unexpected recomputation"); }), result);
});

test("walking preserves current visual fields and every background economic change", () => {
  const base = workingState();
  base.market.elapsed = 299;
  const result = simulateElapsed(base, 1, random);
  const current = moveWorker(base);
  const next = reconcileSimulation(base, current, result, 1, () => { throw new Error("walking must not recompute"); });
  assert.deepEqual({ ...next, workers: undefined }, { ...result, workers: undefined });
  for (const field of visualFields) assert.equal(next.workers[0][field], current.workers[0][field]);
  for (const field of Object.keys(result.workers[0]).filter((field) => !visualFields.includes(field))) {
    assert.equal(next.workers[0][field], result.workers[0][field]);
  }
  assert.equal(base.inventory.raw, 0);
  assert.equal(current.workers[0].mood, 100);
});

test("one-second simulation and 1.2-second walking keep producing at every six-second overlap", () => {
  let current = workingState();
  let pending;
  let unsimulatedSeconds = 0;
  const accepted = [];
  const events = [];
  for (let time = 1000; time <= 18000; time += 1000) events.push({ time, kind: "request" });
  for (let time = 1200; time <= 18000; time += 1200) events.push({ time, kind: "walk" });
  for (let time = 1008; time <= 18008; time += 1000) events.push({ time, kind: "response" });
  const priority = { request: 0, walk: 1, response: 2 };
  events.sort((a, b) => a.time - b.time || priority[a.kind] - priority[b.kind]);
  for (const event of events) {
    if (event.kind === "request") {
      unsimulatedSeconds += 1;
      pending = { base: current, seconds: unsimulatedSeconds, result: simulateElapsed(current, unsimulatedSeconds, random) };
    } else if (event.kind === "walk") {
      current = moveWorker(current, event.time / 1000);
    } else {
      const previousElapsed = current.market.elapsed;
      current = reconcileSimulation(pending.base, current, pending.result, pending.seconds, random);
      unsimulatedSeconds -= pending.seconds;
      assert.equal(current.market.elapsed - previousElapsed, 1, `production stalled at ${event.time}ms`);
      accepted.push(event.time);
      pending = undefined;
    }
  }
  assert.equal(accepted.length, 18);
  assert.ok(accepted.slice(1).every((time, index) => time - accepted[index] === 1000));
  assert.equal(current.market.elapsed, 18);
  assert.equal(unsimulatedSeconds, 0);
});

test("a sale during simulation stays sold and production advances immediately", () => {
  const base = workingState();
  base.inventory.rough = 8;
  const current = sellProducts(base, "rough");
  const next = reconcileChange(base, current);
  assert.deepEqual(next, simulateElapsed(current, 1, random));
  assert.equal(next.inventory.rough, 0);
  assert.equal(next.coins, 180);
  assert.equal(next.inventory.raw, 10);
});

test("an order submitted during simulation keeps its payment and consumed goods", () => {
  const base = workingState();
  base.inventory.rough = 2;
  base.inventory.screws = 10;
  base.orders = [{ id: "order", remaining: 30, processed: { kind: "rough", amount: 2 }, synthesized: { kind: "screws", amount: 10 }, reward: "coins" }];
  const current = submitOrder(base, "order", random);
  const next = reconcileChange(base, current);
  assert.deepEqual(next, simulateElapsed(current, 1, random));
  assert.equal(next.orders.length, 0);
  assert.equal(next.coins, current.coins);
  assert.equal(next.inventory.rough, 0);
  assert.equal(next.inventory.screws, 0);
});

test("recipe changes discard the old batch result and advance the selected recipe", () => {
  const base = workingState();
  base.workers[0].zoneId = "process";
  base.inventory.raw = 1000;
  base.processPlots.process.batch = { active: true, progress: .98, reservedRaw: 75 };
  const current = changeRecipe(base, "process", "refined");
  const next = reconcileChange(base, current);
  assert.deepEqual(next, simulateElapsed(current, 1, random));
  assert.equal(next.processPlots.process.recipe, "refined");
  assert.equal(next.inventory.rough, 0);
  assert.ok(next.processPlots.process.batch.progress > 0);

  base.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 });
  base.workers[0].zoneId = "synthesis";
  base.inventory.rough = 100;
  base.inventory.refined = 100;
  base.inventory.screws = 100;
  base.synthesisPlots.synthesis = { recipe: "screws", produced: 0, batch: { active: true, progress: .995, reserved: { rough: 20 } } };
  const switched = changeSynthesisRecipe(base, "synthesis", "rebar");
  const synthesized = reconcileChange(base, switched);
  assert.deepEqual(synthesized, simulateElapsed(switched, 1, random));
  assert.equal(synthesized.synthesisPlots.synthesis.recipe, "rebar");
  assert.ok(synthesized.synthesisPlots.synthesis.batch.progress > 0);
});

test("dragging and robot transfers preserve the latest work status and destination", () => {
  const base = workingState();
  const dragging = { ...base, workers: [{ ...base.workers[0], status: "dragging", x: 300, y: 500 }] };
  const whileDragging = reconcileChange(base, dragging);
  assert.deepEqual(whileDragging, simulateElapsed(dragging, 1, random));
  assert.equal(whileDragging.workers[0].status, "dragging");
  assert.equal(whileDragging.inventory.raw, 0);
  assert.equal(whileDragging.market.elapsed, 1);

  const moved = { ...base, workers: [{ ...base.workers[0], zoneId: "living", status: "resting", mood: 30, u: 3, v: 2 }] };
  const afterTransfer = reconcileChange(base, moved);
  assert.deepEqual(afterTransfer, simulateElapsed(moved, 1, random));
  assert.equal(afterTransfer.workers[0].zoneId, "living");
  assert.ok(afterTransfer.workers[0].mood > 30);
  assert.equal(afterTransfer.inventory.raw, 0);
});

test("worker additions, removals and ability changes invalidate the old simulation", () => {
  const base = workingState();
  const worker = base.workers[0];
  const changes = [
    [],
    [worker, { ...worker, id: "new-worker" }],
    [{ ...worker, id: "replacement-worker" }],
    [{ ...worker, efficiency: 10 }],
    [{ ...worker, stamina: 10 }],
    [{ ...worker, spirit: 10 }],
    [{ ...worker, personality: "leader" }],
    [{ ...worker, mood: 0 }],
  ];
  for (const workers of changes) {
    const current = { ...base, workers };
    assert.deepEqual(reconcileChange(base, current, 2.5), simulateElapsed(current, 2.5, random));
  }
});
