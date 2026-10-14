import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, parseSavedState, placeHolyLight, stepGame } from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";

const fresh = () => createInitialState(0, 0);
const tick = (game) => stepGame(game, 1, () => 1);
const center = (plot) => ({ x: plot.x + plot.rows * 52, y: plot.y + plot.rows * 27 });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

function advance(game, seconds) {
  for (let second = 0; second < seconds; second += 1) game = tick(game);
  return game;
}

function factories() {
  const game = fresh();
  game.plots.find((plot) => plot.id === "process").x = 3000;
  game.plots.push(
    { ...game.plots.find((plot) => plot.id === "gather"), id: "synthesis", type: "synthesis", x: 6000 },
    { ...game.plots.find((plot) => plot.id === "gather"), id: "unlit", x: 9000 },
  );
  game.workers = ["gather", "process", "synthesis", "unlit"].map((zoneId) => ({
    ...game.workers[0], id: `worker-${zoneId}`, zoneId, status: "idle", mood: 100,
  }));
  game.processPlots.process.batch = { active: true, progress: 0, reservedRaw: 75 };
  game.synthesisPlots.synthesis = { recipe: "cans", produced: 0, batch: { active: true, progress: 0, reserved: { rough: 10 } } };
  return game;
}

function illuminate(game, plotId) {
  const point = center(game.plots.find((plot) => plot.id === plotId));
  return placeHolyLight(game, point.x, point.y);
}

test("each holy light placement consumes one item and preserves earlier circles", () => {
  const game = fresh();
  assert.deepEqual(game.effects.holyLight, []);
  game.inventory.specials.holyLight = 3;
  const before = structuredClone(game);
  let lit = placeHolyLight(game, -100, 200);
  assert.deepEqual(game, before, "placement must not mutate the previous state");
  assert.equal(lit.effects.holyLight.length, 1);
  assert.equal(typeof lit.effects.holyLight[0].id, "string");
  assert.ok(lit.effects.holyLight[0].id.length > 0);
  const first = structuredClone(lit.effects.holyLight[0]);
  lit = placeHolyLight(lit, 3000, -400);
  lit = placeHolyLight(lit, 3000, -400);
  assert.equal(lit.inventory.specials.holyLight, 0);
  assert.deepEqual(lit.effects.holyLight[0], first);
  assert.deepEqual(lit.effects.holyLight.map(({ x, y, remaining }) => ({ x, y, remaining })), [
    { x: -100, y: 200, remaining: 60 },
    { x: 3000, y: -400, remaining: 60 },
    { x: 3000, y: -400, remaining: 60 },
  ]);
  assert.equal(new Set(lit.effects.holyLight.map(({ id }) => id)).size, 3);
  assert.equal(placeHolyLight(lit, 0, 0), lit, "empty inventory must not add or reset a circle");
});

test("holy light circles keep independent countdowns and expire individually", () => {
  let game = fresh();
  game.inventory.specials.holyLight = 3;
  game = placeHolyLight(game, 100, 200);
  const firstId = game.effects.holyLight[0].id;
  game = advance(game, 12);
  game = placeHolyLight(game, 3000, 400);
  const secondId = game.effects.holyLight[1].id;
  assert.deepEqual(game.effects.holyLight.map(({ remaining }) => remaining), [48, 60]);
  const before = structuredClone(game.effects.holyLight);
  const next = tick(game);
  assert.deepEqual(game.effects.holyLight, before, "countdowns must not mutate the previous state");
  assert.deepEqual(next.effects.holyLight.map(({ id }) => id), [firstId, secondId]);
  assert.deepEqual(next.effects.holyLight.map(({ remaining }) => remaining), [47, 59]);
  game = advance(next, 47);
  assert.deepEqual(game.effects.holyLight, [{ id: secondId, x: 3000, y: 400, remaining: 12 }]);
  const replacement = placeHolyLight(game, 5000, 600);
  assert.equal(replacement.effects.holyLight.length, 2);
  assert.deepEqual(replacement.effects.holyLight[0], game.effects.holyLight[0]);
  assert.notEqual(replacement.effects.holyLight[1].id, secondId, "replacing an expired circle must not reuse a surviving circle's id");
  assert.equal(replacement.effects.holyLight[1].remaining, 60);
  assert.deepEqual(advance(game, 12).effects.holyLight, []);
});

test("separate holy lights boost gathering, processing and synthesis while unlit workers still lose mood", () => {
  let game = factories();
  game.inventory.specials.holyLight = 3;
  const normal = tick(game);
  for (const plotId of ["gather", "process", "synthesis"]) game = illuminate(game, plotId);
  const lit = tick(game);
  assert.equal(normal.inventory.raw, 20);
  assert.equal(lit.inventory.raw, 30);
  close(lit.processPlots.process.batch.progress, normal.processPlots.process.batch.progress * 2);
  close(lit.synthesisPlots.synthesis.batch.progress, normal.synthesisPlots.synthesis.batch.progress * 2);
  assert.deepEqual(lit.workers.map(({ mood }) => mood), [100, 100, 100, 99]);
  assert.deepEqual(normal.workers.map(({ mood }) => mood), [99, 99, 99, 99]);
});

test("overlapping holy lights grant only one production bonus and keep protection when one expires", () => {
  let game = factories();
  game.inventory.specials.holyLight = 6;
  for (const plotId of ["gather", "process", "synthesis"]) game = illuminate(game, plotId);
  const once = tick(game);
  for (const plotId of ["gather", "process", "synthesis"]) game = illuminate(game, plotId);
  const overlapped = tick(game);
  assert.equal(overlapped.effects.holyLight.length, 6);
  assert.deepEqual(overlapped.inventory, { ...once.inventory, specials: overlapped.inventory.specials });
  assert.deepEqual(overlapped.processPlots, once.processPlots);
  assert.deepEqual(overlapped.synthesisPlots, once.synthesisPlots);
  assert.deepEqual(overlapped.workers, once.workers);

  game.effects.holyLight[0].remaining = 1;
  const partlyExpired = tick(game);
  assert.equal(partlyExpired.effects.holyLight.length, 5);
  assert.equal(partlyExpired.inventory.raw, once.inventory.raw);
  assert.equal(partlyExpired.workers[0].mood, 100);
});

test("expiring one area's holy light removes only that area's production and mood protection", () => {
  let game = factories();
  game.inventory.specials.holyLight = 3;
  for (const plotId of ["gather", "process", "synthesis"]) game = illuminate(game, plotId);
  game.effects.holyLight[0].remaining = 1;
  const next = tick(game);
  assert.equal(next.effects.holyLight.length, 2);
  assert.equal(next.inventory.raw, 20);
  close(next.processPlots.process.batch.progress, .2);
  close(next.synthesisPlots.synthesis.batch.progress, 2 / 60);
  assert.deepEqual(next.workers.map(({ mood }) => mood), [99, 100, 100, 99]);
});

test("local and exported saves preserve every holy light's id, order, position and countdown", () => {
  const game = fresh();
  game.effects.holyLight = [
    { id: "second-by-name", x: -15.5, y: 300, remaining: 12.25 },
    { id: "first-by-name", x: 2100, y: -80.25, remaining: 57.5 },
  ];
  const before = structuredClone(game);
  const restored = [parseSavedState(JSON.stringify(game)), parseGameSave(exportGameSave(game)).state];
  for (const loaded of restored) {
    assert.deepEqual(loaded.effects.holyLight, game.effects.holyLight);
    assert.deepEqual(tick(loaded).effects.holyLight, game.effects.holyLight.map((effect) => ({ ...effect, remaining: effect.remaining - 1 })));
    loaded.inventory.specials.holyLight = 1;
    const added = placeHolyLight(loaded, 5000, 5000);
    assert.deepEqual(added.effects.holyLight.slice(0, 2), game.effects.holyLight);
    assert.equal(new Set(added.effects.holyLight.map(({ id }) => id)).size, 3);
  }
  assert.deepEqual(game, before);
});

for (const version of [8, 9]) {
  test(`version ${version} legacy single holy light migrates without losing remaining time`, () => {
    const game = fresh();
    game.version = version;
    game.effects.holyLight = { x: -150, y: 200.5, remaining: 123.75 };
    const raw = JSON.stringify(game);
    const states = [parseSavedState(raw), parseGameSave(raw).state];
    for (const loaded of states) {
      assert.equal(loaded.version, 9);
      assert.equal(loaded.effects.holyLight.length, 1);
      const { id, ...effect } = loaded.effects.holyLight[0];
      assert.equal(typeof id, "string");
      assert.ok(id.length > 0);
      assert.deepEqual(effect, game.effects.holyLight);
      assert.equal(tick(loaded).effects.holyLight[0].remaining, 122.75);
      assert.deepEqual(parseGameSave(exportGameSave(loaded)).state.effects.holyLight, loaded.effects.holyLight);
    }
    assert.deepEqual(states[0].effects.holyLight, states[1].effects.holyLight);
  });

  test(`version ${version} legacy empty holy light loads as an empty collection`, () => {
    const game = fresh();
    game.version = version;
    game.effects.holyLight = null;
    const raw = JSON.stringify(game);
    for (const loaded of [parseSavedState(raw), parseGameSave(raw).state]) assert.deepEqual(loaded.effects.holyLight, []);
  });
}

test("malformed multiple holy lights are rejected by both local loading and file import", () => {
  const effect = { id: "valid", x: 20, y: -50, remaining: 45 };
  const invalidCollections = [
    [null],
    [12],
    [[effect]],
    [{ x: 20, y: -50, remaining: 45 }],
    [{ ...effect, id: "" }],
    [{ ...effect, id: 12 }],
    [{ ...effect, x: "20" }],
    [{ ...effect, y: null }],
    [{ ...effect, remaining: "45" }],
    [{ ...effect, remaining: -1 }],
    [effect, { ...effect, x: 2000 }],
    [effect, { ...effect, id: "other", y: "invalid" }],
  ];
  for (const holyLight of invalidCollections) {
    const game = fresh();
    game.effects.holyLight = holyLight;
    const raw = JSON.stringify(game);
    assert.equal(parseSavedState(raw), null, `local save should reject ${JSON.stringify(holyLight)}`);
    assert.throws(() => parseGameSave(raw), /无效|不完整/);
  }
});
