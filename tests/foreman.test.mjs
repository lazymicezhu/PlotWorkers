import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAutoDispatch,
  createInitialState,
  createInitialWorker,
  guardedPlotIds,
  isForeman,
  parseSavedState,
  stepGame,
} from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";

const worker = (id, zoneId, extra = {}) => ({
  ...createInitialWorker(0, 0), id, zoneId, status: "idle", ...extra,
});
const foreman = (zoneId, extra = {}) => worker("foreman", zoneId, { role: "foreman", name: "包工头", ...extra });
const tick = (game) => stepGame(game, 1, () => .1);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

function factory() {
  const game = createInitialState(0, 0);
  game.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 3000, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
  game.inventory.raw = 1000;
  game.inventory.rough = 100;
  game.inventory.refined = 100;
  game.synthesisPlots.synthesis = { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
  game.workers = [];
  return game;
}

test("foreman is opt-in and doubles only his own gathering plot", () => {
  const game = factory();
  assert.equal(createInitialState(0, 0).workers.some(isForeman), false);
  game.plots.push({ ...game.plots[0], id: "gather-2", x: -3000 });
  game.workers = [foreman("gather"), worker("coworker", "gather"), worker("other", "gather-2")];
  const next = tick(game);
  assert.equal(next.inventory.raw - game.inventory.raw, 50);
  assert.equal(next.workers[0].mood, 100);
  assert.equal(next.workers[1].mood, 99);
  assert.equal(next.workers[2].mood, 99);
});

for (const type of ["process", "synthesis"]) {
  test(`foreman doubles ${type} speed without changing batch inputs or output`, () => {
    const baseline = factory();
    baseline.workers = [worker("one", type), worker("two", type)];
    const guarded = structuredClone(baseline);
    guarded.workers[0] = foreman(type);
    const normal = tick(baseline);
    const boosted = tick(guarded);
    const key = type === "process" ? "processPlots" : "synthesisPlots";
    close(boosted[key][type].batch.progress, normal[key][type].batch.progress * 2);
    assert.deepEqual(boosted.inventory, normal.inventory);
    assert.equal(boosted.workers[0].mood, 100);
    assert.equal(boosted.workers[1].mood, 99);

    // Complete one batch in both factories; only its completion time changes.
    normal[key][type].batch.progress = .99;
    boosted[key][type].batch.progress = .99;
    const normalFinished = tick(normal);
    const boostedFinished = tick(boosted);
    assert.deepEqual(boostedFinished.inventory, normalFinished.inventory);
    assert.equal(boostedFinished[key][type].produced, normalFinished[key][type].produced);
  });
}

for (const type of ["gather", "process", "synthesis"]) {
  test(`foreman and holy light add to triple ${type} speed`, () => {
    const game = factory();
    game.workers = [foreman(type)];
    const plot = game.plots.find((item) => item.id === type);
    game.effects.holyLight = [{ id: "holy-light", x: plot.x + plot.rows * 52, y: plot.y + plot.rows * 27, remaining: 60 }];
    const next = tick(game);
    if (type === "gather") assert.equal(next.inventory.raw - game.inventory.raw, 30);
    else close(next[type === "process" ? "processPlots" : "synthesisPlots"][type].batch.progress, 3 / (type === "process" ? 10 : 60));
  });
}

test("moving or lifting the foreman transfers or removes the plot bonus immediately", () => {
  const game = factory();
  game.workers = [foreman("gather"), worker("gatherer", "gather"), worker("processor", "process")];
  game.processPlots.process.batch = { active: true, progress: 0, reservedRaw: 75 };
  const gathering = tick(game);
  assert.equal(gathering.inventory.raw - game.inventory.raw, 40);
  close(gathering.processPlots.process.batch.progress, .1);

  game.workers[0].zoneId = "process";
  const processing = tick(game);
  assert.equal(processing.inventory.raw - game.inventory.raw, 10);
  close(processing.processPlots.process.batch.progress, .4);
  assert.deepEqual([...guardedPlotIds(game.workers)], ["process"]);

  game.workers[0].status = "dragging";
  const dragging = tick(game);
  close(dragging.processPlots.process.batch.progress, .1);
  assert.equal(dragging.workers[0].status, "dragging");
  assert.equal(guardedPlotIds(game.workers).size, 0);

  game.workers[0].status = "idle";
  game.workers[0].zoneId = null;
  close(tick(game).processPlots.process.batch.progress, .1);
  assert.equal(guardedPlotIds(game.workers).size, 0);
});

test("paused plots neither produce nor recover while guarded", () => {
  for (const type of ["gather", "process", "synthesis", "living"]) {
    const game = factory();
    game.workers = [foreman(type), worker("other", type, { mood: 50 })];
    game.plots.find((plot) => plot.id === type).enabled = false;
    const next = tick(game);
    assert.deepEqual(next.inventory, game.inventory);
    assert.deepEqual(next.processPlots, game.processPlots);
    assert.deepEqual(next.synthesisPlots, game.synthesisPlots);
    assert.equal(next.workers[1].mood, 50);
    assert.equal(next.workers[0].status, "idle");
  }
});

test("foreman doubles local recovery, consumes no cans himself, and stops at full mood", () => {
  const game = factory();
  game.plots.push({ ...game.plots.find((plot) => plot.id === "living"), id: "living-2" });
  game.workers = [foreman("living"), worker("resting", "living", { mood: 50 }), worker("other", "living-2", { mood: 50 })];
  const next = tick(game);
  assert.deepEqual(next.workers.map((item) => item.mood), [100, 54, 52]);
  close(game.inventory.cans - next.inventory.cans, .02);

  game.workers = [foreman("living"), worker("nearly-rested", "living", { mood: 99 })];
  const rested = tick(game);
  assert.equal(rested.workers[1].mood, 100);
  close(game.inventory.cans - rested.inventory.cans, .0025);
});

test("foreman stays productive without personality skills, slacking, or mood loss", () => {
  for (const personality of ["slowBurn", "leader", "lazy"]) {
    let game = factory();
    game.workers = [foreman("gather", { personality, status: "slacking", continuousWork: 400, slowStacks: 40, lazyElapsed: 19, lazyCheckInterval: 20 })];
    const initialRaw = game.inventory.raw;
    for (let i = 0; i < 120; i++) game = tick(game);
    assert.equal(game.inventory.raw - initialRaw, 2400);
    assert.equal(game.workers[0].mood, 100);
    assert.equal(game.workers[0].status, "gathering");
    assert.equal(game.workers[0].slowStacks, 0);
    assert.equal(game.workers[0].lazyCheckInterval, undefined);
  }
});

test("a foreman's placeholder leader personality grants no extra coworker skill", () => {
  const game = factory();
  game.workers = [foreman("gather", { personality: "leader" }), worker("other", "gather")];
  assert.equal(tick(game).inventory.raw - game.inventory.raw, 40);
});

test("robots never move or wake foremen, including when living plots are full", () => {
  for (const [zoneId, status, mood] of [["living", "ready", 100], ["gather", "exhausted", 0], ["gather", "slacking", 100]]) {
    const game = factory();
    game.workers = [foreman(zoneId, { status, mood })];
    assert.equal(chooseAutoDispatch(game), null);
  }
  const game = factory();
  game.workers = [foreman("living"), ...Array.from({ length: 3 }, (_, i) => worker(`rest-${i}`, "living", { mood: 0, status: "resting" })), worker("tired", "gather", { mood: 0, status: "exhausted" })];
  assert.equal(chooseAutoDispatch(game), null);
});

test("foreman occupies one ordinary work slot in robot capacity decisions", () => {
  const game = factory();
  const gather = game.plots.find((plot) => plot.id === "gather");
  gather.cols = gather.rows = 4;
  for (const plot of game.plots) if (plot.type === "process" || plot.type === "synthesis") plot.enabled = false;
  game.workers = [foreman("gather"), ...Array.from({ length: 3 }, (_, i) => worker(`worker-${i}`, "gather")), worker("ready", "living", { status: "ready" })];
  assert.equal(chooseAutoDispatch(game), null);
  game.workers[0].zoneId = null;
  assert.deepEqual(chooseAutoDispatch(game), { workerId: "ready", targetId: "gather", action: "work" });
});

test("save loading preserves foreman role and restores temporary dragging", () => {
  const game = factory();
  game.rebirthCount = 1;
  game.workers = [foreman("gather", { status: "dragging" }), worker("other", "gather")];
  for (const loaded of [parseSavedState(JSON.stringify(game)), parseGameSave(exportGameSave(game)).state]) {
    assert.equal(isForeman(loaded.workers[0]), true);
    assert.equal(loaded.workers[0].status, "idle");
    assert.equal(isForeman(loaded.workers[1]), false);
    assert.equal(tick(loaded).inventory.raw - loaded.inventory.raw, 40);
  }
  game.workers[0].role = "unknown";
  assert.equal(parseSavedState(JSON.stringify(game)), null);
  assert.throws(() => parseGameSave(JSON.stringify(game)));
});
