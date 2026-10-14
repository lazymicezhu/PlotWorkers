import assert from "node:assert/strict";
import test from "node:test";
import { buyPlot, buyResearch, chooseAutoDispatch, createInitialState, createInitialWorker, nextPlotPrice, parseSavedState, plotCapacity, stepGame } from "../app/game-engine.ts";
import { createFishingProgress, fishingImageLayout, fishingOutcomeAt, fishingPhase, fishingSeatPoint, FISHING_SEATS, isValidFishingPlotState, isValidFishingProgress, LOOT_ITEMS, pointInFishingPlot, rollFishingOutcome } from "../app/fishing.ts";
import { resolveWorkerDrop } from "../app/worker-drag.ts";

const pond = { id: "fishing-1", name: "摸鱼池", type: "fishing", x: -600, y: 800, cols: 4, rows: 4, purchasePrice: 0, enabled: true };
function fresh(count = 0) {
  let game = buyPlot(buyResearch(createInitialState(0, 0), "fishing"), pond);
  game.workers = Array.from({ length: count }, (_, index) => ({
    ...createInitialWorker(0, 0), id: `fisher-${index}`, zoneId: pond.id, status: "fishing", mood: 0,
    ...fishingSeatPoint(pond, FISHING_SEATS[index]),
    fishing: createFishingProgress(FISHING_SEATS[index], () => .1 + index * .1),
  }));
  return game;
}
function advance(game, seconds, onChange) {
  for (let index = 0; index < seconds; index++) game = stepGame(game, 1, () => .5, onChange, 1_000_000 + index * 1000);
  return game;
}
function seedFor(itemId) {
  for (let seed = 0; seed < 10000; seed++) if (fishingOutcomeAt(seed, 0).itemId === itemId) return seed;
  throw new Error(`No seed for ${itemId}`);
}
function outcomeWorker(worker, itemId, elapsed = 59) {
  const seed = seedFor(itemId);
  return { ...worker, fishing: { ...worker.fishing, elapsed, seed, cycle: 0, outcome: fishingOutcomeAt(seed, 0) } };
}

test("one free 4x4 pond requires research, records no asset cost, and cannot be purchased twice", () => {
  const original = createInitialState(0, 0);
  assert.equal(buyPlot(original, pond), original);
  const unlocked = buyResearch(original, "fishing");
  assert.equal(unlocked.coins, original.coins);
  assert.equal(unlocked.researchInvestment, original.researchInvestment);
  assert.equal(nextPlotPrice(unlocked, "fishing", 4), 0);
  assert.equal(buyPlot(unlocked, { ...pond, cols: 8, rows: 8 }), unlocked);
  const placed = buyPlot(unlocked, pond);
  assert.equal(placed.coins, original.coins);
  assert.equal(placed.plots.at(-1).purchasePrice, 0);
  assert.deepEqual(placed.fishingPlots[pond.id], { history: [], nextCatchId: 1 });
  assert.equal(buyPlot(placed, { ...pond, id: "another" }), placed);
  assert.equal(plotCapacity(pond), 3);
});

test("dropping anywhere in the pond snaps to the nearest free seat and a full pond keeps the origin", () => {
  let game = fresh();
  const center = { x: pond.x + 208, y: pond.y + 108 };
  for (let index = 0; index < 4; index++) {
    const origin = { ...createInitialWorker(0, 0), id: `drop-${index}`, mood: 0 };
    const result = resolveWorkerDrop({ ...origin, status: "dragging" }, origin, center, true, game.plots, game.workers, []);
    assert.equal(result.accepted, index < 3);
    if (result.accepted) {
      assert.equal(result.worker.status, "fishing");
      assert.equal(result.worker.mood, 0);
      assert.deepEqual({ x: result.worker.x, y: result.worker.y }, { x: fishingSeatPoint(pond, result.worker.fishing.seat).x, y: fishingSeatPoint(pond, result.worker.fishing.seat).y });
      game.workers.push(result.worker);
      assert.equal(new Set(game.workers.map((worker) => worker.fishing.seat)).size, index + 1);
    } else assert.equal(result.worker.zoneId, origin.zoneId);
  }
  const seated = game.workers[0];
  const dropped = resolveWorkerDrop({ ...seated, status: "dragging" }, seated, center, true, game.plots, game.workers, []);
  assert.equal(dropped.accepted, true, "own seat remains available in a full pond");
  assert.equal(dropped.worker.fishing.seat, seated.fishing.seat);
  assert.deepEqual(dropped.worker.fishing.outcome, seated.fishing.outcome);
});

test("the sidewall is a valid drop target and seat anchors project through ordinary plot movement", () => {
  assert.equal(pointInFishingPlot(pond, { x: pond.x + 208, y: pond.y + 240 }), true);
  assert.equal(pointInFishingPlot(pond, { x: pond.x + 208, y: pond.y + 260 }), false);
  assert.equal(pointInFishingPlot(pond, { x: pond.x - 10, y: pond.y + 108 }), false);
  const image = fishingImageLayout(pond);
  assert.ok(image.width > 416 && image.height > 216);
  for (const seat of FISHING_SEATS) {
    const point = fishingSeatPoint(pond, seat);
    assert.ok(Math.abs(pond.x + (point.u - point.v) * 52 + 208 - point.x) < 1e-9);
    assert.ok(Math.abs(pond.y + (point.u + point.v) * 27 - point.y) < 1e-9);
  }
});

test("zero to three occupied seats run independently; empty ponds never grant loot", () => {
  for (let count = 0; count <= 3; count++) {
    const game = fresh(count), before = structuredClone(game);
    const next = advance(game, 60);
    assert.deepEqual(game, before, "simulation never mutates the prior snapshot");
    assert.equal(next.fishingPlots[pond.id].history.length, count);
    for (const worker of next.workers) {
      assert.equal(worker.fishing.cycle, 1);
      assert.equal(worker.fishing.elapsed, 0);
      assert.equal(worker.mood, 0);
      assert.equal(worker.status, "fishing");
    }
    assert.equal(next.inventory.cans, game.inventory.cans + next.fishingPlots[pond.id].history.filter((entry) => entry.itemId === "cans").length);
  }
});

test("lazy speed alone halves the round; mood, leaders, stats, holy light and production research do not change fishing", () => {
  const base = fresh(3);
  base.workers[0].personality = "lazy";
  base.workers[1].personality = "leader";
  base.workers[2].role = "foreman";
  base.workers[2].mood = 17;
  base.effects.holyLight = [{ id: "light", x: pond.x + 208, y: pond.y + 108, remaining: 60 }];
  base.effects.smartLeader = 60;
  base.research.gather = base.research.process = base.research.synthesis = 5;
  for (const worker of base.workers) { worker.efficiency = 10; worker.slowStacks = 100; }
  const halfway = advance(base, 30);
  assert.deepEqual(halfway.workers.map((worker) => worker.fishing.cycle), [1, 0, 0]);
  assert.deepEqual(halfway.workers.map((worker) => worker.fishing.elapsed), [0, 30, 30]);
  assert.deepEqual(halfway.workers.map((worker) => worker.mood), [0, 0, 17]);
  assert.equal(halfway.fishingPlots[pond.id].history.length, 1);
  const full = advance(halfway, 30);
  assert.deepEqual(full.workers.map((worker) => worker.fishing.cycle), [2, 1, 1]);
  assert.equal(full.fishingPlots[pond.id].history.length, 4);
});

test("dragging and disabled plots freeze progress; leaving and reseating preserve the pending outcome", () => {
  const game = fresh(2);
  game.workers[0] = outcomeWorker(game.workers[0], "goldenOrder", 54);
  game.workers[0].status = "dragging";
  const next = advance(game, 5);
  assert.deepEqual(next.workers[0].fishing, game.workers[0].fishing);
  assert.equal(next.workers[1].fishing.elapsed, 5);
  const living = next.plots.find((plot) => plot.type === "living");
  const point = { x: living.x + 208, y: living.y + 108 };
  const exited = resolveWorkerDrop(next.workers[0], game.workers[0], point, true, next.plots, next.workers, []).worker;
  assert.equal(exited.zoneId, living.id);
  assert.deepEqual(exited.fishing, game.workers[0].fishing);
  const restored = resolveWorkerDrop({ ...exited, status: "dragging" }, exited, fishingSeatPoint(pond, "right"), true, next.plots, [exited, next.workers[1]], []).worker;
  assert.equal(restored.fishing.seat, "right");
  assert.equal(restored.fishing.elapsed, 54);
  assert.equal(restored.fishing.outcome.itemId, "goldenOrder");
  next.workers[0] = restored;
  next.plots = next.plots.map((plot) => plot.id === pond.id ? { ...plot, enabled: false } : plot);
  const disabled = advance(next, 10);
  assert.deepEqual(disabled.workers[0].fishing, restored.fishing);
  assert.equal(disabled.workers[0].mood, restored.mood);
});

test("loot thresholds allocate 47% equal products, 50% empty, 2% ordinary special and 1% gold", () => {
  const counts = Object.fromEntries([...LOOT_ITEMS.map((item) => item.id), "empty"].map((id) => [id, 0]));
  for (let index = 0; index < 100_000; index++) {
    const outcome = rollFishingOutcome((index + .5) / 100_000);
    counts[outcome.itemId ?? "empty"]++;
  }
  assert.deepEqual(counts, { rough: 9400, refined: 9400, screws: 9400, rebar: 9400, cans: 9400, canOpener: 500, smartLeader: 500, holyLight: 500, orderRefresh: 500, goldenOrder: 1000, empty: 50000 });
  assert.equal(rollFishingOutcome(.47).kind, "empty");
  assert.equal(rollFishingOutcome(.97).itemId, "canOpener");
  assert.equal(rollFishingOutcome(.99).itemId, "goldenOrder");
  for (const value of [-1, 1, Infinity, NaN]) assert.throws(() => rollFishingOutcome(value));
});

test("each possible catch settles once into actual stock and products report resource activity", () => {
  for (const item of [...LOOT_ITEMS, { id: null, kind: "empty" }]) {
    const game = fresh(1);
    game.workers[0] = outcomeWorker(game.workers[0], item.id);
    const changes = [];
    const next = stepGame(game, 1, () => .5, (kind, delta) => changes.push([kind, delta]), 80_000);
    const record = next.fishingPlots[pond.id].history[0];
    assert.equal(record.itemId, item.id);
    assert.equal(record.caughtAt, 80_000);
    assert.equal(record.quantity, item.id ? 1 : 0);
    if (item.kind === "product") {
      assert.equal(next.inventory[item.id], game.inventory[item.id] + 1);
      assert.deepEqual(changes, [[item.id, 1]]);
    } else {
      assert.deepEqual(changes, []);
      if (item.id) assert.equal(next.inventory.specials[item.id], game.inventory.specials[item.id] + 1);
      else assert.deepEqual(next.inventory, game.inventory);
    }
    const later = stepGame(next, 1, () => .5);
    assert.equal(later.fishingPlots[pond.id].history.length, 1);
    assert.deepEqual(later.inventory, next.inventory);
  }
});

test("empty hooks run a full round and animation phases use the same logical clock", () => {
  const game = fresh(1);
  game.workers[0] = outcomeWorker(game.workers[0], null, 0);
  const before = advance(game, 59);
  assert.equal(before.fishingPlots[pond.id].history.length, 0);
  assert.equal(fishingPhase(before.workers[0].fishing.elapsed).phase, "recover");
  const completed = stepGame(before, 1);
  assert.equal(completed.fishingPlots[pond.id].history.length, 1);
  assert.equal(completed.fishingPlots[pond.id].history[0].kind, "empty");
  assert.equal(fishingPhase(completed.workers[0].fishing.elapsed).phase, "cast");
});

test("history retains only the newest 20 outcomes with ordered ids and completion timestamps", () => {
  const game = fresh(3);
  game.workers[0].personality = "lazy";
  const next = advance(game, 600);
  const log = next.fishingPlots[pond.id];
  assert.equal(log.nextCatchId, 41);
  assert.equal(log.history.length, 20);
  assert.deepEqual(log.history.map((entry) => entry.id), Array.from({ length: 20 }, (_, i) => i + 21));
  assert.ok(log.history.every((entry, index) => !index || entry.caughtAt >= log.history[index - 1].caughtAt));
  assert.ok(isValidFishingPlotState(log));
});

test("robot work and rest scheduling neither fills the pond nor moves any seated worker", () => {
  const game = fresh(1);
  game.plots = game.plots.filter((plot) => plot.type === "living" || plot.type === "fishing");
  const ready = { ...createInitialWorker(0, 0), id: "ready" };
  game.workers.push(ready);
  for (const status of ["fishing", "exhausted", "ready", "slacking", "idle"]) {
    game.workers[0].status = status;
    assert.equal(chooseAutoDispatch(game), null);
  }
  game.plots.find((plot) => plot.id === pond.id).enabled = false;
  assert.equal(chooseAutoDispatch(game), null, "disabled ponds still require manual removal");
});

test("old saves migrate to v11 without granting a pond and valid saved rounds never reroll", () => {
  const old = createInitialState(0, 0);
  old.version = 10;
  delete old.fishingPlots; delete old.research.fishing; delete old.plotPurchases.fishing;
  const migrated = parseSavedState(JSON.stringify(old));
  assert.equal(migrated.version, 11);
  assert.equal(migrated.research.fishing, 0);
  assert.equal(migrated.plotPurchases.fishing, 0);
  assert.deepEqual(migrated.fishingPlots, {});
  const game = fresh(3);
  game.workers[0] = outcomeWorker(game.workers[0], "goldenOrder", 57.5);
  game.workers[0].status = "dragging";
  const loaded = parseSavedState(JSON.stringify(game));
  assert.deepEqual(loaded.workers[0].fishing, game.workers[0].fishing);
  assert.equal(loaded.workers[0].status, "fishing");
  assert.equal(loaded.workers[0].mood, 0);
  assert.equal(loaded.plots.find((plot) => plot.type === "fishing").purchasePrice, 0);
  const result = advance(loaded, 3);
  assert.equal(result.inventory.specials.goldenOrder, 1);
});

test("invalid fishing clocks, loot, histories and overlapping seats are rejected on load", () => {
  const original = fresh(2);
  for (const change of [
    (game) => { delete game.fishingPlots; },
    (game) => { game.research.fishing = 0; },
    (game) => { game.fishingPlots.orphan = { history: [], nextCatchId: 1 }; },
    (game) => { game.workers[0].fishing.elapsed = 60; },
    (game) => { game.workers[0].fishing.seed = -1; },
    (game) => { game.workers[0].fishing.outcome = { itemId: "goldenOrder", kind: "special", quantity: 1 }; },
    (game) => { game.workers[0].fishing.outcome = { itemId: "goldenOrder", kind: "gold", quantity: 1 }; },
    (game) => { game.workers[0].fishing.seat = game.workers[1].fishing.seat; },
    (game) => { delete game.workers[0].fishing; },
    (game) => { game.fishingPlots[pond.id].nextCatchId = 0; },
    (game) => { game.fishingPlots[pond.id] = { nextCatchId: 2, history: [{ id: 1, itemId: null, kind: "empty", quantity: 0, caughtAt: 1e20 }] }; },
    (game) => { game.plots.push({ ...pond, id: "second" }); },
  ]) {
    const game = structuredClone(original); change(game);
    assert.equal(parseSavedState(JSON.stringify(game)), null);
  }
  assert.ok(isValidFishingProgress(original.workers[0].fishing));
});
