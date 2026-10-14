import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, buyWorker, sellProducts, useSpecialItem as consumeSpecialItem, stepGame, parseSavedState, upgradeSchedulerEfficiency, SCHEDULER_EFFICIENCY_MAX } from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import { isInfiniteResourcePreview, previewStorageKey, replenishPreviewResources, PREVIEW_RESOURCE_FLOOR, PREVIEW_SCHEDULER_SECONDS } from "../app/preview-resources.ts";

const preview = new URL("http://127.0.0.1:49224/");
const materials = ["raw", "cans", "rough", "refined", "screws", "rebar"];
const specials = ["canOpener", "smartLeader", "holyLight"];

test("infinite resources are scoped to the fixed local preview origin", () => {
  assert.equal(isInfiniteResourcePreview(preview), true);
  assert.equal(isInfiniteResourcePreview(null), false);
  assert.equal(isInfiniteResourcePreview(), false);
  for (const address of ["https://127.0.0.1:49224/", "http://127.0.0.1:3000/", "https://plot-workers.example/", "http://plot-workers.example:49224/"]) {
    assert.equal(isInfiniteResourcePreview(new URL(address)), false, address);
  }
  assert.equal(createInitialState(0, 0).coins, 100);
});

test("preview progress and backup keys do not overwrite normal save slots", () => {
  for (const key of ["green-realm-save-v1", "green-realm-save-backup-v1"]) {
    assert.equal(previewStorageKey(key, preview), `${key}-infinite-preview`);
    assert.equal(previewStorageKey(key, new URL("https://plot-workers.example/")), key);
    assert.equal(previewStorageKey(key, null), key);
    assert.equal(previewStorageKey(key), key);
  }
});

test("resource replenishment preserves the workshop and does not mutate its input", () => {
  const source = createInitialState(0, 0);
  source.plots[0].x = 237;
  source.schedulerRobots[0].duties.rest = false;
  const original = structuredClone(source);
  const filled = replenishPreviewResources(source);
  assert.deepEqual(source, original);
  assert.equal(filled.coins, PREVIEW_RESOURCE_FLOOR);
  for (const kind of materials) assert.equal(filled.inventory[kind], PREVIEW_RESOURCE_FLOOR);
  for (const kind of specials) assert.equal(filled.inventory.specials[kind], PREVIEW_RESOURCE_FLOOR);
  assert.equal(filled.schedulerSeconds, PREVIEW_SCHEDULER_SECONDS);
  assert.equal(filled.schedulerServiceUnlocked, true);
  for (const key of ["plots", "workers", "processPlots", "synthesisPlots", "market", "schedulerRobots", "orders", "research", "effects", "plotPurchases"]) {
    assert.equal(filled[key], source[key], key);
  }
  assert.equal(filled.schedulerBots, source.schedulerBots);
  assert.equal(filled.rebirthCount, source.rebirthCount);
  assert.equal(filled.autoCanSupply, source.autoCanSupply);
  assert.equal(filled.autoSchedulerSupply, source.autoSchedulerSupply);
});

test("repeated purchases, consumption and simulation replenish all reserves", () => {
  let game = replenishPreviewResources(createInitialState(0, 0));
  for (let cycle = 0; cycle < 3; cycle++) {
    game = replenishPreviewResources(buyWorker(game, 0, 0));
    game = replenishPreviewResources(sellProducts(game, "all"));
    game = replenishPreviewResources(consumeSpecialItem(game, "canOpener"));
    game = replenishPreviewResources(stepGame(game, 5, () => 1));
    assert.ok(game.coins >= PREVIEW_RESOURCE_FLOOR);
    for (const kind of materials) assert.ok(game.inventory[kind] >= PREVIEW_RESOURCE_FLOOR);
    for (const kind of specials) assert.ok(game.inventory.specials[kind] >= PREVIEW_RESOURCE_FLOOR);
    assert.equal(game.schedulerSeconds, PREVIEW_SCHEDULER_SECONDS);
  }
  assert.equal(game.workers.length, createInitialState(0, 0).workers.length + 3);
  assert.equal(buyWorker(game, 0, 0), game, "full living plots still limit worker purchases");
});

test("replenishment preserves larger balances and stable references once full", () => {
  const filled = replenishPreviewResources(createInitialState(0, 0));
  filled.coins += 500;
  filled.inventory.raw += 10;
  assert.equal(replenishPreviewResources(filled), filled);
  const spent = { ...filled, coins: 100 };
  const refilled = replenishPreviewResources(spent);
  assert.equal(refilled.inventory, spent.inventory);
  assert.equal(refilled.inventory.specials, spent.inventory.specials);
  assert.equal(refilled.inventory.raw, PREVIEW_RESOURCE_FLOOR + 10);
});

test("infinite resources do not bypass robot efficiency caps", () => {
  let game = replenishPreviewResources(createInitialState(0, 0));
  for (let index = 0; index < 40; index++) game = replenishPreviewResources(upgradeSchedulerEfficiency(game, 0));
  assert.equal(game.schedulerRobots[0].efficiency, SCHEDULER_EFFICIENCY_MAX);
  assert.equal(upgradeSchedulerEfficiency(game, 0), game);
});

test("preview resources roundtrip through both save formats as finite values", () => {
  const filled = replenishPreviewResources(createInitialState(0, 0));
  for (const restored of [parseSavedState(JSON.stringify(filled)), parseGameSave(exportGameSave(filled)).state]) {
    assert.ok(restored);
    assert.equal(restored.coins, PREVIEW_RESOURCE_FLOOR);
    assert.equal(restored.schedulerSeconds, PREVIEW_SCHEDULER_SECONDS);
    for (const kind of materials) assert.equal(restored.inventory[kind], PREVIEW_RESOURCE_FLOOR);
    for (const kind of specials) assert.equal(restored.inventory.specials[kind], PREVIEW_RESOURCE_FLOOR);
  }
  function checkFinite(value) {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
    else if (value && typeof value === "object") Object.values(value).forEach(checkFinite);
  }
  checkFinite(filled);
});
