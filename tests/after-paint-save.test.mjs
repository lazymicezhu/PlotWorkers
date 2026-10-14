import assert from "node:assert/strict";
import test from "node:test";
import { createAfterPaintSave } from "../app/after-paint-save.ts";

function fakeScheduler() {
  let serial = 0;
  const frames = new Map();
  const timers = new Map();
  return {
    frames,
    timers,
    requestFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    setTimer(callback, delayMs) { assert.equal(delayMs, 0); const id = ++serial; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    runTasks() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test("saving waits for both the animation frame and its following task", () => {
  const scheduler = fakeScheduler();
  let saves = 0;
  const queue = createAfterPaintSave(() => { saves += 1; }, undefined, scheduler);
  queue.request();
  assert.equal(saves, 0);
  assert.equal(scheduler.frames.size, 1);
  scheduler.runTasks();
  assert.equal(saves, 0);
  scheduler.paint();
  assert.equal(saves, 0);
  assert.equal(scheduler.timers.size, 1);
  scheduler.runTasks();
  assert.equal(saves, 1);
});

test("multiple transactions coalesce and the callback reads the newest state", () => {
  const scheduler = fakeScheduler();
  let current = { coins: 100 };
  const saved = [];
  const queue = createAfterPaintSave(() => saved.push(current), undefined, scheduler);
  queue.request();
  current = { coins: 200 };
  queue.request();
  assert.equal(scheduler.frames.size, 1);
  scheduler.paint();
  current = { coins: 300 };
  queue.request();
  assert.equal(scheduler.frames.size, 0);
  assert.equal(scheduler.timers.size, 1);
  scheduler.runTasks();
  assert.deepEqual(saved, [{ coins: 300 }]);
});

test("leave flush saves immediately and cancels either pending stage", () => {
  for (const afterFrame of [false, true]) {
    const scheduler = fakeScheduler();
    let saves = 0;
    const queue = createAfterPaintSave(() => { saves += 1; }, undefined, scheduler);
    queue.request();
    if (afterFrame) scheduler.paint();
    queue.flush();
    assert.equal(saves, 1);
    assert.equal(scheduler.frames.size, 0);
    assert.equal(scheduler.timers.size, 0);
    scheduler.paint();
    scheduler.runTasks();
    assert.equal(saves, 1);
    queue.flush();
    assert.equal(saves, 2, "a later leave flush also includes unrequested simulation progress");
  }
});

test("cancel removes scheduled work without writing an old state", () => {
  for (const afterFrame of [false, true]) {
    const scheduler = fakeScheduler();
    let saves = 0;
    const queue = createAfterPaintSave(() => { saves += 1; }, undefined, scheduler);
    queue.request();
    if (afterFrame) scheduler.paint();
    const staleCallback = [...scheduler.frames.values(), ...scheduler.timers.values()][0];
    queue.cancel();
    staleCallback();
    scheduler.paint();
    scheduler.runTasks();
    assert.equal(saves, 0);
    assert.equal(scheduler.frames.size, 0);
    assert.equal(scheduler.timers.size, 0);
    queue.request();
    scheduler.paint();
    scheduler.runTasks();
    assert.equal(saves, 1, "the queue can be reused after cleanup");
  }
});

test("save failures are reported without escaping and retry with the latest state", () => {
  for (const retry of ["request", "flush"]) {
    const scheduler = fakeScheduler();
    const errors = [];
    const failure = new Error("storage full");
    let failing = true;
    let current = "before retry";
    const saved = [];
    const queue = createAfterPaintSave(() => {
      if (failing) throw failure;
      saved.push(current);
    }, error => errors.push(error), scheduler);
    queue.request();
    scheduler.paint();
    assert.doesNotThrow(() => scheduler.runTasks());
    assert.deepEqual(errors, [failure]);
    assert.deepEqual(saved, []);
    failing = false;
    current = "latest retry state";
    assert.doesNotThrow(() => queue[retry]());
    scheduler.paint();
    scheduler.runTasks();
    assert.deepEqual(saved, ["latest retry state"]);
  }
});

test("error reporter failures also cannot escape a transaction or leave flush", () => {
  const scheduler = fakeScheduler();
  const queue = createAfterPaintSave(() => { throw new Error("save failed"); }, () => { throw new Error("notice failed"); }, scheduler);
  assert.doesNotThrow(() => queue.flush());
});

test("construction and cleanup are safe without a browser window", () => {
  assert.equal(typeof window, "undefined");
  let saves = 0;
  const queue = createAfterPaintSave(() => { saves += 1; });
  assert.doesNotThrow(() => queue.request());
  queue.cancel();
  assert.equal(saves, 0);
  queue.flush();
  assert.equal(saves, 1);
});
