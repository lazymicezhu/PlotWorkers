import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, parseSavedState, stepGame } from "../app/game-engine.ts";
import { FIRST_REBIRTH_ASSET_REQUIREMENT, canFirstRebirth, completeFirstRebirth } from "../app/rebirth.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import { saveValuation } from "../app/save-valuation.ts";

function eligibleGame() {
  const state = createInitialState(998, 853);
  state.coins += FIRST_REBIRTH_ASSET_REQUIREMENT - saveValuation(state).total;
  return state;
}

test("first rebirth is locked below five million and unlocks at the exact total-assets threshold", () => {
  const game = eligibleGame();
  assert.equal(game.rebirthCount, 0);
  assert.equal(FIRST_REBIRTH_ASSET_REQUIREMENT, 5_000_000);
  assert.ok(game.coins < FIRST_REBIRTH_ASSET_REQUIREMENT);
  assert.equal(saveValuation(game).total, FIRST_REBIRTH_ASSET_REQUIREMENT);
  assert.equal(canFirstRebirth(game), true);
  game.coins -= 1;
  const before = structuredClone(game);
  assert.equal(canFirstRebirth(game), false);
  assert.equal(completeFirstRebirth(game), null);
  assert.deepEqual(game, before);
});

test("first rebirth resets all progress and grants exactly one playable foreman without mutating the old game", () => {
  const game = eligibleGame();
  game.inventory = { raw: 999, cans: 75, rough: 150, refined: 20, screws: 30, rebar: 40, specials: { canOpener: 2, smartLeader: 3, holyLight: 4 } };
  game.schedulerSeconds = 1800;
  game.schedulerBots = 2;
  game.schedulerRobots.push({ efficiency: 5, intervalSeconds: .2, duties: { rest: false, work: true, wake: false } });
  game.research = { synthesis: 3, orders: 2 };
  game.autoCanSupply = game.autoSchedulerSupply = game.schedulerServiceUnlocked = true;
  game.effects = { canOpener: 30, smartLeader: 60, holyLight: [{ id: "holy-light", x: 200, y: 400, remaining: 100 }] };
  game.plotPurchases = { gather: 2, process: 3, synthesis: 1, living: 4 };
  game.plots.push({ ...game.plots[0], id: "extra-gather" });
  game.workers.push({ ...game.workers[0], id: "worker-2" });
  game.processPlots.process = { recipe: "refined", produced: 77, batch: { active: true, progress: .5, reservedRaw: 200 } };
  game.orders = [{ id: "old-order", remaining: 100, processed: { kind: "rough", amount: 20 }, synthesized: { kind: "screws", amount: 10 }, reward: "coins" }];
  game.orderSerial = 9;
  const before = structuredClone(game);
  const reborn = completeFirstRebirth(game);
  assert.ok(reborn);
  assert.deepEqual(game, before);
  assert.equal(reborn.version, 9);
  assert.equal(reborn.rebirthCount, 1);
  assert.equal(reborn.workers.length, 2);
  const [ordinary, foreman] = reborn.workers;
  assert.equal(ordinary.x, 998);
  assert.equal(ordinary.y, 853);
  assert.equal(foreman.id, "foreman-1");
  assert.equal(foreman.name, "包工头");
  assert.equal(foreman.role, "foreman");
  assert.equal(foreman.zoneId, "gather");
  assert.equal(foreman.mood, 100);
  assert.equal(foreman.x, 568.8);
  assert.equal(foreman.y, 413);
  const expected = createInitialState(998, 853);
  expected.rebirthCount = 1;
  assert.deepEqual({ ...reborn, workers: [ordinary] }, expected);
  const stepped = stepGame(reborn, 1, () => 1);
  assert.equal(stepped.inventory.raw, 20);
  assert.equal(stepped.workers.find((worker) => worker.role === "foreman").mood, 100);
});

test("rebirth ownership survives local and exported saves, and blocks a second first-rebirth reward", () => {
  const reborn = completeFirstRebirth(eligibleGame());
  reborn.coins = FIRST_REBIRTH_ASSET_REQUIREMENT;
  const loadedStates = [
    reborn,
    parseSavedState(JSON.stringify(reborn)),
    parseGameSave(exportGameSave(reborn)).state,
  ];
  for (const loaded of loadedStates) {
    assert.deepEqual(loaded, reborn);
    assert.equal(loaded.rebirthCount, 1);
    assert.equal(loaded.workers.filter((worker) => worker.role === "foreman").length, 1);
    assert.equal(canFirstRebirth(loaded), false);
    assert.equal(completeFirstRebirth(loaded), null);
  }
});

test("all legacy save versions migrate to zero rebirths while keeping existing progress", () => {
  for (let version = 1; version <= 8; version++) {
    const legacy = eligibleGame();
    legacy.version = version;
    delete legacy.rebirthCount;
    if (version < 3) legacy.batch = { active: false, progress: 0, reservedRaw: 0 };
    for (const loaded of [parseSavedState(JSON.stringify(legacy)), parseGameSave(JSON.stringify(legacy)).state]) {
      assert.equal(loaded.version, 9);
      assert.equal(loaded.rebirthCount, 0);
      assert.equal(loaded.coins, legacy.coins);
      assert.deepEqual(loaded.inventory, legacy.inventory);
      assert.deepEqual(loaded.workers, legacy.workers);
      assert.equal(canFirstRebirth(loaded), true);
    }
  }
});

test("legacy foreman saves retain their existing guardian and migrate the first reward as already claimed", () => {
  const reborn = completeFirstRebirth(eligibleGame());
  reborn.version = 8;
  reborn.coins = FIRST_REBIRTH_ASSET_REQUIREMENT;
  delete reborn.rebirthCount;
  for (const loaded of [parseSavedState(JSON.stringify(reborn)), parseGameSave(JSON.stringify(reborn)).state]) {
    assert.equal(loaded.rebirthCount, 1);
    assert.deepEqual(loaded.workers, reborn.workers);
    assert.equal(canFirstRebirth(loaded), false);
    assert.equal(completeFirstRebirth(loaded), null);
  }
});

test("current save records cannot omit, forge or contradict rebirth ownership", () => {
  for (const count of [undefined, null, "1", -1, .5, 2, true]) {
    const broken = { ...eligibleGame(), rebirthCount: count };
    assert.equal(parseSavedState(JSON.stringify(broken)), null);
    assert.throws(() => parseGameSave(JSON.stringify(broken)), /转生次数/);
    assert.throws(() => exportGameSave(broken), /转生次数/);
  }
  const missingReward = { ...eligibleGame(), rebirthCount: 1 };
  const unrecordedReward = { ...completeFirstRebirth(eligibleGame()), rebirthCount: 0 };
  const duplicateReward = completeFirstRebirth(eligibleGame());
  duplicateReward.workers.push({ ...duplicateReward.workers[1], id: "foreman-2" });
  for (const broken of [missingReward, unrecordedReward, duplicateReward]) {
    assert.equal(parseSavedState(JSON.stringify(broken)), null);
    assert.throws(() => parseGameSave(JSON.stringify(broken)), /无效/);
    assert.throws(() => exportGameSave(broken), /无效/);
    assert.equal(canFirstRebirth(broken), false);
    assert.equal(completeFirstRebirth(broken), null);
  }
});

test("separate rebirth results share no mutable state with each other or ordinary new games", () => {
  const first = completeFirstRebirth(eligibleGame());
  const second = completeFirstRebirth(eligibleGame());
  const expected = structuredClone(second);
  first.inventory.cans = 0;
  first.plots[0].enabled = false;
  first.workers[1].mood = 0;
  first.research.synthesis = 5;
  assert.deepEqual(second, expected);
  const ordinary = createInitialState(998, 853);
  assert.equal(ordinary.rebirthCount, 0);
  assert.equal(ordinary.workers.length, 1);
});
