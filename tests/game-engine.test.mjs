import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRebirth,
  buyCanOpener,
  buyScheduler,
  buySchedulerBot,
  buyWorker,
  buyPlot,
  buyRebirthPotion,
  changeRecipe,
  chooseAutoDispatch,
  createInitialState,
  gatherAttributeRate,
  randomMarketPrice,
  plotPurchasePrice,
  recyclePlot,
  recoveryRate,
  staminaDrainRate,
  stepGame,
  toggleSchedulerDuty,
  upgradeSchedulerEfficiency,
  upgradeSchedulerInterval,
} from "../app/game-engine.ts";

const state = () => createInitialState(0, 0);

test("attribute formulas match values 1, 5 and 10", () => {
  assert.deepEqual([staminaDrainRate(1), staminaDrainRate(5), staminaDrainRate(10)], [1.4, 1, .5]);
  assert.deepEqual([gatherAttributeRate(1), gatherAttributeRate(5), gatherAttributeRate(10)], [.6, 1, 1.5]);
  assert.deepEqual([recoveryRate(1), recoveryRate(5), recoveryRate(10)], [1.2, 2, 3]);
});

test("gathering produces raw material and drains mood", () => {
  const game = state();
  game.workers[0].zoneId = "gather";
  game.workers[0].status = "idle";
  const next = stepGame(game, 1, () => 1);
  assert.equal(next.inventory.raw, 10);
  assert.equal(next.workers[0].mood, 99);
  assert.equal(next.workers[0].status, "gathering");
});

test("leader bonuses stack linearly in one work zone", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "leader-1", personality: "leader", zoneId: "gather", status: "idle" },
    { ...base, id: "leader-2", personality: "leader", zoneId: "gather", status: "idle" },
    { ...base, id: "worker", personality: "slowBurn", zoneId: "gather", status: "idle" },
  ];
  const next = stepGame(game, 1, () => 1);
  assert.equal(next.inventory.raw, 32);
});

test("leader bonuses do not leak into another plot of the same type", () => {
  const game = state();
  game.plots.push({ id: "gather-2", type: "gather", name: "采集区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 });
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "leader", personality: "leader", zoneId: "gather", status: "idle" },
    { ...base, id: "worker", personality: "slowBurn", zoneId: "gather-2", status: "idle" },
  ];
  assert.equal(stepGame(game, 1, () => 1).inventory.raw, 19);
});

test("living area consumes cans only for actual recovery", () => {
  const game = state();
  game.workers[0].mood = 99;
  game.workers[0].status = "resting";
  const next = stepGame(game, 1);
  assert.equal(next.workers[0].mood, 100);
  assert.equal(next.inventory.cans, 19.995);
  assert.equal(next.workers[0].status, "ready");
});

test("processing reserves raw and advances the current plot batch", () => {
  const game = state();
  game.inventory.raw = 75;
  game.workers[0].zoneId = "process";
  game.workers[0].status = "idle";
  const next = stepGame(game, 1, () => 1);
  assert.equal(next.inventory.raw, 0);
  assert.equal(next.processPlots.process.batch.reservedRaw, 75);
  assert.equal(next.processPlots.process.batch.progress, .1);
  assert.equal(next.workers[0].status, "processing");
});

test("recipe changes refund the reserved batch", () => {
  const game = state();
  game.inventory.raw = 5;
  game.processPlots.process.batch = { active: true, progress: .5, reservedRaw: 75 };
  game.processPlots.process.produced = 7;
  const next = changeRecipe(game, "process", "refined");
  assert.equal(next.inventory.raw, 80);
  assert.deepEqual(next.processPlots.process.batch, { active: false, progress: 0, reservedRaw: 0 });
  assert.equal(next.processPlots.process.produced, 0);
});

test("completed products increment the current recipe counter", () => {
  let game = state();
  game.inventory.raw = 75;
  game.workers[0].zoneId = "process";
  game.workers[0].status = "idle";
  for (let second = 0; second < 11; second += 1) game = stepGame(game, 1, () => 1);
  assert.equal(game.inventory.rough, 1);
  assert.equal(game.processPlots.process.produced, 1);
});

test("each processing plot keeps its own recipe and production count", () => {
  let game = state();
  game.coins = 1200;
  game = buyPlot(game, { id: "process-2", type: "process", name: "加工区", x: 0, y: 0, cols: 8, rows: 8, purchasePrice: 0 });
  game.processPlots.process.produced = 4;
  game.processPlots["process-2"].produced = 9;
  const next = changeRecipe(game, "process-2", "refined");
  assert.equal(next.processPlots.process.recipe, "rough");
  assert.equal(next.processPlots.process.produced, 4);
  assert.equal(next.processPlots["process-2"].recipe, "refined");
  assert.equal(next.processPlots["process-2"].produced, 0);
});

test("market prices always use the base price range", () => {
  assert.equal(randomMarketPrice(10, () => 0), 8);
  assert.equal(randomMarketPrice(10, () => 1), 12);
  assert.equal(randomMarketPrice(30, () => 0), 24);
  assert.equal(randomMarketPrice(30, () => 1), 36);
  assert.equal(randomMarketPrice(30, () => .975), 36);
});

test("damaged saves are rejected", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  assert.equal(parseSavedState("not json"), null);
  assert.equal(parseSavedState('{"version":2}'), null);
});

test("saved transient drag state is recovered safely", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  const game = state();
  game.workers[0].status = "dragging";
  game.market.refinedPrice = 35.7;
  game.plots.forEach((plot) => { plot.purchasePrice = 0; });
  const restored = parseSavedState(JSON.stringify(game));
  assert.equal(restored.workers[0].status, "ready");
  assert.equal(restored.workers[0].moving, false);
  assert.equal(restored.market.refinedPrice, 36);
  assert.deepEqual(restored.plots.map((plot) => plot.purchasePrice), [1200, 1200, 300]);
});

test("buying plots and rebirth potions uses the configured prices", () => {
  const game = state();
  game.coins = 500;
  const withPlot = buyPlot(game, { id: "new-zone", type: "living", name: "生活区", x: 300, y: 300, cols: 4, rows: 4, purchasePrice: 0 });
  assert.equal(withPlot.coins, 200);
  assert.equal(withPlot.plots.length, 4);
  const withPotion = buyRebirthPotion(withPlot);
  assert.equal(withPotion.coins, 0);
  assert.equal(withPotion.inventory.potions, 1);
  const reborn = applyRebirth(withPotion, "worker-1", { stamina: 10, efficiency: 1, spirit: 8 });
  assert.equal(reborn.inventory.potions, 0);
  assert.deepEqual(
    [reborn.workers[0].stamina, reborn.workers[0].efficiency, reborn.workers[0].spirit],
    [10, 1, 8],
  );
});

test("new workers respect living plot capacity and can use the next living plot", () => {
  const game = state();
  game.coins = 1000;
  const base = game.workers[0];
  game.workers.push(
    { ...base, id: "living-2" },
    { ...base, id: "living-3" },
    { ...base, id: "living-4" },
  );
  assert.equal(buyWorker(game, 0, 0), game);
  game.plots.push({ id: "living-extra", type: "living", name: "生活区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 });
  const bought = buyWorker(game, 100, 200, () => .5, { zoneId: "living-extra", u: 1.5, v: 2.5 });
  assert.equal(bought.coins, 900);
  assert.equal(bought.workers.at(-1).zoneId, "living-extra");
  assert.equal(bought.workers.at(-1).u, 1.5);
  assert.equal(bought.workers.at(-1).v, 2.5);
});

test("plot prices depend on size", () => {
  assert.equal(plotPurchasePrice(4), 300);
  assert.equal(plotPurchasePrice(8), 1200);
  const game = state();
  game.coins = 1200;
  const bought = buyPlot(game, { id: "large-zone", type: "gather", name: "采集区", x: 0, y: 0, cols: 8, rows: 8, purchasePrice: 0 });
  assert.equal(bought.coins, 0);
  assert.equal(bought.plots.length, 4);
});

test("scheduler purchase lasts 60 simulated seconds", () => {
  const game = state();
  const active = buyScheduler(game);
  assert.equal(active.coins, 0);
  assert.equal(active.schedulerSeconds, 60);
  assert.equal(stepGame(active, 1).schedulerSeconds, 59);
});

test("additional scheduler robots cost 1000 coins and persist", () => {
  const game = state();
  game.coins = 1000;
  const upgraded = buySchedulerBot(game);
  assert.equal(upgraded.coins, 0);
  assert.equal(upgraded.schedulerBots, 2);
  assert.equal(upgraded.schedulerRobots.length, 2);
  assert.equal(stepGame(upgraded, 1).schedulerBots, 2);
});

test("can opener boosts only living recovery by 50 percent and has a five minute cooldown", () => {
  const game = state();
  game.coins = 300;
  game.workers[0].mood = 90;
  const active = buyCanOpener(game);
  assert.equal(active.coins, 0);
  assert.equal(active.canOpenerSeconds, 60);
  assert.equal(active.canOpenerCooldown, 300);
  const recovered = stepGame(active, 1);
  assert.equal(recovered.workers[0].mood, 93);
  assert.equal(recovered.inventory.cans, 19.99);
  assert.equal(recovered.canOpenerSeconds, 59);
  assert.equal(recovered.canOpenerCooldown, 299);
  const cooling = { ...recovered, coins: 300 };
  assert.equal(buyCanOpener(cooling), cooling);
  const working = { ...active, workers: [{ ...active.workers[0], zoneId: "gather", status: "idle", mood: 100 }] };
  const worked = stepGame(working, 1, () => 1);
  assert.equal(worked.inventory.raw, 10);
  assert.equal(worked.workers[0].mood, 99);
});

test("each scheduler robot can upgrade speed and interval independently", () => {
  const efficiencyGame = state();
  efficiencyGame.coins = 100;
  const faster = upgradeSchedulerEfficiency(efficiencyGame, 0);
  assert.equal(faster.coins, 0);
  assert.equal(faster.schedulerRobots[0].efficiency, 1.01);
  const intervalGame = state();
  intervalGame.coins = 100;
  const shorter = upgradeSchedulerInterval(intervalGame, 0);
  assert.equal(shorter.coins, 0);
  assert.equal(shorter.schedulerRobots[0].intervalSeconds, 2.9);
});

test("full living area is freed before an exhausted worker is moved in", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "tired", zoneId: "gather", status: "exhausted", mood: 0 },
    { ...base, id: "rest-1", zoneId: "living", status: "ready", mood: 100 },
    { ...base, id: "rest-2", zoneId: "living", status: "resting", mood: 70 },
    { ...base, id: "rest-3", zoneId: "living", status: "resting", mood: 40 },
    { ...base, id: "rest-4", zoneId: "living", status: "resting", mood: 20 },
  ];
  const freeSpace = chooseAutoDispatch(game);
  assert.equal(freeSpace.workerId, "rest-1");
  assert.equal(freeSpace.targetId, "process");
  game.workers = game.workers.map((worker) => worker.id === "rest-1" ? { ...worker, zoneId: "process", status: "idle" } : worker);
  assert.deepEqual(chooseAutoDispatch(game), { workerId: "tired", targetId: "living", action: "rest" });
});

test("ready workers are distributed to the least occupied work plot", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "ready", zoneId: "living", status: "ready" },
    { ...base, id: "gather-worker", zoneId: "gather", status: "gathering" },
  ];
  assert.deepEqual(chooseAutoDispatch(game), { workerId: "ready", targetId: "process", action: "work" });
});

test("scheduler duties can be assigned per robot and wake slacking workers in place", () => {
  const game = state();
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "slacking", mood: 80 };
  const wakeOnly = { rest: false, work: false, wake: true };
  assert.deepEqual(chooseAutoDispatch(game, [], [], wakeOnly), { workerId: "worker-1", targetId: "gather", action: "wake" });
  const disabled = toggleSchedulerDuty(game, 0, "wake");
  assert.equal(disabled.schedulerRobots[0].duties.wake, false);
  assert.equal(chooseAutoDispatch(disabled, [], [], disabled.schedulerRobots[0].duties), null);
});

test("empty plots recycle for 70 percent while every zone type keeps one plot", () => {
  const game = state();
  game.coins = 300;
  const bought = buyPlot(game, { id: "recyclable", type: "living", name: "生活区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 0 });
  assert.equal(bought.coins, 0);
  const recycled = recyclePlot(bought, "recyclable");
  assert.equal(recycled.coins, 210);
  assert.equal(recycled.plots.some((plot) => plot.id === "recyclable"), false);
  assert.equal(recyclePlot(recycled, "living"), recycled);
  const withExtraGather = { ...recycled, plots: [...recycled.plots, { id: "gather-2", type: "gather", name: "采集区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 }] };
  const withoutInitialGather = recyclePlot(withExtraGather, "gather");
  assert.equal(withoutInitialGather.plots.some((plot) => plot.id === "gather"), false);
  assert.equal(withoutInitialGather.plots.some((plot) => plot.id === "gather-2"), true);
  assert.equal(withoutInitialGather.coins, 1050);
});

test("version one saves migrate plots, potions and movement state", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  const old = state();
  old.version = 1;
  delete old.plots;
  delete old.inventory.potions;
  delete old.workers[0].motion;
  delete old.schedulerBots;
  delete old.schedulerRobots;
  delete old.canOpenerSeconds;
  delete old.canOpenerCooldown;
  old.recipe = "refined";
  old.recipeProduced = 6;
  old.batch = { active: true, progress: .5, reservedRaw: 200 };
  delete old.processPlots;
  const migrated = parseSavedState(JSON.stringify(old));
  assert.equal(migrated.version, 3);
  assert.equal(migrated.plots.length, 3);
  assert.equal(migrated.inventory.potions, 0);
  assert.equal(migrated.workers[0].motion, "idle");
  assert.equal(migrated.schedulerBots, 1);
  assert.deepEqual(migrated.schedulerRobots, [{ efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }]);
  assert.equal(migrated.canOpenerSeconds, 0);
  assert.equal(migrated.canOpenerCooldown, 0);
  assert.deepEqual(migrated.processPlots.process, {
    recipe: "refined",
    produced: 6,
    batch: { active: true, progress: .5, reservedRaw: 200 },
  });
  assert.deepEqual(migrated.plots.map((plot) => plot.purchasePrice), [1200, 1200, 300]);
});
