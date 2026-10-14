import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, buyCans, buyWorker, sellProducts, useSpecialItem as consumeSpecialItem, stepGame, parseSavedState, upgradeSchedulerEfficiency, SCHEDULER_EFFICIENCY_MAX } from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import { isLocalResourcePreview, isInfiniteResourcePreview, previewStorageKey, grantPreviewTestItems, createFinitePreviewState, replenishPreviewResources, PREVIEW_RESOURCE_FLOOR, PREVIEW_SCHEDULER_SECONDS } from "../app/preview-resources.ts";

const preview = new URL("http://127.0.0.1:49224/");
const infinitePreview = new URL("http://127.0.0.1:49224/?resources=infinite");
const materials = ["raw", "cans", "rough", "refined", "screws", "rebar"];
const specials = ["canOpener", "smartLeader", "holyLight", "orderRefresh", "goldenOrder"];

test("local preview starts finite and infinite resources require an explicit option at the fixed origin", () => {
  assert.equal(isLocalResourcePreview(preview), true);
  assert.equal(isLocalResourcePreview(infinitePreview), true);
  assert.equal(isLocalResourcePreview(null), false);
  assert.equal(isLocalResourcePreview(), false);
  assert.equal(isInfiniteResourcePreview(preview), false);
  assert.equal(isInfiniteResourcePreview(infinitePreview), true);
  assert.equal(isInfiniteResourcePreview(null), false);
  assert.equal(isInfiniteResourcePreview(), false);
  for (const query of ["?resources=finite", "?resources=", "?resources=INFINITE", "?infinite=true", "?resources=finite&resources=infinite"]) {
    assert.equal(isInfiniteResourcePreview(new URL(query, preview)), false, query);
  }
  for (const address of ["https://127.0.0.1:49224/", "http://127.0.0.1:3000/", "http://localhost:49224/", "https://plot-workers.example/", "http://plot-workers.example:49224/"]) {
    const location = new URL("?resources=infinite", address);
    assert.equal(isLocalResourcePreview(location), false, address);
    assert.equal(isInfiniteResourcePreview(location), false, address);
  }
  assert.equal(createInitialState(0, 0).coins, 100);
});

test("finite, infinite and normal progress and backup slots remain separate", () => {
  for (const key of ["green-realm-save-v1", "green-realm-save-backup-v1"]) {
    assert.equal(previewStorageKey(key, preview), `${key}-finite-preview`);
    assert.equal(previewStorageKey(key, infinitePreview), `${key}-infinite-preview`);
    assert.equal(previewStorageKey(key, new URL("?resources=finite", preview)), `${key}-finite-preview`);
    assert.equal(previewStorageKey(key, new URL("https://plot-workers.example/?resources=infinite")), key);
    assert.equal(previewStorageKey(key, new URL("https://plot-workers.example/")), key);
    assert.equal(previewStorageKey(key, null), key);
    assert.equal(previewStorageKey(key), key);
  }
});

test("local finite preview receives twenty of each special once and preserves the workshop", () => {
  const source = createInitialState(0, 0);
  source.inventory.specials.smartLeader = 3;
  const original = structuredClone(source);
  const saveKey = previewStorageKey("green-realm-save-v1", preview);
  const grantKey = `${saveKey}-special-items-20-20261014`;
  const values = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
  };
  const granted = grantPreviewTestItems(source, storage, saveKey, preview);
  assert.deepEqual(source, original);
  for (const kind of specials) assert.equal(granted.inventory.specials[kind], source.inventory.specials[kind] + 20, kind);
  for (const kind of materials) assert.equal(granted.inventory[kind], source.inventory[kind], kind);
  for (const key of Object.keys(source).filter((key) => key !== "inventory")) assert.equal(granted[key], source[key], key);
  assert.deepEqual(JSON.parse(values.get(saveKey)), granted);
  assert.deepEqual(writes, [saveKey, grantKey], "save the granted items before recording their receipt");
  assert.equal(grantPreviewTestItems(granted, storage, saveKey, preview), granted);
  assert.deepEqual(writes, [saveKey, grantKey], "reload must not grant or save again");
  const consumed = consumeSpecialItem(granted, "canOpener");
  storage.setItem(saveKey, JSON.stringify(consumed));
  const reloaded = parseSavedState(values.get(saveKey));
  assert.equal(grantPreviewTestItems(reloaded, storage, saveKey, preview), reloaded);
  assert.equal(reloaded.inventory.specials.canOpener, 19, "consumed items must not be replenished on reload");
});

test("an existing test-pack marker prevents a second grant regardless of its value", () => {
  const source = createInitialState(0, 0);
  const storage = { getItem: () => "", setItem: () => assert.fail("must not write an already-issued pack") };
  assert.equal(grantPreviewTestItems(source, storage, "finite-preview-save", preview), source);
});

test("test items never affect infinite preview or other addresses", () => {
  const source = createInitialState(0, 0);
  const storage = {
    getItem: () => assert.fail("must not read storage outside finite preview"),
    setItem: () => assert.fail("must not write storage outside finite preview"),
  };
  for (const location of [infinitePreview, null, new URL("http://127.0.0.1:3000/"), new URL("http://localhost:49224/"), new URL("https://127.0.0.1:49224/"), new URL("https://plot-workers.example/")]) {
    assert.equal(grantPreviewTestItems(source, storage, "save", location), source);
  }
  assert.equal(grantPreviewTestItems(source, storage, "save"), source);
});

test("test-pack storage failures propagate without mutating or returning the granted state", () => {
  for (const failAt of ["read", "save", "marker"]) {
    const source = createInitialState(0, 0);
    const original = structuredClone(source);
    const error = new Error(`${failAt} failed`);
    const writes = [];
    const storage = {
      getItem: () => { if (failAt === "read") throw error; return null; },
      setItem: (key) => {
        writes.push(key);
        if ((failAt === "save" && writes.length === 1) || (failAt === "marker" && writes.length === 2)) throw error;
      },
    };
    assert.throws(() => grantPreviewTestItems(source, storage, "save", preview), (caught) => caught === error);
    assert.deepEqual(source, original);
    assert.equal(writes.length, failAt === "read" ? 0 : failAt === "save" ? 1 : 3);
  }
});

test("a failed test-pack marker restores the previous save before allowing a retry", () => {
  const source = createInitialState(0, 0);
  const originalSave = JSON.stringify(source);
  const values = new Map([["save", originalSave]]);
  const error = new Error("marker failed");
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key !== "save") throw error;
      values.set(key, value);
    },
  };
  assert.throws(() => grantPreviewTestItems(source, storage, "save", preview), (caught) => caught === error);
  assert.equal(values.get("save"), originalSave);
  assert.equal(values.has("save-special-items-20-20261014"), false);
});

test("finite conversion preserves the factory, active plan and batches without mutating the source", () => {
  const source = replenishPreviewResources(createInitialState(0, 0));
  source.plots[0].x = 237;
  source.schedulerRobots[0].duties.rest = false;
  source.research.planning = 1;
  source.processPlots.process.batch = { active: true, progress: .4, reservedRaw: 75 };
  source.synthesisPlots["qa-synthesis"] = { recipe: "rebar", produced: 2, batch: { active: true, progress: .6, reserved: { rough: 10, refined: 5, screws: 2 } } };
  source.productionPlan = { orderId: "qa-order", phase: "tracking", process: { process: "rough" }, synthesis: { "qa-synthesis": "cans" }, pausedPlotIds: [] };
  source.inventory.specials.smartLeader = 3;
  const original = structuredClone(source);
  const finite = createFinitePreviewState(source);
  assert.deepEqual(source, original, "conversion must never edit the unlimited save in memory");
  assert.equal(finite.coins, 100_000);
  assert.equal(finite.inventory.raw, 10_000);
  assert.equal(finite.inventory.cans, 1_000);
  assert.equal(finite.schedulerSeconds, 1_800);
  for (const kind of ["rough", "refined", "screws", "rebar"]) assert.equal(finite.inventory[kind], 0, kind);
  assert.deepEqual(finite.inventory.specials, { canOpener: 0, smartLeader: 3, holyLight: 0, orderRefresh: 0, goldenOrder: 0 });
  for (const key of ["plots", "workers", "processPlots", "synthesisPlots", "schedulerRobots", "research", "productionPlan", "orders", "effects", "plotPurchases", "market"]) {
    assert.equal(finite[key], source[key], key);
  }
  for (const key of ["schedulerBots", "schedulerServiceUnlocked", "rebirthCount", "autoCanSupply", "autoSchedulerSupply"]) assert.equal(finite[key], source[key], key);
  assert.deepEqual(finite.processPlots.process.batch, original.processPlots.process.batch);
  assert.deepEqual(finite.synthesisPlots["qa-synthesis"].batch.reserved, original.synthesisPlots["qa-synthesis"].batch.reserved);
});

test("finite conversion does not grant extra supplies and clears only unlimited special items", () => {
  const source = createInitialState(0, 0);
  source.coins = 12_345;
  source.inventory.raw = 456;
  source.inventory.cans = 789;
  source.schedulerSeconds = 900;
  source.inventory.rough = 2;
  source.inventory.refined = 3;
  source.inventory.screws = 4;
  source.inventory.rebar = 5;
  source.inventory.specials = { canOpener: PREVIEW_RESOURCE_FLOOR - 1, smartLeader: PREVIEW_RESOURCE_FLOOR, holyLight: PREVIEW_RESOURCE_FLOOR + 1, orderRefresh: PREVIEW_RESOURCE_FLOOR, goldenOrder: 2 };
  const finite = createFinitePreviewState(source);
  assert.equal(finite.coins, source.coins);
  assert.equal(finite.inventory.raw, source.inventory.raw);
  assert.equal(finite.inventory.cans, source.inventory.cans);
  assert.equal(finite.schedulerSeconds, source.schedulerSeconds);
  for (const kind of ["rough", "refined", "screws", "rebar"]) assert.equal(finite.inventory[kind], 0, kind);
  assert.deepEqual(finite.inventory.specials, { canOpener: PREVIEW_RESOURCE_FLOOR - 1, smartLeader: 0, holyLight: 0, orderRefresh: 0, goldenOrder: 2 });
});

test("a converted workshop spends normally and cannot overwrite the old unlimited slot", () => {
  const key = "green-realm-save-v1";
  const unlimited = replenishPreviewResources(createInitialState(0, 0));
  const unlimitedJson = JSON.stringify(unlimited);
  const slots = new Map([[previewStorageKey(key, infinitePreview), unlimitedJson]]);
  let finite = createFinitePreviewState(unlimited);
  finite = buyWorker(finite, 0, 0);
  finite = buyCans(finite, 10);
  finite = stepGame(finite, 1, () => 1);
  assert.equal(finite.coins, 99_880);
  assert.equal(finite.inventory.cans, 1_010);
  assert.equal(finite.schedulerSeconds, 1_799);
  slots.set(previewStorageKey(key, preview), JSON.stringify(finite));
  assert.equal(slots.get(previewStorageKey(key, infinitePreview)), unlimitedJson);
  assert.equal(JSON.parse(slots.get(previewStorageKey(key, preview))).coins, 99_880);
  assert.equal(slots.has(key), false, "test mode must not create or replace the ordinary save slot");
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
  game.research.management = 1;
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
