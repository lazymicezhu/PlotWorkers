import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, stepGame } from "../app/game-engine.ts";
import { createFishingProgress, fishingSeatPoint } from "../app/fishing.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";

const parse = (state) => parseGameSave(JSON.stringify(state)).state;
const empty = { itemId: null, kind: "empty", quantity: 0 };
const rough = { itemId: "rough", kind: "product", quantity: 1 };
const gold = { itemId: "goldenOrder", kind: "gold", quantity: 1 };

function fishingSave() {
  const state = createInitialState(100, 200);
  const plot = { id: "fishing-1", type: "fishing", name: "摸鱼池", x: 600, y: 400, cols: 4, rows: 4, purchasePrice: 0, enabled: true };
  state.research.fishing = 1;
  state.plots.push(plot);
  state.plotPurchases.fishing = 1;
  state.fishingPlots[plot.id] = { history: [
    { ...empty, id: 1, caughtAt: 1_000 },
    { ...rough, id: 2, caughtAt: 30_000 },
    { ...gold, id: 3, caughtAt: 60_000 },
  ], nextCatchId: 4 };
  state.inventory.rough = 1;
  state.inventory.specials.goldenOrder = 1;
  for (const [index, seat] of ["left", "back", "right"].entries()) {
    const worker = { ...state.workers[0], id: `fisher-${index}`, zoneId: plot.id, status: "fishing", mood: 0, personality: index === 1 ? "lazy" : "slowBurn" };
    Object.assign(worker, fishingSeatPoint(plot, seat));
    worker.fishing = { ...createFishingProgress(seat, () => .2 + index * .1), elapsed: 20 + index };
    if (index === 0) state.workers[0] = worker;
    else state.workers.push(worker);
  }
  return state;
}

function rejects(change, message) {
  const state = fishingSave();
  change(state);
  assert.throws(() => parse(state), /无效|不完整/, `import: ${message}`);
  assert.throws(() => exportGameSave(state), /无效|不完整/, `export: ${message}`);
}

test("fishing round trips retain three zero-mood fishers, independent clocks, outcomes and recent history", () => {
  const state = fishingSave();
  const original = structuredClone(state);
  const restored = parseGameSave(exportGameSave(state)).state;
  assert.deepEqual(restored, state);
  assert.deepEqual(state, original);
  const next = stepGame(restored, 1, () => .5);
  const fishers = next.workers.filter((worker) => worker.zoneId === "fishing-1");
  assert.deepEqual(fishers.map((worker) => worker.mood), [0, 0, 0]);
  assert.deepEqual(fishers.map((worker) => worker.fishing.elapsed), [21, 23, 23]);
  assert.deepEqual(next.fishingPlots["fishing-1"].history, state.fishingPlots["fishing-1"].history);
});

test("version ten without fishing fields migrates losslessly with an available free research", () => {
  const state = createInitialState(100, 200);
  state.version = 10;
  state.coins = 1_234;
  state.inventory.specials.goldenOrder = 2;
  state.research.gather = 1;
  state.researchInvestment = 1_000;
  delete state.fishingPlots;
  delete state.plotPurchases.fishing;
  delete state.research.fishing;
  const restored = parse(state);
  assert.equal(restored.version, 11);
  assert.deepEqual(restored.fishingPlots, {});
  assert.equal(restored.plotPurchases.fishing, 0);
  assert.equal(restored.research.fishing, 0);
  assert.equal(restored.coins, state.coins);
  assert.deepEqual(restored.inventory, state.inventory);
  assert.deepEqual(restored.workers, state.workers);
  assert.equal(restored.research.gather, 1);
  assert.equal(restored.researchInvestment, 1_000);
  assert.deepEqual(parseGameSave(exportGameSave(restored)).state, restored);
});

test("current fishing saves require complete state, research and purchase fields", () => {
  for (const [name, corrupt] of [
    ["pool map", (state) => { delete state.fishingPlots; }],
    ["pool history", (state) => { delete state.fishingPlots["fishing-1"]; }],
    ["research", (state) => { delete state.research.fishing; }],
    ["purchase record", (state) => { delete state.plotPurchases.fishing; }],
    ["purchase map", (state) => { delete state.plotPurchases; }],
    ["locked research", (state) => { state.research.fishing = 0; }],
    ["too many research levels", (state) => { state.research.fishing = 2; }],
    ["bad size", (state) => { state.plots.at(-1).cols = 8; }],
    ["unknown history reference", (state) => { state.fishingPlots.missing = { history: [], nextCatchId: 1 }; }],
    ["non-pool history reference", (state) => { state.fishingPlots.gather = { history: [], nextCatchId: 1 }; }],
    ["second pond", (state) => { state.plots.push({ ...state.plots.at(-1), id: "fishing-2" }); state.fishingPlots["fishing-2"] = { history: [], nextCatchId: 1 }; }],
  ]) rejects(corrupt, name);
});

test("corrupt clocks, invalid seats and mismatched loot are never silently repaired", () => {
  for (const key of ["elapsed", "cycle", "seed"]) {
    for (const value of [-1, null, "1", NaN, Infinity]) rejects((state) => { state.workers[0].fishing[key] = value; }, `${key}: ${value}`);
  }
  for (const [key, value] of [["elapsed", 60], ["cycle", .5], ["cycle", Number.MAX_SAFE_INTEGER], ["seed", .5], ["seed", 0x1_0000_0000], ["seat", "middle"]]) {
    rejects((state) => { state.workers[0].fishing[key] = value; }, `${key}: ${value}`);
  }
  for (const outcome of [null, {}, { ...empty, quantity: 1 }, { ...rough, quantity: 2 }, { ...rough, kind: "special" }, { ...gold, kind: "special" }, { ...rough, itemId: "raw" }]) {
    rejects((state) => { state.workers[0].fishing.outcome = outcome; }, JSON.stringify(outcome));
  }
});

test("active fishers require unique seats and a valid pool while paused shore clocks remain valid", () => {
  rejects((state) => { delete state.workers[0].fishing; }, "missing active clock");
  rejects((state) => { state.workers[0].fishing.seat = "back"; }, "duplicate seat");
  rejects((state) => { state.workers.push({ ...structuredClone(state.workers[0]), id: "fourth-fisher" }); }, "fourth fisher");
  rejects((state) => { state.workers[0].zoneId = "gather"; }, "fishing outside a pond");
  rejects((state) => { state.workers[0].status = "unknown"; }, "malformed active status");
  rejects((state) => { state.workers[0].x = "600"; }, "malformed active position");
  const state = fishingSave();
  state.workers[0].zoneId = null;
  state.workers[0].status = "idle";
  assert.deepEqual(parseGameSave(exportGameSave(state)).state.workers[0].fishing, state.workers[0].fishing, "leaving the pond retains this round without granting loot");
  rejects((state) => { state.workers[0].zoneId = null; state.workers[0].status = "idle"; state.workers[0].fishing.elapsed = -1; }, "malformed shore clock");
});

test("recent history rejects overlong records, invalid timestamps, duplicate ids and mismatched rewards", () => {
  for (const value of [-1, null, "100", NaN, Infinity]) rejects((state) => { state.fishingPlots["fishing-1"].history[0].caughtAt = value; }, `time: ${value}`);
  for (const value of [-1, 0, .5, null, "1"]) rejects((state) => { state.fishingPlots["fishing-1"].history[0].id = value; }, `id: ${value}`);
  for (const value of [0, 3, .5, null, "4"]) rejects((state) => { state.fishingPlots["fishing-1"].nextCatchId = value; }, `next id: ${value}`);
  rejects((state) => { state.fishingPlots["fishing-1"].history[1].id = 1; }, "duplicate ids");
  rejects((state) => { state.fishingPlots["fishing-1"].history.reverse(); }, "unordered ids");
  rejects((state) => { state.fishingPlots["fishing-1"].history[0].quantity = 1; }, "empty grants an item");
  rejects((state) => { state.fishingPlots["fishing-1"].history[2].kind = "special"; }, "gold in ordinary pool");
  rejects((state) => { state.fishingPlots["fishing-1"] = { history: Array.from({ length: 21 }, (_, index) => ({ ...empty, id: index + 1, caughtAt: index })), nextCatchId: 22 }; }, "more than 20 records");
  const state = fishingSave();
  state.fishingPlots["fishing-1"] = { history: Array.from({ length: 20 }, (_, index) => ({ ...empty, id: index + 81, caughtAt: index })), nextCatchId: 101 };
  assert.deepEqual(parseGameSave(exportGameSave(state)).state.fishingPlots, state.fishingPlots, "the latest twenty retain their original ids");
});
