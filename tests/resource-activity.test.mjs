import assert from "node:assert/strict";
import test from "node:test";
import { changeRecipe, createInitialState, createInitialWorker, stepGame, SYNTHESIS_RECIPES } from "../app/game-engine.ts";
import { createResourceActivity, recordResourceChange } from "../app/resource-activity.ts";
import { reconcileSimulationWithActivity, simulateElapsed, simulateElapsedWithActivity } from "../app/simulation-protocol.ts";

const random = () => .5;
const worker = (id, zoneId, fields = {}) => ({ ...createInitialWorker(0, 0), id, zoneId, status: "idle", ...fields });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

function assertEconomicParity(before, result, seconds) {
  assert.deepEqual(result.state, simulateElapsed(before, seconds, random));
  assert.equal(Object.hasOwn(result.state, "activity"), false, "display activity must stay outside the saved game");
  for (const [kind, { gained, spent }] of Object.entries(result.activity)) {
    const net = kind === "coins" ? result.state.coins - before.coins : result.state.inventory[kind] - before.inventory[kind];
    close(gained - spent, net);
  }
}

test("simultaneous gathering and processing retain both sides of a zero-net raw balance", () => {
  const before = createInitialState(0, 0);
  before.inventory.raw = 100;
  before.workers = [
    ...Array.from({ length: 5 }, (_, index) => worker(`gather-${index}`, "gather", { efficiency: 10 })),
    worker("processor", "process"),
  ];
  const result = simulateElapsedWithActivity(before, 1, random);
  assert.equal(result.state.inventory.raw, 100);
  assert.deepEqual(result.activity.raw, { gained: 75, spent: 75 });
  assertEconomicParity(before, result, 1);
});

test("automatic cans and robot refills preserve costs and simultaneous fractional can consumption", () => {
  const before = createInitialState(0, 0);
  before.coins = 1_000;
  before.inventory.cans = 100;
  before.autoCanSupply = before.autoSchedulerSupply = true;
  before.workers = [worker("resting", "living", { mood: 50 })];
  const result = simulateElapsedWithActivity(before, 1, random);
  assert.deepEqual(result.activity.cans, { gained: 200, spent: .01 });
  assert.deepEqual(result.activity.coins, { gained: 0, spent: 700 });
  assertEconomicParity(before, result, 1);
});

test("multiple substeps and a fractional final tick accumulate resource activity", () => {
  const before = createInitialState(0, 0);
  before.workers = [worker("gatherer", "gather"), worker("resting", "living", { mood: 50 })];
  const activity = createResourceActivity();
  const next = simulateElapsed(before, 2.5, random, (kind, delta) => recordResourceChange(activity, kind, delta));
  assert.deepEqual(activity.raw, { gained: 25, spent: 0 });
  close(activity.cans.spent, .025);
  assert.deepEqual({ state: next, activity }, simulateElapsedWithActivity(before, 2.5, random));
  assertEconomicParity(before, { state: next, activity }, 2.5);
  assert.equal(simulateElapsedWithActivity(before, 9, random).activity.raw.gained, 50, "elapsed simulation stays capped at five seconds");
});

test("process activity includes every completed batch and the next reserved inputs", () => {
  for (const [recipe, count, produced, spent] of [["rough", 20, 4, 375], ["refined", 40, 2, 600]]) {
    const before = createInitialState(0, 0);
    before.inventory.raw = 1_000;
    before.processPlots.process.recipe = recipe;
    before.workers = Array.from({ length: count }, (_, index) => worker(`processor-${index}`, "process", { efficiency: 10 }));
    const result = simulateElapsedWithActivity(before, 1, random);
    assert.equal(result.activity[recipe].gained, produced);
    assert.equal(result.activity.raw.spent, spent);
    assertEconomicParity(before, result, 1);
  }
});

for (const recipe of ["cans", "screws", "rebar"]) {
  test(`${recipe} synthesis records both initial and renewed inputs plus every completed output`, () => {
    const before = createInitialState(0, 0);
    before.inventory.rough = before.inventory.refined = before.inventory.screws = 1_000;
    before.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 8, rows: 8, purchasePrice: 300 });
    before.synthesisPlots.synthesis = { recipe, produced: 0, batch: { active: false, progress: 0, reserved: {} } };
    before.workers = Array.from({ length: 180 }, (_, index) => worker(`synthesizer-${index}`, "synthesis", { efficiency: 10 }));
    const result = simulateElapsedWithActivity(before, 1, random);
    const { seconds, output, inputs } = SYNTHESIS_RECIPES[recipe];
    const completed = Math.floor(360 / seconds);
    assert.equal(result.activity[recipe].gained, completed * output);
    for (const [kind, amount] of Object.entries(inputs)) assert.equal(result.activity[kind].spent, (completed + 1) * amount);
    assertEconomicParity(before, result, 1);
  });
}

test("zero time, idle factories and exhausted supplies do not fabricate activity", () => {
  const before = createInitialState(0, 0);
  const activity = createResourceActivity();
  const next = stepGame(before, 0, random, (kind, delta) => recordResourceChange(activity, kind, delta));
  assert.equal(next, before);
  assert.deepEqual(activity, createResourceActivity());
  assert.deepEqual(simulateElapsedWithActivity(before, 1, random).activity, createResourceActivity());
  before.inventory.cans = .003;
  before.workers = [worker("resting", "living", { mood: 50 })];
  const depleted = simulateElapsedWithActivity(before, 1, random);
  close(depleted.activity.cans.spent, .003);
  assertEconomicParity(before, depleted, 1);
});

test("unchanged and visual-only reconciliations keep the accepted worker activity", () => {
  const before = createInitialState(0, 0);
  before.workers = [worker("gatherer", "gather")];
  const result = simulateElapsedWithActivity(before, 1, random);
  const mustNotRecompute = () => { throw new Error("visual changes must not rerun the simulation"); };
  assert.equal(reconcileSimulationWithActivity(before, before, result, 1, mustNotRecompute), result);
  const current = { ...before, workers: before.workers.map((item) => ({ ...item, x: 444, y: 555, u: 3, v: 4, duration: 999, facing: "left" })) };
  const next = reconcileSimulationWithActivity(before, current, result, 1, mustNotRecompute);
  assert.equal(next.activity, result.activity);
  assert.equal(next.state.workers[0].x, 444);
  assert.equal(next.state.workers[0].y, 555);
  assert.equal(next.state.inventory.raw, 10);
});

test("economic reconciliation replaces stale activity without mixing refunded or completed old batches", () => {
  const before = createInitialState(0, 0);
  before.inventory.raw = 1_000;
  before.workers = [worker("processor", "process")];
  before.processPlots.process.batch = { active: true, progress: .98, reservedRaw: 75 };
  const result = simulateElapsedWithActivity(before, 1, random);
  assert.equal(result.activity.rough.gained, 1);
  assert.equal(result.activity.raw.spent, 75);
  const current = changeRecipe(before, "process", "refined");
  const next = reconcileSimulationWithActivity(before, current, result, 1, random);
  assert.deepEqual(next, simulateElapsedWithActivity(current, 1, random));
  assert.notEqual(next.activity, result.activity);
  assert.deepEqual(next.activity.rough, { gained: 0, spent: 0 });
  assert.deepEqual(next.activity.raw, { gained: 0, spent: 200 }, "the player action's refund is not counted again as simulation income");
});
