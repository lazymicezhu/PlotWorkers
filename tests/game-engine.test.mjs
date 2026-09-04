import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECIAL_DROP_CHANCE,
  SYNTHESIS_RECIPES,
  buyAutoCanSupply,
  buyAutoSchedulerSupply,
  buyResearch,
  buyScheduler,
  buySchedulerBot,
  buyWorker,
  buyPlot,
  changeRecipe,
  changeSynthesisRecipe,
  circleHitsPlot,
  chooseAutoDispatch,
  createInitialState,
  gatherAttributeRate,
  nextPlotPrice,
  orderCoinReward,
  placeHolyLight,
  randomMarketPrice,
  plotPurchasePrice,
  recyclePlot,
  recoveryRate,
  schedulerBotPrice,
  staminaDrainRate,
  stepGame,
  submitOrder,
  togglePlotEnabled,
  toggleSchedulerDuty,
  upgradeSchedulerEfficiency,
  upgradeSchedulerInterval,
  useSpecialItem,
  workerPurchasePrice,
} from "../app/game-engine.ts";
import { simulateElapsed } from "../app/simulation-protocol.ts";
import { SCENE_DRAG_Z, sceneDepth } from "../app/scene-depth.ts";

const state = () => createInitialState(0, 0);

test("new games start with one robot but locked robot management", () => {
  const game = state();
  assert.equal(game.schedulerBots, 1);
  assert.equal(game.schedulerRobots.length, 1);
  assert.equal(game.schedulerServiceUnlocked, false);
});

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

test("background simulation advances elapsed time in fixed steps", () => {
  const game = state();
  game.workers[0].zoneId = "gather";
  game.workers[0].status = "idle";
  const next = simulateElapsed(game, 2.5, () => 1);
  assert.equal(next.inventory.raw, 25);
  assert.equal(next.workers[0].mood, 97.5);
});

test("scene depth keeps workers above plots at negative world coordinates", () => {
  assert.ok(sceneDepth(-1500) > 100);
  assert.ok(sceneDepth(-1200) > sceneDepth(-1500));
  assert.ok(SCENE_DRAG_Z > sceneDepth(500000));
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

test("automatic can supply unlocks once and buys 200 paid cans below 200", () => {
  const game = state();
  game.coins = 5500;
  const unlocked = buyAutoCanSupply(game);
  assert.equal(unlocked.coins, 500);
  assert.equal(unlocked.autoCanSupply, true);
  assert.equal(buyAutoCanSupply(unlocked), unlocked);
  unlocked.inventory.cans = 199;
  const refilled = stepGame(unlocked, 1, () => 1);
  assert.equal(refilled.inventory.cans, 399);
  assert.equal(refilled.coins, 100);
  const poor = { ...refilled, coins: 399, inventory: { ...refilled.inventory, cans: 100 } };
  const unchanged = stepGame(poor, 1, () => 1);
  assert.equal(unchanged.inventory.cans, 100);
  assert.equal(unchanged.coins, 399);
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
  assert.equal("moving" in restored.workers[0], false);
  assert.equal("motion" in restored.workers[0], false);
  assert.equal(restored.market.refinedPrice, 36);
  assert.deepEqual(restored.plots.map((plot) => plot.purchasePrice), [1200, 1200, 300]);
});

test("buying plots uses the configured price", () => {
  const game = state();
  game.coins = 500;
  const withPlot = buyPlot(game, { id: "new-zone", type: "living", name: "生活区", x: 300, y: 300, cols: 4, rows: 4, purchasePrice: 0 });
  assert.equal(withPlot.coins, 200);
  assert.equal(withPlot.plots.length, 4);
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
  assert.equal(active.schedulerServiceUnlocked, true);
  assert.equal(stepGame(active, 1).schedulerSeconds, 59);
});

test("automatic scheduler supply unlocks once and buys 180 seconds below 180", () => {
  const game = state();
  game.coins = 5400;
  game.schedulerSeconds = 180;
  const unlocked = buyAutoSchedulerSupply(game);
  assert.equal(unlocked.coins, 400);
  assert.equal(unlocked.autoSchedulerSupply, true);
  assert.equal(unlocked.schedulerServiceUnlocked, true);
  assert.equal(buyAutoSchedulerSupply(unlocked), unlocked);
  const refilled = stepGame(unlocked, 1);
  assert.equal(refilled.schedulerSeconds, 359);
  assert.equal(refilled.coins, 100);
  const poor = { ...refilled, coins: 299, schedulerSeconds: 100 };
  const unchanged = stepGame(poor, 1);
  assert.equal(unchanged.schedulerSeconds, 99);
  assert.equal(unchanged.coins, 299);
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

test("stored can opener boosts only living recovery for 120 seconds", () => {
  const game = state();
  game.inventory.specials.canOpener = 1;
  game.workers[0].mood = 90;
  const active = useSpecialItem(game, "canOpener");
  assert.equal(active.inventory.specials.canOpener, 0);
  assert.equal(active.effects.canOpener, 120);
  const recovered = stepGame(active, 1);
  assert.equal(recovered.workers[0].mood, 93);
  assert.equal(recovered.inventory.cans, 19.99);
  assert.equal(recovered.effects.canOpener, 119);
  const working = { ...active, workers: [{ ...active.workers[0], zoneId: "gather", status: "idle", mood: 100 }] };
  const worked = stepGame(working, 1, () => 1);
  assert.equal(worked.inventory.raw, 10);
  assert.equal(worked.workers[0].mood, 99);
});

test("each scheduler robot can upgrade speed and interval independently", () => {
  const efficiencyGame = buySchedulerBot({ ...state(), coins: 1000 });
  efficiencyGame.coins = 100;
  const faster = upgradeSchedulerEfficiency(efficiencyGame, 0);
  assert.equal(faster.coins, 0);
  assert.equal(faster.schedulerRobots[0].efficiency, 1.01);
  const intervalGame = buySchedulerBot({ ...state(), coins: 1000 });
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
  const game = buySchedulerBot({ ...state(), coins: 1000 });
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

test("version one saves migrate plots, automation and movement state", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  const old = state();
  old.version = 1;
  delete old.plots;
  delete old.schedulerBots;
  delete old.schedulerRobots;
  delete old.canOpenerSeconds;
  delete old.canOpenerCooldown;
  delete old.autoCanSupply;
  delete old.autoSchedulerSupply;
  delete old.schedulerServiceUnlocked;
  old.recipe = "refined";
  old.recipeProduced = 6;
  old.batch = { active: true, progress: .5, reservedRaw: 200 };
  delete old.processPlots;
  const migrated = parseSavedState(JSON.stringify(old));
  assert.equal(migrated.version, 7);
  assert.equal(migrated.plots.length, 3);
  assert.equal("motion" in migrated.workers[0], false);
  assert.equal(migrated.schedulerBots, 1);
  assert.deepEqual(migrated.schedulerRobots, [{ efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }]);
  assert.equal(migrated.canOpenerSeconds, 0);
  assert.equal(migrated.canOpenerCooldown, 0);
  assert.equal(migrated.autoCanSupply, false);
  assert.equal(migrated.autoSchedulerSupply, false);
  assert.equal(migrated.schedulerServiceUnlocked, false);
  assert.deepEqual(migrated.processPlots.process, {
    recipe: "refined",
    produced: 6,
    batch: { active: true, progress: .5, reservedRaw: 200 },
  });
  assert.deepEqual(migrated.plots.map((plot) => plot.purchasePrice), [1200, 1200, 300]);
});

test("resource zones spawn every 180 seconds and boost gathering at the plot center", () => {
  let game = state();
  game.environment.spawnElapsed = 179;
  game = stepGame(game, 1, () => .1);
  assert.equal(game.environment.zones.length, 1);
  assert.ok(game.environment.zones[0].duration >= 150 && game.environment.zones[0].duration <= 500);
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle" };
  game.environment.zones = [{ id: "bonus", x: 496, y: 386, radius: 12, bonus: .3, remaining: 100, duration: 100, meteor: false }];
  const boosted = stepGame(game, 1, () => 1);
  assert.equal(boosted.inventory.raw, 13);
});

test("a circle touching only the middle of a plot edge still grants its bonus", () => {
  let game = state();
  const gather = game.plots.find((plot) => plot.id === "gather");
  const radius = 4;
  const edgeMidpoint = { x: 704, y: 278 };
  const offset = radius * 52 * .98 / Math.sqrt(2);
  const circleX = edgeMidpoint.x + offset;
  const circleY = (edgeMidpoint.y * 52 / 27 - offset) * 27 / 52;
  assert.equal(circleHitsPlot(circleX, circleY, radius, gather), true);

  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle" };
  game.environment.zones = [{ id: "edge-bonus", x: circleX, y: circleY, radius, bonus: .3, remaining: 100, duration: 100, meteor: false }];
  game = stepGame(game, 1, () => 1);
  assert.equal(game.inventory.raw, 13);
});

test("meteor impact damages intersecting plots and knocks workers unconscious", () => {
  const game = state();
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle" };
  game.environment.zones = [{ id: "impact", x: 496, y: 386, radius: 12, bonus: .5, remaining: .5, duration: 200, meteor: true }];
  const hit = stepGame(game, 1, () => 1);
  assert.equal(hit.plots.find((plot) => plot.id === "gather").damagedRemaining, 300);
  assert.equal(hit.workers[0].status, "unconscious");
  assert.equal(hit.workers[0].recoveryRemaining, 180);
  assert.equal(hit.environment.craters[0].remaining, 600);
  assert.equal(hit.environment.craters[0].radius, 12);
});

test("meteor impact never expands beyond its resource zone", () => {
  const game = state();
  game.environment.zones = [{ id: "edge-impact", x: 1640, y: 386, radius: 12, bonus: .5, remaining: .5, duration: 200, meteor: true }];
  const hit = stepGame(game, 1, () => 1);
  assert.equal(hit.plots.find((plot) => plot.id === "gather").damagedRemaining, 0);
});

test("unconscious workers recover only while assigned to a living plot", () => {
  const game = state();
  game.workers[0] = { ...game.workers[0], status: "unconscious", recoveryRemaining: 1, mood: 0 };
  const recovered = stepGame(game, 1);
  assert.equal(recovered.workers[0].status, "ready");
  assert.equal(recovered.workers[0].mood, 100);
  assert.equal(recovered.inventory.cans, 20);
});

test("synthesis batches reserve ingredients, produce cans and refund on recipe changes", () => {
  let game = state();
  game.coins = 300;
  game = buyPlot(game, { id: "synth", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 0 });
  game.inventory.rough = 1;
  game.inventory.refined = 1;
  game.workers[0] = { ...game.workers[0], zoneId: "synth", status: "idle", mood: 100 };
  let started = stepGame(game, 1, () => 1);
  assert.equal(started.inventory.rough, 0);
  assert.equal(started.synthesisPlots.synth.batch.active, true);
  const refunded = changeSynthesisRecipe(started, "synth", "screws");
  assert.equal(refunded.inventory.rough, 1);
  assert.equal(refunded.inventory.refined, 1);
  game.synthesisPlots.synth.batch = { active: true, progress: .99, reserved: { rough: 1, refined: 1 } };
  game.inventory.rough = 0;
  game.inventory.refined = 0;
  const completed = stepGame(game, 1, () => 1);
  assert.equal(completed.inventory.cans, 40);
});

test("synthesis recipes take three times their original duration", () => {
  assert.deepEqual(Object.values(SYNTHESIS_RECIPES).map((recipe) => recipe.seconds), [60, 90, 135]);
});

test("disabled plots pause production and are ignored by automatic dispatch", () => {
  let game = state();
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle", mood: 100 };
  game = togglePlotEnabled(game, "gather");
  const paused = stepGame(game, 1, () => 1);
  assert.equal(paused.inventory.raw, 0);
  assert.equal(paused.workers[0].status, "idle");
  const ready = { ...paused, workers: [{ ...paused.workers[0], zoneId: "living", status: "ready", mood: 100 }] };
  assert.notEqual(chooseAutoDispatch(ready, [], [], { rest: false, work: true, wake: false })?.targetId, "gather");
});

test("holy light is placed from inventory and doubles production without mood drain", () => {
  const game = state();
  game.inventory.specials.holyLight = 1;
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle", mood: 100 };
  const lit = placeHolyLight(game, 496, 386);
  const next = stepGame(lit, 1, () => 1);
  assert.equal(next.inventory.raw, 20);
  assert.equal(next.workers[0].mood, 100);
  assert.equal(next.inventory.specials.holyLight, 0);
});

test("orders require manual delivery and pay the configured reward", () => {
  const game = state();
  game.inventory.rough = 5;
  game.inventory.screws = 10;
  game.orders = [{ id: "order-1", remaining: 300, processed: { kind: "rough", amount: 5 }, synthesized: { kind: "screws", amount: 10 }, reward: "coins" }];
  assert.equal(orderCoinReward(game, game.orders[0]), 150);
  const delivered = submitOrder(game, "order-1", () => 1);
  assert.equal(delivered.inventory.rough, 0);
  assert.equal(delivered.inventory.screws, 0);
  assert.equal(delivered.coins, 250);
  assert.equal(delivered.orders.length, 0);
});

test("orders dispatch every 180 seconds without probability and never exceed two", () => {
  let game = state();
  game.coins = 300;
  game = buyPlot(game, { id: "synth-orders", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 0 });
  game.orderElapsed = 179;
  game = stepGame(game, 1, () => .99);
  assert.equal(game.orders.length, 1);
  assert.equal(game.orderElapsed, 0);
  game.orders = [game.orders[0], { ...game.orders[0], id: "order-2" }, { ...game.orders[0], id: "order-3" }];
  game.orderElapsed = 179;
  game = stepGame(game, 1, () => .99);
  assert.equal(game.orders.length, 2);
  assert.equal(game.orderElapsed, 180);
});

test("meteor crater special item chance is reduced below one percent", () => {
  assert.equal(SPECIAL_DROP_CHANCE, .0025);
  assert.ok(SPECIAL_DROP_CHANCE < .01);
});

test("expansion prices and permanent research scale without decreasing", () => {
  const game = state();
  assert.equal(workerPurchasePrice(0), 100);
  assert.equal(workerPurchasePrice(25), 120);
  assert.equal(nextPlotPrice(game, "gather", 4), 300);
  game.plotPurchases.gather = 1;
  assert.equal(nextPlotPrice(game, "gather", 4), 360);
  assert.equal(nextPlotPrice(game, "gather", 8), 1430);
  game.plotPurchases.gather = 5;
  assert.equal(nextPlotPrice(game, "gather", 8), 2640);
  game.plotPurchases.gather = 10;
  assert.equal(nextPlotPrice(game, "gather", 8), 4800);
  assert.equal(schedulerBotPrice(game), 1000);
  game.schedulerBots = 2;
  assert.equal(schedulerBotPrice(game), 1600);
  game.schedulerBots = 6;
  assert.equal(schedulerBotPrice(game), 4800);
  game.schedulerBots = 11;
  assert.equal(schedulerBotPrice(game), 11500);
  game.coins = 10_000;
  const researched = buyResearch(game, "radar");
  assert.equal(researched.coins, 0);
  assert.equal(researched.research.radar, 1);
});
