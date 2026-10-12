import assert from "node:assert/strict";
import test from "node:test";
import { startGameAutosave } from "../app/game-autosave.ts";
import { chooseAutoDispatch, createInitialState, createInitialWorker, parseSavedState, stepGame } from "../app/game-engine.ts";

function browser() {
  let now = 0;
  let serial = 0;
  let visibility = "visible";
  const intervals = new Map();
  const pageWindow = new EventTarget();
  const pageDocument = new EventTarget();
  Object.defineProperty(pageDocument, "visibilityState", { get: () => visibility });
  pageWindow.setInterval = (callback, delay) => {
    const id = ++serial;
    intervals.set(id, { callback, delay, next: now + delay });
    return id;
  };
  pageWindow.clearInterval = (id) => intervals.delete(id);

  return {
    pageWindow,
    pageDocument,
    intervals,
    get now() { return now; },
    advanceTo(target) {
      while (true) {
        const due = [...intervals.values()].sort((left, right) => left.next - right.next)[0];
        if (!due || due.next > target) break;
        now = due.next;
        due.next += due.delay;
        due.callback();
      }
      now = target;
    },
    visibility(next) {
      visibility = next;
      pageDocument.dispatchEvent(new Event("visibilitychange"));
    },
    leave() { pageWindow.dispatchEvent(new Event("pagehide")); },
  };
}

test("autosave does not save on mount and saves the latest state every thirty seconds", () => {
  const h = browser();
  let current = { coins: 10 };
  const saves = [];
  const cleanup = startGameAutosave((reason) => saves.push({ reason, at: h.now, state: current }), h.pageWindow, h.pageDocument);
  assert.deepEqual(saves, []);
  h.advanceTo(29_999);
  assert.deepEqual(saves, []);
  current = { coins: 25 };
  h.advanceTo(30_000);
  assert.deepEqual(saves, [{ reason: "interval", at: 30_000, state: current }]);
  current = { coins: 70 };
  h.advanceTo(60_000);
  assert.deepEqual(saves[1], { reason: "interval", at: 60_000, state: current });
  assert.equal(h.intervals.size, 1);
  cleanup();
});

test("hiding or leaving the page saves immediately while returning to the foreground does not", () => {
  const h = browser();
  const saves = [];
  const cleanup = startGameAutosave((reason) => saves.push({ reason, at: h.now }), h.pageWindow, h.pageDocument);
  h.visibility("visible");
  assert.deepEqual(saves, []);
  h.advanceTo(4000);
  h.visibility("hidden");
  assert.deepEqual(saves, [{ reason: "leave", at: 4000 }]);
  h.visibility("visible");
  assert.equal(saves.length, 1);
  h.advanceTo(7000);
  h.leave();
  assert.deepEqual(saves[1], { reason: "leave", at: 7000 });
  cleanup();
});

test("a lifecycle save keeps the thirty-second interval schedule", () => {
  const h = browser();
  const saves = [];
  const cleanup = startGameAutosave((reason) => saves.push({ reason, at: h.now }), h.pageWindow, h.pageDocument);
  h.advanceTo(12_000);
  h.visibility("hidden");
  h.advanceTo(30_000);
  assert.deepEqual(saves, [{ reason: "leave", at: 12_000 }, { reason: "interval", at: 30_000 }]);
  cleanup();
});

test("cleanup removes interval and lifecycle saves without writing on cleanup", () => {
  const h = browser();
  const saves = [];
  const cleanup = startGameAutosave((reason) => saves.push(reason), h.pageWindow, h.pageDocument);
  const staleCallback = [...h.intervals.values()][0].callback;
  cleanup();
  cleanup();
  assert.equal(h.intervals.size, 0);
  h.advanceTo(90_000);
  h.visibility("hidden");
  h.leave();
  staleCallback();
  assert.deepEqual(saves, []);
});

test("a replacement mount cannot save the previous game through retired callbacks", () => {
  const h = browser();
  const saves = [];
  const oldCleanup = startGameAutosave(() => saves.push("old"), h.pageWindow, h.pageDocument);
  const oldCallback = [...h.intervals.values()][0].callback;
  oldCleanup();
  const cleanup = startGameAutosave(() => saves.push("new"), h.pageWindow, h.pageDocument);
  oldCallback();
  assert.deepEqual(saves, []);
  h.advanceTo(30_000);
  h.leave();
  assert.deepEqual(saves, ["new", "new"]);
  cleanup();
});

test("a raw autosave during robot transport restores the source position without losing inventory or prepaid production", () => {
  const h = browser();
  let game = createInitialState(0, 0);
  const process = game.plots.find((plot) => plot.id === "process");
  const synthesis = { ...process, id: "autosave-synthesis", type: "synthesis", x: process.x + 1000 };
  game.plots.push(synthesis);
  game.inventory.raw = 1000;
  game.inventory.rough = 100;
  game.inventory.refined = 100;
  game.workers = [process, synthesis].map((plot, index) => {
    const u = 1.25, v = 2.75;
    return {
      ...createInitialWorker(plot.x + (u - v) * 52 + plot.rows * 52, plot.y + (u + v) * 27),
      id: `autosave-worker-${index}`, zoneId: plot.id, u, v, status: "idle", mood: 80,
      lastWorkZoneId: plot.id,
    };
  });
  game.synthesisPlots[synthesis.id] = { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
  game = stepGame(game, .01, () => 1);
  assert.ok(game.processPlots.process.batch.reservedRaw > 0);
  assert.ok(Object.keys(game.synthesisPlots[synthesis.id].batch.reserved).length > 0);

  game.workers[0] = { ...game.workers[0], mood: 0, status: "exhausted" };
  const decision = chooseAutoDispatch(game);
  assert.equal(decision.workerId, game.workers[0].id);
  assert.equal(decision.action, "rest");
  const source = { ...game.workers[0] };
  // Robot pickup changes status only; the destination is committed on completion.
  game = { ...game, workers: game.workers.map((worker) => worker.id === decision.workerId ? { ...worker, status: "dragging" } : worker) };
  let stored = null;
  const cleanup = startGameAutosave(() => { stored = JSON.stringify(game); }, h.pageWindow, h.pageDocument);
  h.advanceTo(30_000);
  assert.equal(JSON.parse(stored).workers[0].status, "dragging");
  const loaded = parseSavedState(stored);
  assert.ok(loaded);
  assert.equal(loaded.workers[0].status, "exhausted");
  for (const field of ["zoneId", "u", "v", "x", "y", "lastWorkZoneId"]) assert.equal(loaded.workers[0][field], source[field]);
  assert.deepEqual(loaded.inventory, game.inventory);
  assert.deepEqual(loaded.processPlots, game.processPlots);
  assert.deepEqual(loaded.synthesisPlots, game.synthesisPlots);
  assert.equal(chooseAutoDispatch(loaded).workerId, source.id, "the interrupted transfer can be dispatched again");
  assert.equal(game.workers[0].status, "dragging", "serialization and restoration leave the live game unchanged");
  cleanup();
});
