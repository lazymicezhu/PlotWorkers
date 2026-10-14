import assert from "node:assert/strict";
import test from "node:test";
import {
  buyAutoCanSupply, buyAutoSchedulerSupply, buyCans, buyPlot, buyResearch,
  buyScheduler, buySchedulerBot, buyWorker, changeRecipe, changeSynthesisRecipe,
  createInitialState, parseSavedState, recyclePlot, sellProducts, stepGame,
  upgradeSchedulerEfficiency, upgradeSchedulerInterval,
} from "../app/game-engine.ts";
import { saveValuation } from "../app/save-valuation.ts";

const fresh = () => createInitialState(0, 0);
const itemValue = (game, id) => saveValuation(game).items.find((item) => item.id === id).value;
const synthesisPlot = () => ({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });

test("initial assets include free workers, plots and the initial robot", () => {
  const result = saveValuation(fresh());
  assert.equal(result.version, 2);
  assert.equal(result.total, 3940);
  assert.deepEqual(result.items.map(({ id, value }) => [id, value]), [
    ["coins", 100], ["inventory", 40], ["workers", 100], ["plots", 2700],
    ["robots", 1000], ["upgrades", 0], ["schedulerTime", 0],
  ]);
});

test("stock uses fixed base prices and sale at those prices conserves value", () => {
  const game = fresh();
  Object.assign(game.inventory, { raw: 75, cans: 20, rough: 2, refined: 3, screws: 4, rebar: 5 });
  assert.equal(itemValue(game, "inventory"), 530);
  assert.equal(saveValuation(sellProducts(game, "all")).total, saveValuation(game).total);
  assert.deepEqual(saveValuation({ ...game, market: { roughPrice: 8, refinedPrice: 36, elapsed: 40 } }), saveValuation(game));
});

test("processing reservation and recipe refund retain the same inventory value", () => {
  const game = fresh();
  game.inventory.raw = 76.5;
  game.workers[0].zoneId = "process";
  game.workers[0].status = "idle";
  const reserved = stepGame(game, 1, () => 1);
  assert.equal(reserved.processPlots.process.batch.reservedRaw, 75);
  assert.equal(saveValuation(reserved).total, saveValuation(game).total);
  assert.equal(saveValuation(changeRecipe(reserved, "process", "refined")).total, saveValuation(game).total);
});

test("synthesis reservation counts inputs once and never anticipates its output", () => {
  const game = fresh();
  game.plots.push(synthesisPlot());
  game.inventory.rough = 21;
  game.synthesisPlots.synthesis = { recipe: "screws", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
  game.workers[0].zoneId = "synthesis";
  game.workers[0].status = "idle";
  const reserved = stepGame(game, 1, () => 1);
  assert.equal(reserved.synthesisPlots.synthesis.batch.reserved.rough, 20);
  assert.equal(reserved.inventory.rough, 1);
  assert.equal(saveValuation(reserved).total, saveValuation(game).total);
  assert.equal(saveValuation(changeSynthesisRecipe(reserved, "synthesis", "rebar")).total, saveValuation(game).total);
  reserved.synthesisPlots.synthesis.batch.progress = .999;
  reserved.synthesisPlots.synthesis.produced = 99999;
  assert.equal(saveValuation(reserved).total, saveValuation(game).total);
});

test("purchases convert coins to current assets without creating valuation gains", () => {
  const game = fresh();
  game.coins = 1_000_000;
  const total = saveValuation(game).total;
  const purchases = [
    (state) => buyWorker(state, 0, 0, () => .5),
    (state) => buyPlot(state, synthesisPlot()),
    buySchedulerBot,
    buySchedulerBot,
    (state) => upgradeSchedulerEfficiency(state, 0),
    (state) => upgradeSchedulerInterval(state, 0),
    (state) => upgradeSchedulerEfficiency(state, 1),
    (state) => buyCans(state, 200),
    buyScheduler,
    buyAutoCanSupply,
    buyAutoSchedulerSupply,
    (state) => buyResearch(state, "synthesis"),
    (state) => buyResearch(state, "synthesis"),
    (state) => buyResearch(state, "orders"),
  ];
  let current = game;
  for (const purchase of purchases) {
    const next = purchase(current);
    assert.notEqual(next, current, "purchase must execute");
    assert.equal(saveValuation(next).total, total);
    current = next;
  }
});

test("robot upgrade levels are counted exactly despite decimal representation", () => {
  let game = fresh();
  game.coins = 10_000;
  const total = saveValuation(game).total;
  for (let index = 0; index < 29; index += 1) {
    game = upgradeSchedulerInterval(game, 0);
    game = upgradeSchedulerEfficiency(game, 0);
    assert.equal(saveValuation(game).total, total);
  }
  assert.equal(game.schedulerRobots[0].intervalSeconds, .1);
  assert.equal(game.schedulerRobots[0].efficiency, 1.5);
  assert.equal(itemValue(game, "robots"), 6400);
});

test("robot efficiency replacement value uses two-point upgrades and stops at the cap", () => {
  const game = fresh();
  game.schedulerRobots[0].efficiency = 1.17;
  assert.equal(itemValue(game, "robots"), 1900);
  game.schedulerRobots[0].efficiency = 1.5;
  assert.equal(itemValue(game, "robots"), 3500);
  game.schedulerRobots[0].efficiency = 5;
  assert.equal(itemValue(game, "robots"), 3500);
});

test("workers use cumulative current replacement cost across price tiers", () => {
  const game = fresh();
  game.workers = Array.from({ length: 51 }, (_, index) => ({ ...game.workers[0], id: `worker-${index}` }));
  assert.equal(itemValue(game, "workers"), 25 * 100 + 25 * 120 + 140);
});

test("recycling removes the actual plot value and counts its refund only once", () => {
  let game = fresh();
  game.coins = 1000;
  game = buyPlot(game, { ...synthesisPlot(), id: "process-2", type: "process" });
  game.inventory.raw = 2;
  game.processPlots["process-2"].batch = { active: true, progress: .5, reservedRaw: 75 };
  const total = saveValuation(game).total;
  const recycled = recyclePlot(game, "process-2");
  assert.equal(recycled.inventory.raw, 77);
  assert.equal(saveValuation(recycled).total, total - 90);
});

test("orders, special items, temporary effects and old production counters have no priced value", () => {
  const game = fresh();
  const expected = saveValuation(game);
  game.inventory.specials = { canOpener: 20, smartLeader: 30, holyLight: 40 };
  game.effects = { canOpener: 500, smartLeader: 600, holyLight: [{ id: "holy-light", x: 0, y: 0, remaining: 120 }] };
  game.orders = [{ id: "pending", remaining: 100, processed: { kind: "rough", amount: 1000 }, synthesized: { kind: "rebar", amount: 500 }, reward: "special" }];
  game.processPlots.process.produced = 100000;
  assert.deepEqual(saveValuation(game), expected);
  assert.match(expected.note, /特殊物品暂未折价/);
});

test("fractional holdings are retained through the sum and integer rows match the total", () => {
  const game = fresh();
  game.coins = 100.7;
  game.inventory.raw = 3;
  game.schedulerSeconds = .36;
  const result = saveValuation(game);
  assert.equal(result.total, 3941);
  assert.equal(result.items.reduce((sum, item) => sum + item.value, 0), result.total);
  assert.ok(result.items.every((item) => Number.isInteger(item.value) && item.value >= 0));
});

test("save serialization and reload preserve valuation without changing state", () => {
  const game = fresh();
  game.inventory.raw = 39.4;
  game.inventory.refined = 23;
  game.schedulerSeconds = 121.4;
  game.schedulerRobots[0].efficiency = 1.17;
  game.research.orders = 2;
  game.processPlots.process.batch = { active: true, progress: .4, reservedRaw: 75 };
  const before = JSON.stringify(game);
  const expected = saveValuation(game);
  assert.equal(JSON.stringify(game), before);
  assert.deepEqual(saveValuation(parseSavedState(before)), expected);
});

test("extreme external numbers cannot produce unsafe or nonfinite valuations", () => {
  const game = fresh();
  game.coins = 1e308;
  game.inventory.rebar = 1e308;
  game.schedulerSeconds = Infinity;
  game.schedulerRobots[0].efficiency = Infinity;
  const result = saveValuation(game);
  assert.equal(result.total, Number.MAX_SAFE_INTEGER);
  assert.equal(result.items.reduce((sum, item) => sum + item.value, 0), result.total);
  assert.ok(result.items.every((item) => Number.isSafeInteger(item.value) && item.value >= 0));
});
