import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, parseSavedState } from "../app/game-engine.ts";
import { createRebirthPreviewState } from "./fixtures/rebirth-preview-state.ts";
import { saveFirstRebirth } from "../app/rebirth-save.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import { canFirstRebirth } from "../app/rebirth.ts";

test("first rebirth backs up the old game before committing a reloadable new workshop", () => {
  const old = createRebirthPreviewState();
  const original = structuredClone(old);
  const calls = [];
  let backup;
  let saved;
  const next = saveFirstRebirth(old, {
    backup(previous) { calls.push("backup"); backup = exportGameSave(previous); },
    save(fresh) { calls.push("save"); saved = JSON.stringify(fresh); },
  });
  assert.deepEqual(calls, ["backup", "save"]);
  assert.deepEqual(old, original);
  assert.equal(parseGameSave(backup).state.coins, old.coins);
  const reloaded = parseSavedState(saved);
  assert.equal(reloaded.rebirthCount, 1);
  assert.equal(reloaded.workers.filter(worker => worker.role === "foreman").length, 1);
  assert.equal(reloaded.coins, 100);
  assert.equal(next.rebirthCount, 1);
  reloaded.coins = 5_000_000;
  assert.equal(canFirstRebirth(reloaded), false);
});

test("failed backup never writes a replacement game", () => {
  const old = createRebirthPreviewState();
  const original = structuredClone(old);
  let writes = 0;
  assert.throws(() => saveFirstRebirth(old, {
    backup() { throw new Error("quota"); },
    save() { writes++; },
  }), /quota/);
  assert.equal(writes, 0);
  assert.deepEqual(old, original);
});

test("failed new-game save retains the original and its backup for a clean retry", () => {
  const old = createRebirthPreviewState();
  const original = JSON.stringify(old);
  let activeSave = original;
  let backup;
  assert.throws(() => saveFirstRebirth(old, {
    backup(previous) { backup = exportGameSave(previous); },
    save() { throw new Error("quota"); },
  }), /quota/);
  assert.equal(activeSave, original);
  assert.equal(JSON.stringify(old), original);
  assert.equal(parseGameSave(backup).state.rebirthCount, 0);
  const retry = saveFirstRebirth(old, {
    backup(previous) { backup = exportGameSave(previous); },
    save(next) { activeSave = JSON.stringify(next); },
  });
  assert.equal(retry.rebirthCount, 1);
  assert.equal(parseSavedState(activeSave).workers.filter(worker => worker.role === "foreman").length, 1);
});

test("ineligible games do not modify either save slot", () => {
  let writes = 0;
  const next = saveFirstRebirth(createInitialState(998, 853), {
    backup() { writes++; }, save() { writes++; },
  });
  assert.equal(next, null);
  assert.equal(writes, 0);
});
