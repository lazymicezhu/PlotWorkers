import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH,
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
  parseSavedState,
  orderCoinReward,
  placeHolyLight,
  randomMarketPrice,
  plotPurchasePrice,
  recyclePlot,
  recoveryRate,
  schedulerBotPrice,
  sellProducts,
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
  efficiencyGame.research.management = 1;
  efficiencyGame.coins = 100;
  const faster = upgradeSchedulerEfficiency(efficiencyGame, 0);
  assert.equal(faster.coins, 0);
  assert.equal(faster.schedulerRobots[0].efficiency, 1.02);
  assert.equal(faster.schedulerRobots[1].efficiency, 1);
  const intervalGame = buySchedulerBot({ ...state(), coins: 1000 });
  intervalGame.research.management = 1;
  intervalGame.coins = 100;
  const shorter = upgradeSchedulerInterval(intervalGame, 0);
  assert.equal(shorter.coins, 0);
  assert.equal(shorter.schedulerRobots[0].intervalSeconds, 2.9);
});

test("scheduler efficiency reaches 150 percent in 25 upgrades and stops charging", () => {
  let game = { ...state(), coins: 10_000 };
  game.research.management = 1;
  for (let level = 1; level <= 25; level += 1) {
    game = upgradeSchedulerEfficiency(game, 0);
    assert.equal(game.schedulerRobots[0].efficiency, (100 + level * 2) / 100);
    assert.equal(game.coins, 10_000 - level * 100);
  }
  assert.equal(upgradeSchedulerEfficiency(game, 0), game);
});

test("scheduler efficiency clamps the last legacy odd-percent upgrade and rejects unavailable upgrades", () => {
  const game = state();
  game.research.management = 1;
  game.schedulerRobots[0].efficiency = 1.49;
  const capped = upgradeSchedulerEfficiency(game, 0);
  assert.equal(capped.schedulerRobots[0].efficiency, 1.5);
  assert.equal(capped.coins, 0);
  const poor = { ...game, coins: 99 };
  assert.equal(upgradeSchedulerEfficiency(poor, 0), poor);
  assert.equal(upgradeSchedulerEfficiency(game, 1), game);
});

test("saved robot efficiency respects the cap while preserving existing odd-percent upgrades", () => {
  const game = buySchedulerBot({ ...state(), coins: 1000 });
  game.schedulerRobots[0].efficiency = 1.8;
  game.schedulerRobots[1].efficiency = 1.17;
  const loaded = parseSavedState(JSON.stringify(game));
  assert.deepEqual(loaded.schedulerRobots.map(robot => robot.efficiency), [1.5, 1.17]);
  assert.equal(loaded.coins, game.coins);
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

test("rest, work and wake each get a turn while all three kinds of task remain available", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "tired", zoneId: "gather", status: "exhausted", mood: 0 },
    { ...base, id: "ready", zoneId: "living", status: "ready", mood: 100 },
    { ...base, id: "slacker", zoneId: "gather", status: "slacking", mood: 80 },
  ];
  const duties = { rest: true, work: true, wake: true };
  const orders = [["rest", "work", "wake"], ["work", "wake", "rest"], ["wake", "rest", "work"]];
  const expected = [
    { workerId: "tired", targetId: "living", action: "rest" },
    { workerId: "ready", targetId: "process", action: "work" },
    { workerId: "slacker", targetId: "gather", action: "wake" },
  ];
  for (let turn = 0; turn < 9; turn += 1) {
    const index = turn % orders.length;
    assert.deepEqual(chooseAutoDispatch(game, [], [], duties, orders[index]), expected[index]);
  }
});

test("rotation immediately skips unavailable or disabled duties without dropping later work", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "ready", zoneId: "living", status: "ready", mood: 100 },
    { ...base, id: "slacker", zoneId: "gather", status: "slacking", mood: 80 },
  ];
  assert.deepEqual(chooseAutoDispatch(game, [], [], undefined, ["rest", "work", "wake"]), {
    workerId: "ready", targetId: "process", action: "work",
  });
  assert.deepEqual(chooseAutoDispatch(game, [], [], { rest: true, work: false, wake: true }, ["work", "wake", "rest"]), {
    workerId: "slacker", targetId: "gather", action: "wake",
  });
  assert.deepEqual(chooseAutoDispatch(game, ["slacker"], [], undefined, ["wake", "rest", "work"]), {
    workerId: "ready", targetId: "process", action: "work",
  });
  assert.equal(chooseAutoDispatch(game, [], [], { rest: false, work: false, wake: false }, ["wake", "rest", "work"]), null);
});

test("full living relief waits its turn and chooses the most recovered available worker", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "tired", zoneId: "gather", status: "exhausted", mood: 0 },
    { ...base, id: "slacker", zoneId: "gather", status: "slacking", mood: 80 },
    ...[30, 70, 50, 10].map((mood) => ({ ...base, id: `rest-${mood}`, zoneId: "living", status: "resting", mood })),
  ];
  assert.deepEqual(chooseAutoDispatch(game, [], [], undefined, ["wake", "rest", "work"]), {
    workerId: "slacker", targetId: "gather", action: "wake",
  });
  assert.deepEqual(chooseAutoDispatch(game, [], [], undefined, ["rest", "work", "wake"]), {
    workerId: "rest-70", targetId: "process", action: "work",
  });
  assert.deepEqual(chooseAutoDispatch(game, ["rest-70"], [], undefined, ["rest", "work", "wake"]), {
    workerId: "rest-50", targetId: "process", action: "work",
  });
  assert.deepEqual(chooseAutoDispatch(game, [], [], { rest: true, work: false, wake: true }, ["rest", "work", "wake"]), {
    workerId: "slacker", targetId: "gather", action: "wake",
  });
});

test("rotating work assignments exclude busy and dragged workers and respect reserved capacity", () => {
  const game = state();
  const base = game.workers[0];
  for (const plot of game.plots) { plot.cols = 4; plot.rows = 4; }
  game.workers = [
    { ...base, id: "assigned", zoneId: "living", status: "ready" },
    { ...base, id: "dragged", zoneId: "living", status: "dragging" },
    { ...base, id: "available", zoneId: "living", status: "ready" },
    ...Array.from({ length: 3 }, (_, index) => ({ ...base, id: `gather-${index}`, zoneId: "gather", status: "gathering" })),
    ...Array.from({ length: 4 }, (_, index) => ({ ...base, id: `process-${index}`, zoneId: "process", status: "processing" })),
  ];
  assert.deepEqual(chooseAutoDispatch(game, ["assigned"], [], undefined, ["work", "wake", "rest"]), {
    workerId: "available", targetId: "gather", action: "work",
  });
  assert.equal(chooseAutoDispatch(game, ["assigned"], ["gather"], undefined, ["work", "wake", "rest"]), null);
  assert.equal(chooseAutoDispatch(game, ["assigned", "available"], [], undefined, ["work", "wake", "rest"]), null);
});

test("rotating rest assignments cannot overbook the last living slot", () => {
  const game = state();
  const base = game.workers[0];
  game.workers = [
    { ...base, id: "assigned", zoneId: "gather", status: "exhausted", mood: 0 },
    { ...base, id: "available", zoneId: "gather", status: "exhausted", mood: 0 },
    ...Array.from({ length: 3 }, (_, index) => ({ ...base, id: `rest-${index}`, zoneId: "living", status: "resting", mood: 50 })),
  ];
  const restOnly = { rest: true, work: false, wake: false };
  assert.deepEqual(chooseAutoDispatch(game, ["assigned"], [], restOnly, ["work", "wake", "rest"]), {
    workerId: "available", targetId: "living", action: "rest",
  });
  assert.equal(chooseAutoDispatch(game, ["assigned"], ["living"], restOnly, ["work", "wake", "rest"]), null);
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
  assert.equal(migrated.version, 10);
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

test("new games and elapsed simulation contain no environment system", () => {
  let game = state();
  assert.equal(game.version, 10);
  assert.equal("environment" in game, false);
  assert.ok(game.plots.every((plot) => !("damagedRemaining" in plot) && !("reinforcedFor" in plot)));
  assert.ok(game.workers.every((worker) => !("recoveryRemaining" in worker)));
  for (let second = 0; second < 181; second += 1) game = stepGame(game, 1, () => .1);
  assert.equal("environment" in game, false);
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle" };
  const worked = stepGame(game, 1, () => 1);
  assert.equal(worked.inventory.raw, 10);
  assert.equal(worked.workers[0].status, "gathering");
});

test("holy light touching only the middle of a plot edge still grants its bonus", () => {
  let game = state();
  const gather = game.plots.find((plot) => plot.id === "gather");
  const radius = 8;
  const edgeMidpoint = { x: 704, y: 278 };
  const offset = radius * 52 * .98 / Math.sqrt(2);
  const circleX = edgeMidpoint.x + offset;
  const circleY = (edgeMidpoint.y * 52 / 27 - offset) * 27 / 52;
  assert.equal(circleHitsPlot(circleX, circleY, radius, gather), true);

  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "idle" };
  game.inventory.specials.holyLight = 1;
  game = placeHolyLight(game, circleX, circleY);
  game = stepGame(game, 1, () => 1);
  assert.equal(game.inventory.raw, 20);
  assert.equal(game.workers[0].mood, 100);
});

test("version seven saves remove environmental damage and resume existing production", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  const old = state();
  old.version = 7;
  old.coins = 1234;
  old.inventory.specials = { canOpener: 2, smartLeader: 3, holyLight: 4 };
  old.research = { radar: 3, structure: 5, medicine: 5, synthesis: 2, orders: 1 };
  old.environment = {
    spawnElapsed: 179,
    serial: 5,
    zones: [
      { id: "bonus", x: 496, y: 386, radius: 12, bonus: 1, remaining: 100, duration: 200, meteor: false },
      { id: "impact", x: 496, y: 386, radius: 12, bonus: .5, remaining: .5, duration: 200, meteor: true },
    ],
    craters: [{ id: "crater", x: 1496, y: 386, radius: 12, remaining: 600 }],
  };
  old.plots = old.plots.map((plot) => ({ ...plot, damagedRemaining: 300, reinforcedFor: "impact" }));
  const base = { ...old.workers[0], mood: 0, recoveryRemaining: 180 };
  old.workers = [
    { ...base, id: "resting-worker", zoneId: "living", status: "recovering" },
    { ...base, id: "gather-worker", zoneId: "gather", status: "unconscious" },
    { ...base, id: "process-worker", zoneId: "process", status: "recovering" },
    { ...base, id: "unassigned-worker", zoneId: null, status: "unconscious" },
  ];
  old.processPlots.process = { recipe: "rough", produced: 7, batch: { active: true, progress: .95, reservedRaw: 75 } };

  const migrated = parseSavedState(JSON.stringify(old));
  assert.equal(migrated.version, 10);
  assert.equal("environment" in migrated, false);
  assert.ok(migrated.plots.every((plot) => !("damagedRemaining" in plot) && !("reinforcedFor" in plot)));
  assert.ok(migrated.workers.every((worker) => !("recoveryRemaining" in worker)));
  assert.deepEqual(migrated.workers.map((worker) => worker.status), ["ready", "idle", "idle", "idle"]);
  assert.deepEqual(migrated.workers.map((worker) => worker.mood), [100, 100, 100, 100]);
  assert.equal(migrated.coins, old.coins);
  assert.deepEqual(migrated.inventory, old.inventory);
  assert.deepEqual(migrated.research, { ...state().research, synthesis: 2, orders: 1 });
  assert.deepEqual(migrated.processPlots, old.processPlots);

  const next = stepGame(migrated, 1, () => 0);
  assert.equal("environment" in next, false);
  assert.equal(next.inventory.raw, 10);
  assert.equal(next.inventory.rough, 1);
  assert.equal(next.processPlots.process.produced, 8);
  assert.equal(next.processPlots.process.batch.active, false);
  assert.equal(next.workers[1].status, "gathering");
  assert.equal(next.workers[2].status, "processing");
  assert.equal(next.inventory.cans, old.inventory.cans);
  assert.deepEqual(next.inventory.specials, old.inventory.specials);
  assert.deepEqual(parseSavedState(JSON.stringify(next)), next);
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

test("selling all products keeps screw and rebar batches reserved and able to finish", () => {
  for (const kind of ["screws", "rebar"]) {
    const recipe = SYNTHESIS_RECIPES[kind];
    let game = state();
    game.coins = 300;
    game = buyPlot(game, { id: "synth", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 0 });
    game = changeSynthesisRecipe(game, "synth", kind);
    Object.assign(game.inventory, { rough: 7, refined: 3, screws: 4, rebar: 2 });
    for (const [input, amount] of Object.entries(recipe.inputs)) game.inventory[input] += amount;
    game.workers[0] = { ...game.workers[0], zoneId: "synth", status: "idle", mood: 100, stamina: 10, personality: "lazy" };

    const started = stepGame(game, 1, () => 1);
    assert.deepEqual(started.synthesisPlots.synth.batch.reserved, recipe.inputs);
    assert.deepEqual([started.inventory.rough, started.inventory.refined, started.inventory.screws, started.inventory.rebar], [7, 3, 4, 2]);

    let sold = sellProducts(started, "all");
    assert.equal(sold.coins - started.coins, 380);
    assert.deepEqual([sold.inventory.rough, sold.inventory.refined, sold.inventory.screws, sold.inventory.rebar], [0, 0, 0, 0]);
    assert.deepEqual(sold.synthesisPlots.synth.batch, started.synthesisPlots.synth.batch);
    sold = stepGame(sold, 1, () => 1);
    assert.ok(sold.synthesisPlots.synth.batch.progress > started.synthesisPlots.synth.batch.progress);

    for (let second = 0; second < 200 && sold.synthesisPlots.synth.batch.active; second += 1) sold = stepGame(sold, 1, () => 1);
    assert.equal(sold.inventory[kind], recipe.output);
    assert.equal(sold.synthesisPlots.synth.produced, recipe.output);
    assert.deepEqual(sold.synthesisPlots.synth.batch, { active: false, progress: 0, reserved: {} });
    const waiting = stepGame(sold, 1, () => 1);
    assert.equal(waiting.workers[0].status, "waiting");
    assert.equal(waiting.synthesisPlots.synth.batch.active, false);
    assert.equal(waiting.inventory[kind], recipe.output);
  }
});

test("saved paused synthesis batches keep ingredients unavailable to orders and refund them on recipe changes", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  let game = state();
  game.coins = 300;
  game = buyPlot(game, { id: "synth", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 0 });
  game = changeSynthesisRecipe(game, "synth", "rebar");
  Object.assign(game.inventory, SYNTHESIS_RECIPES.rebar.inputs);
  game.workers[0] = { ...game.workers[0], zoneId: "synth", status: "idle", mood: 100 };
  game.orders = [{ id: "reserved-order", remaining: 300, processed: { kind: "rough", amount: 1 }, synthesized: { kind: "screws", amount: 1 }, reward: "coins" }];
  const started = stepGame(game, 1, () => 1);
  const restored = parseSavedState(JSON.stringify(togglePlotEnabled(started, "synth")));
  assert.deepEqual(restored.synthesisPlots.synth.batch, started.synthesisPlots.synth.batch);
  assert.deepEqual([restored.inventory.rough, restored.inventory.refined, restored.inventory.screws], [0, 0, 0]);
  assert.equal(submitOrder(restored, "reserved-order"), restored);

  const paused = stepGame(restored, 1, () => 1);
  assert.deepEqual(paused.synthesisPlots.synth.batch, started.synthesisPlots.synth.batch);
  const resumed = stepGame(togglePlotEnabled(paused, "synth"), 1, () => 1);
  assert.ok(resumed.synthesisPlots.synth.batch.progress > paused.synthesisPlots.synth.batch.progress);

  const refunded = changeSynthesisRecipe(resumed, "synth", "screws");
  assert.deepEqual([refunded.inventory.rough, refunded.inventory.refined, refunded.inventory.screws], [10, 5, 2]);
  assert.deepEqual(refunded.synthesisPlots.synth.batch, { active: false, progress: 0, reserved: {} });
  assert.deepEqual(changeSynthesisRecipe(refunded, "synth", "cans").inventory, refunded.inventory);
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

test("evacuation outranks rest, wake and work even when the ordinary worker comes first", () => {
  for (const [status, zoneId, mood] of [["exhausted", "process", 0], ["slacking", "process", 80], ["ready", "living", 100]]) {
    const game = state();
    const base = game.workers[0];
    game.plots.find((plot) => plot.id === "gather").enabled = false;
    game.workers = [
      { ...base, id: "ordinary", status, zoneId, mood },
      { ...base, id: "evacuee", status: "gathering", zoneId: "gather", mood: 80 },
    ];
    for (const order of [["rest", "work", "wake"], ["work", "wake", "rest"], ["wake", "rest", "work"]]) {
      assert.deepEqual(chooseAutoDispatch(game, [], [], undefined, order), { workerId: "evacuee", targetId: "process", action: "evacuate" });
    }
  }
});

test("evacuation overrides robot duty switches and survives the disabled plot idle state", () => {
  for (const mood of [0, 75]) {
    let game = state();
    game.workers[0] = { ...game.workers[0], zoneId: "gather", mood, status: mood === 0 ? "exhausted" : "gathering" };
    game = stepGame(togglePlotEnabled(game, "gather"), 1, () => 1);
    assert.equal(game.workers[0].status, "idle");
    assert.deepEqual(chooseAutoDispatch(game, [], [], { rest: false, work: false, wake: false }), {
      workerId: game.workers[0].id, targetId: mood === 0 ? "living" : "process", action: "evacuate",
    });
  }
});

test("disabled living plots move recovering workers to living space and ready workers to work", () => {
  for (const mood of [0, 50, 100]) {
    let game = state();
    game.plots.push({ ...game.plots.find((plot) => plot.id === "living"), id: "living-2" });
    game.workers[0].mood = mood;
    game = stepGame(togglePlotEnabled(game, "living"), 1, () => 1);
    assert.deepEqual(chooseAutoDispatch(game), {
      workerId: game.workers[0].id, targetId: mood < 100 ? "living-2" : "gather", action: "evacuate",
    });
  }
});

test("productive evacuees prefer a plot of the same type even when other work plots are emptier", () => {
  for (const type of ["gather", "process", "synthesis"]) {
    const game = state();
    const base = game.workers[0];
    game.plots.push({ ...game.plots[0], id: "disabled-source", type, enabled: false });
    game.plots.push({ ...game.plots[0], id: "same-type", type, cols: 4, rows: 4 });
    for (const plot of game.plots) if (plot.type === type && plot.id !== "same-type") plot.enabled = false;
    game.workers = [
      { ...base, id: "evacuee", zoneId: "disabled-source", status: "idle", mood: 80 },
      { ...base, id: "resident", zoneId: "same-type", status: "idle" },
    ];
    assert.deepEqual(chooseAutoDispatch(game), { workerId: "evacuee", targetId: "same-type", action: "evacuate" });
  }
});

test("evacuation balances other work plots when matching plots have no unreserved slot", () => {
  const game = state();
  const base = game.workers[0];
  game.plots.find((plot) => plot.id === "gather").enabled = false;
  game.plots.push({ ...game.plots[0], id: "gather-2", cols: 4, rows: 4, enabled: true });
  game.plots.push({ ...game.plots[1], id: "process-2" });
  game.workers = [
    { ...base, id: "evacuee", zoneId: "gather", status: "idle" },
    ...Array.from({ length: 3 }, (_, index) => ({ ...base, id: `gather-${index}`, zoneId: "gather-2", status: "idle" })),
    { ...base, id: "processor", zoneId: "process", status: "idle" },
  ];
  assert.deepEqual(chooseAutoDispatch(game, [], ["gather-2"]), { workerId: "evacuee", targetId: "process-2", action: "evacuate" });
});

test("evacuation falls back to available space when the preferred destination is unavailable", () => {
  const resting = state();
  resting.plots.find((plot) => plot.id === "living").enabled = false;
  resting.workers[0].mood = 40;
  assert.deepEqual(chooseAutoDispatch(resting), { workerId: resting.workers[0].id, targetId: "gather", action: "evacuate" });

  const working = state();
  for (const plot of working.plots) if (plot.type !== "living") plot.enabled = false;
  working.workers[0] = { ...working.workers[0], zoneId: "gather", status: "idle", mood: 80 };
  assert.deepEqual(chooseAutoDispatch(working), { workerId: working.workers[0].id, targetId: "living", action: "evacuate" });
});

test("evacuation waits when all other plots are disabled, full or reserved and never wakes in place", () => {
  const game = state();
  for (const plot of game.plots) plot.enabled = false;
  game.workers[0] = { ...game.workers[0], zoneId: "gather", status: "slacking" };
  assert.equal(chooseAutoDispatch(game), null);

  const living = game.plots.find((plot) => plot.id === "living");
  living.enabled = true;
  game.workers.push(...Array.from({ length: 3 }, (_, index) => ({ ...game.workers[0], id: `rest-${index}`, zoneId: "living", mood: 0, status: "resting" })));
  assert.equal(chooseAutoDispatch(game, [], ["living"]), null);
  game.workers.push({ ...game.workers[1], id: "rest-final" });
  assert.equal(chooseAutoDispatch(game), null);
});

test("evacuation skips workers already assigned to robots or being dragged", () => {
  const game = state();
  const base = game.workers[0];
  game.plots.find((plot) => plot.id === "gather").enabled = false;
  game.workers = [
    { ...base, id: "assigned", zoneId: "gather", status: "idle" },
    { ...base, id: "held", zoneId: "gather", status: "dragging" },
    { ...base, id: "available", zoneId: "gather", status: "idle" },
  ];
  assert.deepEqual(chooseAutoDispatch(game, ["assigned"]), { workerId: "available", targetId: "process", action: "evacuate" });
  assert.equal(chooseAutoDispatch(game, ["assigned", "available"]), null);
});

test("foremen evacuate disabled plots but keep their manual placement on enabled plots", () => {
  const game = state();
  game.workers[0] = { ...game.workers[0], role: "foreman", zoneId: "gather", status: "slacking" };
  assert.equal(chooseAutoDispatch(game), null);
  game.plots.find((plot) => plot.id === "gather").enabled = false;
  assert.deepEqual(chooseAutoDispatch(game), { workerId: game.workers[0].id, targetId: "process", action: "evacuate" });
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
  assert.equal(orderCoinReward(game, game.orders[0]), 525);
  const delivered = submitOrder(game, "order-1", () => 1);
  assert.equal(delivered.inventory.rough, 0);
  assert.equal(delivered.inventory.screws, 0);
  assert.equal(delivered.coins, 625);
  assert.deepEqual(delivered.inventory.specials, game.inventory.specials);
  assert.equal(delivered.orders.length, 0);
});

test("selling screws individually or with all products pays the same fixed price", () => {
  const game = state();
  game.market.roughPrice = 12;
  game.market.refinedPrice = 36;
  Object.assign(game.inventory, { rough: 2, refined: 3, screws: 10, rebar: 4 });
  const screwsOnly = sellProducts(game, "screws");
  assert.equal(screwsOnly.coins - game.coins, 300);
  assert.equal(screwsOnly.inventory.screws, 0);
  assert.equal(screwsOnly.inventory.rough, 2);
  assert.equal(screwsOnly.inventory.refined, 3);
  assert.equal(screwsOnly.inventory.rebar, 4);
  const all = sellProducts(game, "all");
  assert.equal(all.coins - game.coins, 632);
  assert.equal(sellProducts(screwsOnly, "all").coins, all.coins);
  assert.deepEqual([all.inventory.rough, all.inventory.refined, all.inventory.screws, all.inventory.rebar], [0, 0, 0, 0]);
  assert.equal(all.inventory.cans, game.inventory.cans);
});

test("partial sales remove only the selected product amount and use its current price", () => {
  const game = state();
  game.market.roughPrice = 9;
  game.market.refinedPrice = 34;
  Object.assign(game.inventory, { rough: 8, refined: 9, screws: 10, rebar: 11 });
  const original = structuredClone(game);
  for (const [kind, price] of [["rough", 9], ["refined", 34], ["screws", 30], ["rebar", 50]]) {
    const sold = sellProducts(game, kind, 3);
    assert.equal(sold.coins - game.coins, 3 * price);
    assert.deepEqual(sold.inventory, { ...game.inventory, [kind]: game.inventory[kind] - 3 });
  }
  assert.deepEqual(game, original);
});

test("partial sales ignore invalid or empty quantities without changing state", () => {
  const game = state();
  Object.assign(game.inventory, { rough: 8, refined: 9, screws: 10, rebar: 11 });
  for (const kind of ["rough", "refined", "screws", "rebar"]) {
    for (const amount of [0, -1, -.5, .9, NaN, Infinity, -Infinity]) {
      assert.equal(sellProducts(game, kind, amount), game, `${kind}: ${amount}`);
    }
    const empty = { ...game, inventory: { ...game.inventory, [kind]: 0 } };
    assert.equal(sellProducts(empty, kind, 2), empty);
  }
});

test("partial sales floor fractional quantities and clamp sales to available inventory", () => {
  const game = state();
  Object.assign(game.inventory, { rough: 8, refined: 9, screws: 10, rebar: 11 });
  for (const [kind, price] of [["rough", 10], ["refined", 30], ["screws", 30], ["rebar", 50]]) {
    const fractional = sellProducts(game, kind, 2.8);
    assert.equal(fractional.coins - game.coins, 2 * price);
    assert.equal(fractional.inventory[kind], game.inventory[kind] - 2);
    assert.deepEqual(sellProducts(game, kind, 1000), sellProducts(game, kind));
  }
});

test("selling all remains compatible when an optional quantity is passed", () => {
  const game = state();
  Object.assign(game.inventory, { rough: 8, refined: 9, screws: 10, rebar: 11 });
  const all = sellProducts(game, "all");
  for (const amount of [0, 1, 5, NaN, Infinity]) {
    assert.deepEqual(sellProducts(game, "all", amount), all);
  }
  assert.deepEqual([all.inventory.rough, all.inventory.refined, all.inventory.screws, all.inventory.rebar], [0, 0, 0, 0]);
  assert.equal(all.coins - game.coins, 1200);
});

test("partial sales leave active production batches and reserved ingredients unchanged", () => {
  const game = state();
  Object.assign(game.inventory, { rough: 8, refined: 9, screws: 10, rebar: 11 });
  game.processPlots.process.batch = { active: true, progress: .5, reservedRaw: 75 };
  game.synthesisPlots.synth = { recipe: "rebar", produced: 0, batch: { active: true, progress: .4, reserved: { rough: 10, refined: 5, screws: 2 } } };
  const original = structuredClone(game);
  for (const kind of ["rough", "refined", "screws", "rebar"]) {
    const sold = sellProducts(game, kind, 3);
    assert.deepEqual(sold.processPlots, original.processPlots);
    assert.deepEqual(sold.synthesisPlots, original.synthesisPlots);
    assert.equal(sold.inventory.raw, original.inventory.raw);
    assert.equal(sold.inventory[kind], original.inventory[kind] - 3);
  }
});

test("saleable synthesis batches are worth more than their inputs even at peak market prices", () => {
  for (const kind of ["screws", "rebar"]) {
    const recipe = SYNTHESIS_RECIPES[kind];
    const materials = state();
    materials.market.roughPrice = 12;
    materials.market.refinedPrice = 36;
    Object.assign(materials.inventory, recipe.inputs);
    const inputValue = sellProducts(materials, "all").coins - materials.coins;
    const products = state();
    products.inventory[kind] = recipe.output;
    const outputValue = sellProducts(products, kind).coins - products.coins;
    assert.ok(outputValue > inputValue, `${kind} should add value to its materials`);
  }
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

test("saved special orders pay 1.5 times the coin reward plus one item only once", async () => {
  const { parseSavedState } = await import("../app/game-engine.ts");
  const game = state();
  game.inventory.rough = 5;
  game.inventory.screws = 10;
  game.orders = [{ id: "special-order", remaining: 300, processed: { kind: "rough", amount: 5 }, synthesized: { kind: "screws", amount: 10 }, reward: "special" }];
  const restored = parseSavedState(JSON.stringify(game));
  assert.equal(orderCoinReward(restored, { ...restored.orders[0], reward: "coins" }), 525);
  assert.equal(orderCoinReward(restored, restored.orders[0]), 788);
  const delivered = submitOrder(restored, "special-order", () => 1);
  assert.equal(delivered.inventory.rough, 0);
  assert.equal(delivered.inventory.screws, 0);
  assert.deepEqual(delivered.inventory.specials, { ...game.inventory.specials, holyLight: 1 });
  assert.equal(delivered.orders.length, 0);
  assert.equal(delivered.coins, 888);
  assert.equal(submitOrder(delivered, "special-order", () => 0), delivered);
});

test("special order coins track market and research bonuses with each reward rounded up", () => {
  for (const [kind, amount, price, synthesized, research, standardReward, specialReward] of [
    ["rough", 5, 8, "screws", 0, 510, 765],
    ["rough", 1, 11, "screws", 0, 467, 701],
    ["refined", 3, 33, "rebar", 2, 1079, 1619],
  ]) {
    const game = state();
    game.market[`${kind}Price`] = price;
    game.research.orders = research;
    game.inventory[kind] = amount;
    game.inventory[synthesized] = 10;
    const standard = { id: "order", remaining: 300, processed: { kind, amount }, synthesized: { kind: synthesized, amount: 10 }, reward: "coins" };
    const special = { ...standard, reward: "special" };
    assert.equal(orderCoinReward(game, standard), standardReward);
    assert.equal(orderCoinReward(game, special), specialReward);
    const standardDelivery = submitOrder({ ...game, orders: [standard] }, standard.id);
    const specialDelivery = submitOrder({ ...game, orders: [special] }, special.id, () => 0);
    assert.equal(standardDelivery.coins - game.coins, standardReward);
    assert.equal(specialDelivery.coins - game.coins, Math.ceil((standardDelivery.coins - game.coins) * 1.5));
  }
});

test("special orders with missing products grant neither coins nor items", () => {
  for (const missing of ["rough", "screws"]) {
    const game = state();
    game.inventory.rough = 5;
    game.inventory.screws = 10;
    game.inventory[missing] -= 1;
    game.orders = [{ id: "special-order", remaining: 300, processed: { kind: "rough", amount: 5 }, synthesized: { kind: "screws", amount: 10 }, reward: "special" }];
    const before = structuredClone(game);
    const delivered = submitOrder(game, "special-order", () => assert.fail("unfulfilled orders must not draw an item"));
    assert.equal(delivered, game);
    assert.deepEqual(delivered, before);
  }
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
  assert.deepEqual(Object.keys(RESEARCH), ["gather", "process", "synthesis", "management", "planning", "orders", "negotiation", "delivery"]);
  game.coins = RESEARCH.synthesis.costs[0];
  const researched = buyResearch(game, "synthesis");
  assert.equal(researched.coins, 0);
  assert.equal(researched.research.synthesis, 1);
});
