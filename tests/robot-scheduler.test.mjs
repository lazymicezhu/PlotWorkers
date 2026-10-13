import assert from "node:assert/strict";
import test from "node:test";
import { createRobotScheduler } from "../app/robot-scheduler.ts";

function harness({ randomValues = [], random = .5, startsJob = true, intervalSeconds = 3, onDispatch } = {}) {
  let clock = 0;
  let nextTimer = 0;
  let interval = intervalSeconds;
  let randomCalls = 0;
  let maxTimers = 0;
  const timers = new Map();
  const dispatches = [];
  const scheduler = createRobotScheduler({
    now: () => clock,
    random: () => randomValues[randomCalls++] ?? random,
    setTimer(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: clock + delay });
      maxTimers = Math.max(maxTimers, timers.size);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    getIntervalSeconds: () => interval,
    dispatch(index) {
      dispatches.push({ index, at: clock });
      return onDispatch ? onDispatch(scheduler, index) : startsJob;
    },
  });
  function next() {
    return [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  }
  function advanceTo(target) {
    let iterations = 0;
    while (next()?.[1].at <= target) {
      assert.ok(iterations++ < 10000, "timer loop must make progress");
      const [id, timer] = next();
      timers.delete(id);
      clock = Math.max(clock, timer.at);
      timer.callback();
    }
    clock = target;
  }
  return {
    scheduler,
    timers,
    dispatches,
    advanceTo,
    jumpTo: (target) => { clock = target; },
    fireNext() {
      const [id, timer] = next();
      timers.delete(id);
      clock = Math.max(clock, timer.at);
      timer.callback();
    },
    setInterval: (value) => { interval = value; },
    get nextAt() { return next()?.[1].at; },
    get maxTimers() { return maxTimers; },
    get randomCalls() { return randomCalls; },
  };
}

test("robots begin on independent deadlines using a single timer", () => {
  const h = harness({ randomValues: [.8, .1, .5] });
  h.scheduler.sync(3, true);
  h.advanceTo(299);
  assert.deepEqual(h.dispatches, []);
  h.advanceTo(2400);
  assert.deepEqual(h.dispatches, [{ index: 1, at: 300 }, { index: 2, at: 1500 }, { index: 0, at: 2400 }]);
  assert.equal(h.maxTimers, 1);
  assert.equal(h.timers.size, 0, "all busy robots need no scheduler timer");
  h.advanceTo(100000);
  assert.equal(h.dispatches.length, 3, "busy robots never receive another job");
});

test("completing one robot preserves another robot's deadline and samples each cooldown", () => {
  const h = harness({ randomValues: [0, 1, 0, 1] });
  h.scheduler.sync(2, true);
  h.advanceTo(0);
  h.scheduler.complete(0);
  h.advanceTo(2700);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 0, at: 2700 }]);
  h.scheduler.complete(0);
  h.advanceTo(6000);
  assert.deepEqual(h.dispatches.slice(2), [{ index: 1, at: 3000 }, { index: 0, at: 6000 }]);
  assert.equal(h.maxTimers, 1);
});

test("unchanged sync and adding a robot preserve existing deadlines", () => {
  const h = harness({ randomValues: [.5, 0] });
  h.scheduler.sync(1, true);
  const originalTimer = [...h.timers.keys()][0];
  h.advanceTo(200);
  h.scheduler.sync(1, true);
  assert.equal(h.randomCalls, 1);
  assert.equal([...h.timers.keys()][0], originalTimer);
  h.scheduler.sync(2, true);
  h.advanceTo(1500);
  assert.deepEqual(h.dispatches, [{ index: 1, at: 200 }, { index: 0, at: 1500 }]);
});

test("robots with no work retry separately after 600 to 1000 milliseconds", () => {
  const h = harness({ startsJob: false, randomValues: [0, 0, 1] });
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  assert.equal(h.nextAt, 600);
  h.advanceTo(600);
  assert.equal(h.nextAt, 1600);
  h.advanceTo(1600);
  assert.equal(h.nextAt, 2400);
  assert.equal(h.maxTimers, 1);
});

test("urgent work bypasses initial delays and cooldowns without interrupting busy robots", () => {
  const h = harness({ randomValues: [0, .01, 1, 1, .5] });
  h.scheduler.sync(4, true);
  h.advanceTo(100);
  h.scheduler.complete(0);
  h.advanceTo(200);
  h.scheduler.setUrgent(true);
  assert.equal(h.nextAt, 200);
  h.advanceTo(208);
  assert.deepEqual(h.dispatches, [
    { index: 0, at: 0 },
    { index: 1, at: 30 },
    { index: 0, at: 200 },
    { index: 2, at: 204 },
    { index: 3, at: 208 },
  ]);
  assert.equal(h.randomCalls, 5, "urgent dispatches need no random delays");
  assert.equal(h.timers.size, 0, "busy robots remain busy until their jobs finish");
  assert.equal(h.maxTimers, 1);
});

test("urgent robots take another job immediately after completion or release", () => {
  const h = harness();
  h.scheduler.setUrgent(true);
  h.scheduler.sync(2, true);
  h.advanceTo(10);
  h.scheduler.complete(0);
  assert.equal(h.nextAt, 10);
  h.advanceTo(11);
  h.scheduler.release(1);
  assert.equal(h.nextAt, 14, "immediate dispatches retain overdue smoothing");
  h.advanceTo(14);
  assert.deepEqual(h.dispatches, [
    { index: 0, at: 0 },
    { index: 1, at: 4 },
    { index: 0, at: 10 },
    { index: 1, at: 14 },
  ]);
  h.scheduler.setUrgent(false);
  h.scheduler.complete(0);
  assert.equal(h.nextAt, 3014, "normal cooldown resumes when urgency ends");
  h.scheduler.release(1);
  assert.equal(h.nextAt, 814, "normal release retry resumes when urgency ends");
  assert.equal(h.maxTimers, 1);
});

test("urgent robots with no available job still back off before retrying", () => {
  const h = harness({ startsJob: false, randomValues: [0, 1] });
  h.scheduler.setUrgent(true);
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  assert.equal(h.nextAt, 600);
  h.advanceTo(100);
  h.scheduler.setUrgent(true);
  assert.equal(h.nextAt, 600, "repeated urgency updates preserve the retry delay");
  h.advanceTo(600);
  assert.equal(h.nextAt, 1600);
  h.advanceTo(1600);
  assert.equal(h.nextAt, 2400);
  assert.equal(h.maxTimers, 1);
});

test("urgent resume and newly added robots are available immediately", () => {
  const h = harness();
  h.scheduler.sync(2, false);
  h.scheduler.setUrgent(true);
  assert.equal(h.timers.size, 0, "urgency does not unpause the service");
  h.advanceTo(100);
  h.scheduler.sync(2, true);
  h.advanceTo(104);
  h.scheduler.sync(2, false);
  h.scheduler.complete(0);
  h.advanceTo(200);
  h.scheduler.sync(2, true);
  h.advanceTo(200);
  h.scheduler.sync(3, true);
  h.advanceTo(204);
  assert.deepEqual(h.dispatches, [
    { index: 0, at: 100 },
    { index: 1, at: 104 },
    { index: 0, at: 200 },
    { index: 2, at: 204 },
  ]);
  assert.equal(h.randomCalls, 0);
  assert.equal(h.maxTimers, 1);
});

test("reset clears urgency so a new game uses normal initial delays", () => {
  const h = harness();
  h.scheduler.setUrgent(true);
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  h.scheduler.reset();
  h.scheduler.sync(1, true);
  assert.equal(h.nextAt, 1500);
  h.advanceTo(1500);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 0, at: 1500 }]);
});

test("pause cancels polling and resume spreads idle robots without touching busy jobs", () => {
  const h = harness({ randomValues: [0, .1, .2, .3, .4] });
  h.scheduler.sync(3, true);
  h.advanceTo(0);
  h.scheduler.sync(3, false);
  assert.equal(h.timers.size, 0);
  h.advanceTo(10000);
  h.scheduler.sync(3, true);
  assert.equal(h.nextAt, 10900);
  h.advanceTo(11200);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 1, at: 10900 }, { index: 2, at: 11200 }]);
});

test("completion while paused waits for resume and a fresh initial delay", () => {
  const h = harness({ randomValues: [0, .5] });
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  h.scheduler.sync(1, false);
  h.scheduler.complete(0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.randomCalls, 1);
  h.advanceTo(10000);
  h.scheduler.sync(1, true);
  h.advanceTo(11500);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 0, at: 11500 }]);
});

test("late deadlines dispatch once per callback and smooth the overdue backlog", () => {
  const h = harness({ randomValues: [0, .1, .2] });
  h.scheduler.sync(3, true);
  h.jumpTo(20000);
  h.fireNext();
  assert.deepEqual(h.dispatches, [{ index: 0, at: 20000 }]);
  assert.equal(h.nextAt, 20004);
  h.advanceTo(20008);
  assert.deepEqual(h.dispatches.slice(1), [{ index: 1, at: 20004 }, { index: 2, at: 20008 }]);
});

test("future independent deadlines are not capped by overdue smoothing", () => {
  const h = harness({ randomValues: [0, 1 / 3000, 3 / 3000] });
  h.scheduler.sync(3, true);
  h.advanceTo(3);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 1, at: 1 }, { index: 2, at: 3 }]);
});

test("fractional deadlines round timer delays upward and avoid premature callbacks", () => {
  const h = harness({ randomValues: [1.5 / 3000] });
  h.scheduler.sync(1, true);
  assert.equal(h.nextAt, 2);
  h.advanceTo(2);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 2 }]);
});

test("releasing an interrupted robot retries without disturbing other jobs", () => {
  const h = harness({ randomValues: [0, .1, 0] });
  h.scheduler.sync(2, true);
  h.advanceTo(300);
  h.scheduler.release(0);
  h.advanceTo(900);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 1, at: 300 }, { index: 0, at: 900 }]);
  assert.equal(h.timers.size, 0);
});

test("cooldowns use current upgrades and never fall below 100ms", () => {
  const h = harness({ random: 0 });
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  h.setInterval(.1);
  h.scheduler.complete(0);
  assert.equal(h.nextAt, 100);
  h.advanceTo(100);
  h.setInterval(1);
  h.scheduler.complete(0);
  assert.equal(h.nextAt, 1000);
});

test("reset clears busy state and reinitializes even when count is unchanged", () => {
  const h = harness({ randomValues: [0, .1, .2, .3] });
  h.scheduler.sync(2, true);
  h.advanceTo(0);
  h.scheduler.reset();
  assert.equal(h.timers.size, 0);
  h.scheduler.complete(0);
  h.scheduler.sync(2, true);
  h.advanceTo(900);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 0 }, { index: 0, at: 600 }, { index: 1, at: 900 }]);
});

test("zero robots, disabled service, and disposal leave no timer", () => {
  const h = harness();
  h.scheduler.sync(0, true);
  assert.equal(h.timers.size, 0);
  h.scheduler.sync(3, false);
  assert.equal(h.timers.size, 0);
  h.scheduler.sync(3, true);
  assert.equal(h.timers.size, 1);
  const cancelledCallback = [...h.timers.values()][0].callback;
  h.scheduler.dispose();
  h.scheduler.sync(3, true);
  h.scheduler.reset();
  h.scheduler.sync(1, true);
  cancelledCallback();
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.dispatches, []);
});

test("removing robots cancels their deadlines", () => {
  const h = harness({ randomValues: [1, 0] });
  h.scheduler.sync(2, true);
  h.scheduler.sync(1, true);
  assert.equal(h.nextAt, 3000);
  h.scheduler.sync(0, true);
  assert.equal(h.timers.size, 0);
});

test("synchronous reset during dispatch cannot resurrect the old deadline", () => {
  const h = harness({ random: 0, onDispatch: (scheduler) => { scheduler.reset(); return false; } });
  h.scheduler.sync(2, true);
  h.advanceTo(0);
  assert.equal(h.dispatches.length, 1);
  assert.equal(h.timers.size, 0);
});

test("synchronous disposal during dispatch cannot recreate a timer", () => {
  const h = harness({ random: 0, onDispatch: (scheduler) => { scheduler.dispose(); return false; } });
  h.scheduler.sync(2, true);
  h.advanceTo(0);
  assert.equal(h.dispatches.length, 1);
  assert.equal(h.timers.size, 0);
});

test("synchronous completion keeps its cooldown instead of becoming busy forever", () => {
  const h = harness({ random: 0, onDispatch: (scheduler, index) => { scheduler.complete(index); return true; } });
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  assert.equal(h.nextAt, 2700);
  h.advanceTo(2700);
  assert.equal(h.nextAt, 5400);
  assert.equal(h.maxTimers, 1);
});

test("300 independently recurring robots keep deadline order without starvation", () => {
  const h = harness({
    randomValues: Array.from({ length: 300 }, (_, index) => ((index * 137) % 300) / 300),
    onDispatch: (scheduler, index) => { scheduler.complete(index); return true; },
  });
  h.scheduler.sync(300, true);
  h.advanceTo(11999);
  assert.equal(h.dispatches.length, 1200);
  for (let index = 0; index < 300; index += 1) {
    const times = h.dispatches.filter((dispatch) => dispatch.index === index).map((dispatch) => dispatch.at);
    const initial = ((index * 137) % 300) * 10;
    assert.equal(times.length, 4);
    times.forEach((time, cycle) => assert.ok(Math.abs(time - (initial + cycle * 3000)) <= 1));
  }
  assert.equal(h.maxTimers, 1);
});

test("synchronous release retains its retry deadline even when dispatch returns false", () => {
  const h = harness({ random: 0, onDispatch: (scheduler, index) => { scheduler.release(index); return false; } });
  h.scheduler.sync(1, true);
  h.advanceTo(0);
  assert.equal(h.nextAt, 600);
  assert.equal(h.randomCalls, 2, "release schedules exactly one retry");
});

test("a canceled callback cannot dispatch against a freshly reset scheduler", () => {
  const h = harness({ randomValues: [0, .5] });
  h.scheduler.sync(1, true);
  const cancelledCallback = [...h.timers.values()][0].callback;
  h.scheduler.reset();
  h.scheduler.sync(1, true);
  cancelledCallback();
  assert.deepEqual(h.dispatches, []);
  assert.equal(h.nextAt, 1500);
  h.advanceTo(1500);
  assert.deepEqual(h.dispatches, [{ index: 0, at: 1500 }]);
});
