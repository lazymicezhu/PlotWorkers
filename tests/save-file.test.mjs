import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, stepGame, upgradeSchedulerEfficiency, buyResearch } from "../app/game-engine.ts";
import { MAX_SAVE_FILE_BYTES, exportGameSave, parseGameSave } from "../app/save-file.ts";

const initial = () => createInitialState(100, 200);
const parse = (state) => parseGameSave(JSON.stringify(state)).state;

function advancedSave() {
  let game = initial();
  game.coins = 200_000;
  game = upgradeSchedulerEfficiency(game, 0);
  game = buyResearch(game, "synthesis");
  game.inventory = { ...game.inventory, raw: 5432, rough: 99, refined: 51, screws: 24, rebar: 12, specials: { canOpener: 1, smartLeader: 2, holyLight: 3 } };
  game.plots.push({ id: "synthesis-1", name: "合成区", type: "synthesis", x: 5, y: -20, cols: 4, rows: 4, purchasePrice: 300, enabled: true });
  game.processPlots.process = { recipe: "refined", produced: 12, batch: { active: true, progress: .55, reservedRaw: 200 } };
  game.synthesisPlots["synthesis-1"] = { recipe: "rebar", produced: 30, batch: { active: true, progress: .42, reserved: { rough: 10, refined: 5, screws: 2 } } };
  game.orders = [{ id: "order-1", remaining: 178, processed: { kind: "rough", amount: 20 }, synthesized: { kind: "rebar", amount: 10 }, reward: "special" }];
  game.orderSerial = 1;
  game.effects = { canOpener: 45, smartLeader: 150, holyLight: [{ id: "holy-light", x: -5, y: 30, remaining: 100 }] };
  game.autoCanSupply = true;
  game.autoSchedulerSupply = true;
  game.schedulerServiceUnlocked = true;
  game.schedulerSeconds = 357;
  game.plotPurchases.synthesis = 1;
  return game;
}

test("save package round trip retains economy, upgrades, orders and reserved batches", () => {
  const game = advancedSave();
  const before = structuredClone(game);
  const file = exportGameSave(game, new Date("2026-10-10T01:02:03.000Z"));
  const envelope = JSON.parse(file);
  assert.equal(envelope.format, "plot-workers-save");
  assert.equal(envelope.formatVersion, 1);
  const loaded = parseGameSave(file);
  assert.equal(loaded.exportedAt, "2026-10-10T01:02:03.000Z");
  assert.deepEqual(loaded.state, game);
  assert.deepEqual(game, before, "export never changes the live game");
  assert.doesNotThrow(() => stepGame(loaded.state, 1, () => .5));
});

test("older robot efficiency above 150 percent imports at the new cap", () => {
  const game = advancedSave();
  game.schedulerRobots[0].efficiency = 2.1;
  const loaded = parse(game);
  assert.equal(loaded.schedulerRobots[0].efficiency, 1.5);
  assert.equal(loaded.coins, game.coins);
  assert.equal(game.schedulerRobots[0].efficiency, 2.1, "import does not mutate its source");
});

test("export restores temporary dragging to playable status without returning reserved materials", () => {
  const game = advancedSave();
  game.workers[0].status = "dragging";
  game.workers[0].moving = true;
  const loaded = parseGameSave(exportGameSave(game)).state;
  assert.equal(loaded.workers[0].status, "ready");
  assert.equal("moving" in loaded.workers[0], false);
  assert.deepEqual(loaded.inventory, game.inventory);
  assert.deepEqual(loaded.synthesisPlots, game.synthesisPlots);
});

test("real fractional can consumption exports at zero despite floating point round-off", () => {
  let negativeRemainders = 0;
  for (let i = 1; i <= 500; i++) {
    const game = initial();
    game.inventory.cans = i / 50_003;
    game.workers[0].mood = 1;
    game.workers[0].status = "resting";
    const consumed = stepGame(game, 1, () => .5);
    if (consumed.inventory.cans < 0) negativeRemainders++;
    const loaded = parseGameSave(exportGameSave(consumed)).state;
    assert.ok(loaded.inventory.cans >= 0);
    assert.ok(loaded.inventory.cans <= 1e-12);
  }
  assert.ok(negativeRemainders > 0, "exercise actual negative float tails from the engine");
  const invalid = initial();
  invalid.inventory.cans = -0.001;
  assert.throws(() => exportGameSave(invalid), /库存.cans/);
  assert.throws(() => parse(invalid), /库存.cans/);
});

test("bare legacy version 1 migrates original recipe, batch and retired injury", () => {
  const legacy = initial();
  legacy.version = 1;
  legacy.recipe = "refined";
  legacy.recipeProduced = 7;
  legacy.batch = { active: true, progress: .3, reservedRaw: 200 };
  legacy.workers[0].status = "unconscious";
  legacy.workers[0].mood = 0;
  delete legacy.plots;
  delete legacy.processPlots;
  delete legacy.synthesisPlots;
  delete legacy.schedulerRobots;
  delete legacy.inventory.screws;
  delete legacy.inventory.rebar;
  delete legacy.inventory.specials;
  delete legacy.research;
  delete legacy.effects;
  delete legacy.plotPurchases;
  const { state, exportedAt } = parseGameSave(JSON.stringify(legacy));
  assert.equal(exportedAt, null);
  assert.equal(state.version, 9);
  assert.equal(state.processPlots.process.recipe, "refined");
  assert.deepEqual(state.processPlots.process.batch, legacy.batch);
  assert.equal(state.workers[0].status, "ready");
  assert.equal(state.workers[0].mood, 100);
  assert.deepEqual(state.inventory.specials, { canOpener: 0, smartLeader: 0, holyLight: 0 });
});

test("all supported bare save versions can be loaded", () => {
  for (let version = 1; version <= 9; version++) {
    const game = initial();
    game.version = version;
    if (version < 3) game.batch = { active: false, progress: 0, reservedRaw: 0 };
    assert.equal(parse(game).version, 9);
  }
});

test("a valid historical workplace may refer to a plot that was recycled", () => {
  const game = initial();
  game.workers[0].lastWorkZoneId = "recycled-plot";
  assert.equal(parse(game).workers[0].lastWorkZoneId, "recycled-plot");
});

test("malformed JSON, unrelated packages and future formats are rejected with player-readable errors", () => {
  for (const value of ["", "not json", "{broken", "null", "[]"]) assert.throws(() => parseGameSave(value), /存档|JSON/);
  assert.throws(() => parseGameSave(JSON.stringify({ format: "another-game" })), /不是 Plot Workers/);
  assert.throws(() => parseGameSave(JSON.stringify({ format: "plot-workers-save", formatVersion: 2 })), /版本/);
  assert.throws(() => parse({ ...initial(), version: 10 }), /较新版本/);
});

test("oversize files and robot allocation attacks are rejected before migration", () => {
  assert.throws(() => parseGameSave(" ".repeat(MAX_SAVE_FILE_BYTES + 1)), /5 MB/);
  assert.throws(() => parse({ ...initial(), schedulerBots: 1_000_000_000 }), /机器人数量/);
  const game = initial();
  game.workers = Array(10_001).fill(game.workers[0]);
  assert.throws(() => parse(game), /数量过多/);
});

test("missing inventories and unsafe numeric values cannot enter the live game", () => {
  for (const key of ["raw", "cans", "rough", "refined"]) {
    const game = initial();
    delete game.inventory[key];
    assert.throws(() => parse(game), /库存/);
  }
  for (const coins of [-1, null, "100", Number.MAX_VALUE]) assert.throws(() => parse({ ...initial(), coins }), /无效/);
  assert.throws(() => parseGameSave(JSON.stringify(initial()).replace('"coins":100', '"coins":1e400')), /数值范围/);
  const game = initial();
  game.inventory.raw = NaN;
  assert.throws(() => exportGameSave(game), /数值范围/);
});

test("invalid plot identity, geometry, worker attributes and references are rejected", () => {
  const changes = [
    (game) => { game.plots.push({ ...game.plots[0] }); },
    (game) => { game.plots[0].id = "__proto__"; },
    (game) => { game.plots[0].type = "unknown"; },
    (game) => { game.plots[0].rows = 0; },
    (game) => { game.workers[0].zoneId = "missing"; },
    (game) => { game.workers[0].efficiency = null; },
    (game) => { game.workers[0].status = "unknown"; },
    (game) => { game.workers[0].x = "12"; },
  ];
  for (const change of changes) { const game = initial(); change(game); assert.throws(() => parse(game), /无效/); }
});

test("broken production recipes, progress and reserved inventory are rejected", () => {
  const changes = [
    (game) => { game.processPlots.process.recipe = "unknown"; },
    (game) => { game.processPlots.process.batch.progress = -.5; },
    (game) => { game.processPlots.process.batch.progress = 2; },
    (game) => { game.processPlots.process.batch.active = "yes"; },
    (game) => { game.synthesisPlots["synthesis-1"].batch.reserved.rough = -1; },
    (game) => { game.synthesisPlots["synthesis-1"].batch.reserved.coins = 500; },
  ];
  for (const change of changes) { const game = advancedSave(); change(game); assert.throws(() => parse(game), /无效/); }
});

test("orders, robot duties and timed effects must be safe for render and simulation", () => {
  const changes = [
    (game) => { game.orders[0].processed = null; },
    (game) => { game.orders[0].synthesized.kind = "cans"; },
    (game) => { game.orders[0].processed.amount = "20"; },
    (game) => { game.orders[0].reward = "unknown"; },
    (game) => { game.orders = [{}]; },
    (game) => { game.orders[0].remaining = "100"; },
    (game) => { game.schedulerRobots[0].duties.work = "yes"; },
    (game) => { game.schedulerRobots[0].efficiency = -1; },
    (game) => { game.schedulerRobots[0] = null; },
    (game) => { game.inventory.screws = null; },
    (game) => { game.research.orders = "2"; },
    (game) => { game.effects.holyLight[0].remaining = "100"; },
    (game) => { game.effects.smartLeader = "abc"; },
  ];
  for (const change of changes) { const game = advancedSave(); change(game); assert.throws(() => parse(game), /无效/); }
});

test("UTF-8 byte limits and optional BOM are handled consistently", () => {
  const file = exportGameSave(initial());
  assert.deepEqual(parseGameSave(`\uFEFF${file}`).state, initial());
  assert.throws(() => parseGameSave("中".repeat(Math.ceil(MAX_SAVE_FILE_BYTES / 3))), /5 MB/);
});
