import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH,
  buyResearch,
  cancelOrderTracking,
  createInitialState,
  orderCoinReward,
  orderDuration,
  parseSavedState,
  recyclePlot,
  refreshOrder,
  startOrderTracking,
  stepGame,
  upgradeSchedulerEfficiency,
  upgradeSchedulerInterval,
} from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";

const fresh = () => createInitialState(0, 0);
const order = (id = "order-1") => ({
  id, remaining: 123, processed: { kind: "rough", amount: 8 },
  synthesized: { kind: "screws", amount: 10 }, reward: "special",
});
const addSynthesis = (game) => {
  game.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 });
  game.synthesisPlots.synthesis = { recipe: "screws", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
};

test("all research purchases debit their own tier price and preserve actual investment", () => {
  let game = fresh();
  game.coins = 1_346_000;
  let spent = 0;
  for (const [id, config] of Object.entries(RESEARCH)) {
    for (const cost of config.costs) {
      const before = game;
      game = buyResearch(game, id);
      spent += cost;
      assert.equal(game.coins, before.coins - cost);
      assert.equal(game.researchInvestment, spent);
      assert.equal(before.research[id], game.research[id] - 1);
    }
    assert.equal(buyResearch(game, id), game);
  }
  assert.equal(spent, 1_346_000);
  assert.equal(game.coins, 0);
});

test("robot parameter upgrades require the one-time management unlock", () => {
  let game = fresh();
  game.coins = 10_000;
  assert.equal(upgradeSchedulerEfficiency(game, 0), game);
  assert.equal(upgradeSchedulerInterval(game, 0), game);
  game = buyResearch(game, "management");
  game = upgradeSchedulerEfficiency(game, 0);
  game = upgradeSchedulerInterval(game, 0);
  assert.equal(game.coins, 6_800);
  assert.equal(game.schedulerRobots[0].efficiency, 1.02);
  assert.equal(game.schedulerRobots[0].intervalSeconds, 2.9);
  assert.equal(game.researchInvestment, 3_000);
});

test("production research increases only the matching activity without extra mood drain", () => {
  const gather = fresh();
  gather.workers[0].zoneId = "gather";
  gather.workers[0].status = "idle";
  const gatherBaseline = stepGame(gather, 1, () => 1);
  gather.research.gather = 5;
  const gatherBoosted = stepGame(gather, 1, () => 1);
  assert.equal(gatherBoosted.inventory.raw, gatherBaseline.inventory.raw * 1.5);
  assert.equal(gatherBoosted.workers[0].mood, gatherBaseline.workers[0].mood);

  const process = fresh();
  process.workers[0].zoneId = "process";
  process.workers[0].status = "idle";
  process.inventory.raw = 1_000;
  process.research.process = 5;
  const processing = stepGame(process, 1, () => 1);
  assert.equal(processing.processPlots.process.batch.progress, .15);
  assert.equal(processing.processPlots.process.batch.reservedRaw, 75);

  const synthesis = fresh();
  addSynthesis(synthesis);
  synthesis.workers[0].zoneId = "synthesis";
  synthesis.workers[0].status = "idle";
  synthesis.inventory.rough = 100;
  synthesis.research.synthesis = 5;
  const synthesizing = stepGame(synthesis, 1, () => 1);
  assert.equal(synthesizing.synthesisPlots.synthesis.batch.progress, 1.75 / 90);
  assert.equal(synthesizing.inventory.rough, 80);
});

test("delivery assurance extends only newly generated order time without raising demand", () => {
  const base = fresh();
  addSynthesis(base);
  base.orderElapsed = 179;
  base.orders = [order("existing")];
  const ordinary = stepGame(base, 1, () => .9);
  base.research.delivery = 3;
  const extended = stepGame(base, 1, () => .9);
  assert.equal(extended.orders[0].remaining, 122);
  assert.equal(ordinary.orders[1].remaining, 300);
  assert.equal(ordinary.orders[1].duration, 300);
  assert.equal(extended.orders[1].remaining, 390);
  assert.equal(extended.orders[1].duration, 390);
  assert.deepEqual(extended.orders[1].processed, ordinary.orders[1].processed);
  assert.deepEqual(extended.orders[1].synthesized, ordinary.orders[1].synthesized);
});

test("an order keeps its original countdown scale through research upgrades, time and negotiation", () => {
  let game = fresh();
  addSynthesis(game);
  game.orderElapsed = 179;
  game = stepGame(game, 1, () => .9);
  game = stepGame(game, 1, () => 1);
  const beforeUpgrade = game.orders[0];
  assert.equal(beforeUpgrade.remaining, 299);
  assert.equal(orderDuration(beforeUpgrade), 300);
  game.coins = 100_000;
  game = buyResearch(game, "delivery");
  game = buyResearch(game, "delivery");
  game = buyResearch(game, "negotiation");
  assert.equal(orderDuration(game.orders[0]), 300, "new-order research does not rescale active orders");
  game = refreshOrder(game, beforeUpgrade.id, () => .1);
  assert.equal(game.orders[0].remaining, 299);
  assert.equal(game.orders[0].duration, 300, "a replacement keeps the original deadline despite new research");
  const restored = parseSavedState(JSON.stringify(game));
  assert.equal(orderDuration(restored.orders[0]), 300);
  const elapsed = stepGame(restored, 1, () => 1);
  assert.equal(elapsed.orders[0].remaining, 298);
  assert.equal(orderDuration(elapsed.orders[0]), 300);
});

test("old orders gain a fixed inferred duration on load and malformed durations are rejected", () => {
  const game = fresh();
  game.research.delivery = 2;
  game.orders = [order(), { ...order("order-2"), remaining: 380 }];
  const restored = parseSavedState(JSON.stringify(game));
  assert.deepEqual(restored.orders.map((item) => item.duration), [360, 380]);
  assert.equal(game.orders[0].duration, undefined, "migration does not mutate its input");
  restored.coins = 45_000;
  const upgraded = buyResearch(restored, "delivery");
  assert.deepEqual(parseSavedState(JSON.stringify(upgraded)).orders.map((item) => item.duration), [360, 380]);
  assert.equal(orderDuration(order()), 300, "in-memory legacy fixtures have a safe baseline");
  assert.equal(orderDuration({ ...order(), remaining: 390 }), 390);
  for (const duration of [0, -1, 122, null, "300", NaN, Infinity]) {
    game.orders = [{ ...order(), duration }];
    assert.equal(parseSavedState(JSON.stringify(game)), null, `invalid duration: ${duration}`);
  }
});

test("negotiation refresh keeps identity, reward and time while sharing a tiered cooldown", () => {
  let game = fresh();
  game.orders = [order(), order("order-2")];
  assert.equal(refreshOrder(game, "order-1", () => .9), game);
  game.research.negotiation = 2;
  const refreshed = refreshOrder(game, "order-1", () => .9);
  assert.equal(refreshed.orderRefreshCooldown, 240);
  assert.equal(refreshed.orders[0].id, "order-1");
  assert.equal(refreshed.orders[0].remaining, 123);
  assert.equal(refreshed.orders[0].reward, "special");
  assert.equal(refreshed.orders[0].rerolled, true);
  assert.equal(refreshed.orders[0].processed.kind, "refined");
  assert.equal(refreshed.orders[0].synthesized.kind, "rebar");
  assert.equal(refreshOrder(refreshed, "order-2"), refreshed);
  const elapsed = stepGame(refreshed, 1, () => 1);
  assert.equal(elapsed.orderRefreshCooldown, 239);
  elapsed.orderRefreshCooldown = 0;
  assert.equal(refreshOrder(elapsed, "order-1"), elapsed);
  assert.equal(refreshOrder(elapsed, "order-2", () => .1).orderRefreshCooldown, 240);
  assert.equal(game.orders[0].rerolled, undefined);
});

test("order network improves coin payments for both reward types", () => {
  const game = fresh();
  const ordinary = { ...order(), reward: "coins" };
  const ordinaryBaseline = orderCoinReward(game, ordinary);
  const specialBaseline = orderCoinReward(game, order());
  game.research.orders = 5;
  assert.equal(orderCoinReward(game, ordinary), ordinaryBaseline * 1.5);
  assert.equal(orderCoinReward(game, order()), Math.ceil(specialBaseline * 1.5));
});

test("legacy research keeps prior spending and grandfathered robot upgrades", () => {
  const old = fresh();
  old.version = 9;
  old.research = { synthesis: 2, orders: 1 };
  old.researchInvestment = 0;
  old.schedulerRobots[0].efficiency = 1.02;
  const migrated = parseSavedState(JSON.stringify(old));
  assert.equal(migrated.version, 11);
  assert.equal(migrated.researchInvestment, 300_000);
  assert.equal(migrated.research.management, 1);
  assert.equal(migrated.research.gather, 0);
  assert.equal(migrated.research.planning, 0);
  assert.equal(migrated.productionPlan, null);
  assert.equal(migrated.orderRefreshCooldown, 0);
  const repurchased = buyResearch({ ...migrated, coins: 30_000 }, "synthesis");
  assert.equal(repurchased.researchInvestment, 330_000);
  assert.equal(parseSavedState(JSON.stringify(repurchased)).researchInvestment, 330_000);
});

test("current saves preserve research, refresh cooldown and valid tracked original recipes", () => {
  const game = fresh();
  game.research.planning = 1;
  game.researchInvestment = 5_000;
  game.orders = [order()];
  game.orderRefreshCooldown = 42.5;
  game.productionPlan = { orderId: "order-1", phase: "tracking", process: { process: "refined" }, synthesis: {}, pausedPlotIds: ["process"] };
  const restored = parseSavedState(JSON.stringify(game));
  assert.deepEqual(restored.productionPlan, game.productionPlan);
  assert.equal(restored.orderRefreshCooldown, 42.5);
  assert.equal(restored.researchInvestment, 5_000);
  assert.equal(parseSavedState(JSON.stringify({ ...game, researchInvestment: -1 })), null);
  assert.equal(parseSavedState(JSON.stringify({ ...game, productionPlan: { ...game.productionPlan, process: { process: "cans" } } })), null);
});

test("recycling a managed plot releases its snapshot before an immediate save and refunds once", () => {
  for (const type of ["process", "synthesis"]) {
    const game = fresh();
    game.research.planning = 1;
    game.orders = [order()];
    game.inventory.raw = 100;
    game.inventory.rough = 7;
    const plotId = `${type}-extra`;
    game.plots.push({ id: plotId, type, name: "待回收地块", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
    game.productionPlan = { orderId: "order-1", phase: "tracking", process: { process: "rough" }, synthesis: {}, pausedPlotIds: [plotId] };
    if (type === "process") {
      game.processPlots[plotId] = { recipe: "rough", produced: 0, batch: { active: true, progress: .4, reservedRaw: 75 } };
      game.productionPlan.process[plotId] = "refined";
    } else {
      addSynthesis(game);
      game.synthesisPlots[plotId] = { recipe: "screws", produced: 0, batch: { active: true, progress: .4, reserved: { rough: 20 } } };
      game.productionPlan.synthesis[plotId] = "cans";
    }
    const original = structuredClone(game);
    const recycled = recyclePlot(game, plotId);
    assert.deepEqual(game, original);
    assert.equal(recycled.productionPlan[type][plotId], undefined);
    assert.ok(!recycled.productionPlan.pausedPlotIds.includes(plotId));
    assert.ok(!recycled.plots.some((plot) => plot.id === plotId));
    assert.equal(recycled.inventory.raw, type === "process" ? 175 : 100);
    assert.equal(recycled.inventory.rough, type === "synthesis" ? 27 : 7);
    const restored = parseGameSave(exportGameSave(recycled)).state;
    assert.deepEqual(restored.productionPlan, recycled.productionPlan);
    assert.equal(restored.inventory.raw, recycled.inventory.raw);
    assert.equal(restored.inventory.rough, recycled.inventory.rough);
    assert.equal(recyclePlot(recycled, plotId), recycled);
  }
});

test("expired orders cannot consume the shared refresh cooldown", () => {
  for (const remaining of [0, -.1]) {
    const game = fresh();
    game.research.negotiation = 3;
    game.orders = [{ ...order(), remaining }];
    assert.equal(refreshOrder(game, "order-1", () => { throw new Error("must not generate a replacement"); }), game);
    assert.equal(game.orderRefreshCooldown, 0);
  }
});

test("production and restoration switch recipes only after completion and carry remaining work in seconds", () => {
  const game = fresh();
  game.research.planning = 1;
  game.inventory.raw = 1_000;
  game.inventory.screws = 10;
  game.workers[0] = { ...game.workers[0], zoneId: "process", status: "processing", role: "foreman" };
  game.processPlots.process.batch = { active: true, progress: .95, reservedRaw: 75 };
  game.orders = [{ ...order(), processed: { kind: "refined", amount: 1 } }];
  const tracked = startOrderTracking(game, "order-1");
  assert.equal(tracked.processPlots.process.recipe, "rough");
  let next = stepGame(tracked, 1, () => 1);
  assert.equal(next.inventory.rough, 1);
  assert.equal(next.inventory.refined, 0);
  assert.equal(next.processPlots.process.recipe, "refined");
  assert.ok(Math.abs(next.processPlots.process.batch.progress - .05) < 1e-10);
  assert.equal(next.processPlots.process.batch.reservedRaw, 200);
  assert.equal(next.inventory.raw, 800);
  next.processPlots.process.batch.progress = .99;
  const cancelling = cancelOrderTracking(next);
  assert.equal(cancelling.productionPlan.phase, "restoring");
  assert.equal(cancelling.processPlots.process.recipe, "refined");
  next = stepGame(cancelling, 1, () => 1);
  assert.equal(next.productionPlan, null);
  assert.equal(next.inventory.refined, 1);
  assert.equal(next.processPlots.process.recipe, "rough");
  assert.ok(Math.abs(next.processPlots.process.batch.progress - .17) < 1e-10);
  assert.equal(next.inventory.raw, 725);
  assert.equal(tracked.processPlots.process.batch.progress, .95);
});


test("fishing is a free one-time special-plot research that keeps its unlock before placement", () => {
  const game = fresh();
  game.coins = 0;
  const before = structuredClone(game);
  const unlocked = buyResearch(game, "fishing");
  assert.equal(RESEARCH.fishing.group, "special");
  assert.deepEqual(RESEARCH.fishing.costs, [0]);
  assert.equal(unlocked.research.fishing, 1);
  assert.equal(unlocked.coins, 0);
  assert.equal(unlocked.researchInvestment, game.researchInvestment);
  assert.equal(unlocked.plots.filter((plot) => plot.type === "fishing").length, 0);
  assert.equal(buyResearch(unlocked, "fishing"), unlocked, "retrying placement must not purchase another tier");
  assert.deepEqual(parseGameSave(exportGameSave(unlocked)).state, unlocked, "cancelled placement keeps the entitlement after reload");
  assert.deepEqual(game, before, "unlock leaves the previous game state untouched");
});
