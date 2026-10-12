import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, parseSavedState, stepGame } from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";

function workingGame() {
  const game = createInitialState(0, 0);
  Object.assign(game.workers[0], { personality: "lazy", zoneId: "gather", status: "gathering", stamina: 10 });
  return game;
}

function sequence(...values) {
  return () => {
    assert.ok(values.length, "unexpected random draw");
    return values.shift();
  };
}

test("each lazy worker gets an independent 18–22 second deadline on starting work", () => {
  const game = workingGame();
  game.workers.push({ ...game.workers[0], id: "worker-2" });
  const next = stepGame(game, 1, sequence(0, 1));
  assert.deepEqual(next.workers.map((worker) => worker.lazyCheckInterval), [18, 22]);
  assert.deepEqual(next.workers.map((worker) => worker.lazyElapsed), [1, 1]);
  assert.equal(game.workers[0].lazyCheckInterval, undefined, "the input state stays immutable");
  const continued = stepGame(next, 1, sequence());
  assert.deepEqual(continued.workers.map((worker) => worker.lazyCheckInterval), [18, 22], "ordinary ticks do not resample deadlines");
});

test("workers at the same elapsed time only check when their own deadline is reached", () => {
  let game = workingGame();
  Object.assign(game.workers[0], { lazyElapsed: 17, lazyCheckInterval: 18 });
  game.workers.push({ ...game.workers[0], id: "worker-2", lazyCheckInterval: 22 });
  game = stepGame(game, 1, sequence(.1));
  assert.deepEqual(game.workers.map((worker) => worker.status), ["slacking", "gathering"]);
  for (let i = 0; i < 3; i++) game = stepGame(game, 1, sequence());
  assert.equal(game.workers[1].status, "gathering");
  game = stepGame(game, 1, sequence(.1));
  assert.equal(game.workers[1].status, "slacking");
});

test("slacking uses a separate random draw and the strict 30 percent probability boundary", () => {
  for (const probabilityDraw of [0, .299999, .3, .8, 1]) {
    const game = workingGame();
    Object.assign(game.workers[0], { lazyElapsed: 17, lazyCheckInterval: 18 });
    const next = stepGame(game, 1, sequence(probabilityDraw, .5));
    assert.equal(next.workers[0].status, probabilityDraw < .3 ? "slacking" : "gathering");
    assert.equal(next.workers[0].lazyCheckInterval, probabilityDraw < .3 ? undefined : 20);
    assert.equal(next.workers[0].lazyElapsed, 0);
  }
});

test("a completed check independently resamples timing while preserving fractional elapsed time", () => {
  const game = workingGame();
  Object.assign(game.workers[0], { lazyElapsed: 18, lazyCheckInterval: 18.5 });
  const next = stepGame(game, 1, sequence(.9, .75));
  assert.equal(next.workers[0].status, "gathering");
  assert.equal(next.workers[0].lazyCheckInterval, 21);
  assert.equal(next.workers[0].lazyElapsed, .5);
});

test("legacy saves cannot trigger immediate synchronized checks from old elapsed time", () => {
  const game = workingGame();
  game.workers[0].lazyElapsed = 19.9;
  game.workers.push({ ...game.workers[0], id: "worker-2" });
  const loaded = parseSavedState(JSON.stringify(game));
  assert.ok(loaded);
  const next = stepGame(loaded, 1, sequence(0, 1));
  assert.deepEqual(next.workers.map((worker) => worker.status), ["gathering", "gathering"]);
  assert.deepEqual(next.workers.map((worker) => worker.lazyElapsed), [1, 1]);
  assert.deepEqual(next.workers.map((worker) => worker.lazyCheckInterval), [18, 22]);
  const rawNext = stepGame(game, 1, sequence(0, 1));
  assert.deepEqual(rawNext, next, "raw legacy state has the same safe first tick");
});

test("current deadlines and progress survive local loading and export/import unchanged", () => {
  const game = workingGame();
  Object.assign(game.workers[0], { lazyElapsed: 7.5, lazyCheckInterval: 21.25 });
  const loaded = parseSavedState(JSON.stringify(game));
  assert.deepEqual(loaded, game);
  assert.deepEqual(parseSavedState(JSON.stringify(loaded)), game);
  const imported = parseGameSave(exportGameSave(game)).state;
  assert.deepEqual(imported, game);
  assert.equal(stepGame(imported, 1, sequence()).workers[0].lazyCheckInterval, 21.25);
});

test("legacy saves without a deadline remain importable and exportable", () => {
  const game = workingGame();
  game.workers[0].lazyElapsed = 19;
  const imported = parseGameSave(exportGameSave(game)).state;
  assert.equal(imported.workers[0].lazyCheckInterval, undefined);
  assert.equal(stepGame(imported, 1, sequence(.5)).workers[0].lazyElapsed, 1);
});

test("loading an interrupted transfer starts a fresh interval after restoring the worker", () => {
  const game = workingGame();
  Object.assign(game.workers[0], { status: "dragging", lazyElapsed: 17.9, lazyCheckInterval: 18 });
  const imported = parseGameSave(exportGameSave(game)).state;
  assert.equal(imported.workers[0].status, "idle");
  assert.equal(imported.workers[0].lazyElapsed, 0);
  assert.equal(imported.workers[0].lazyCheckInterval, undefined);
  const resumed = stepGame(imported, 1, sequence(.75));
  assert.equal(resumed.workers[0].status, "gathering");
  assert.equal(resumed.workers[0].lazyCheckInterval, 21);
});

test("provided deadlines outside the supported range are rejected", () => {
  for (const invalid of [null, "20", 0, 17.999, 22.001]) {
    const game = workingGame();
    game.workers[0].lazyCheckInterval = invalid;
    assert.equal(parseSavedState(JSON.stringify(game)), null);
    assert.throws(() => parseGameSave(JSON.stringify(game)), /存档/);
  }
});

test("leaving work clears timing so returning receives a fresh independent interval", () => {
  for (const reason of ["living", "missing plot", "disabled plot", "exhausted", "slacking"]) {
    const game = workingGame();
    Object.assign(game.workers[0], { lazyElapsed: 17, lazyCheckInterval: 18 });
    if (reason === "living") game.workers[0].zoneId = "living";
    if (reason === "missing plot") game.workers[0].zoneId = null;
    if (reason === "disabled plot") game.plots[0].enabled = false;
    if (reason === "exhausted") game.workers[0].mood = 0;
    if (reason === "slacking") game.workers[0].status = "slacking";
    const stopped = stepGame(game, 1, sequence());
    assert.equal(stopped.workers[0].lazyElapsed, 0, reason);
    assert.equal(stopped.workers[0].lazyCheckInterval, undefined, reason);
    Object.assign(stopped.workers[0], { zoneId: "gather", status: "idle", mood: 100 });
    stopped.plots[0].enabled = true;
    const resumed = stepGame(stopped, 1, sequence(.75));
    assert.equal(resumed.workers[0].lazyElapsed, 1, reason);
    assert.equal(resumed.workers[0].lazyCheckInterval, 21, reason);
  }
});
