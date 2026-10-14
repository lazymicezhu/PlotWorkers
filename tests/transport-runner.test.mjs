import assert from "node:assert/strict";
import test from "node:test";
import { createTransportRunner } from "../app/transport-runner.ts";
import { createTransportMotion, sampleTransportMotion } from "../app/transport-motion.ts";

const world = (u, v = 0) => ({ x: 52 * (u - v), y: 27 * (u + v) });
const closeTo = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
const pointCloseTo = (actual, expected) => { closeTo(actual.x, expected.x); closeTo(actual.y, expected.y); };

function harness() {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  const clock = {
    now: () => now,
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  };
  const runner = createTransportRunner(clock);
  const nextTimer = () => [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  const h = {
    clock, runner, frames, timers,
    now: () => now,
    setNow(at) { now = at; },
    frame(at = now) {
      now = at;
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback());
    },
    timer(at = nextTimer()?.[1].at) {
      const entry = nextTimer();
      assert.ok(entry, "a completion timer should be scheduled");
      now = at;
      timers.delete(entry[0]);
      entry[1].callback();
    },
    deadline: () => nextTimer()?.[1].at,
    stage() { h.frame(); h.frame(); },
    job(id = "worker", distance = 12, extra = {}) {
      const state = { target: world(distance), speed: { efficiency: 1, buff: 1 }, allowed: true, samples: [], complete: 0, last: null };
      state.handle = runner.start(id, {
        from: world(0),
        getTarget: () => state.target,
        getSpeed: () => state.speed,
        canComplete: () => state.allowed,
        onUpdate(sample) { state.samples.push(sample); state.last = sample; },
        onComplete() { state.complete += 1; },
        ...extra,
      });
      return state;
    },
  };
  return h;
}

test("many robots share one frame and one deadline timer, including background completion", () => {
  const h = harness();
  const jobs = Array.from({ length: 80 }, (_, id) => h.job(`worker-${id}`));
  assert.equal(h.frames.size, 1);
  assert.equal(h.timers.size, 0);
  h.frame(16);
  assert.equal(h.frames.size, 1);
  assert.equal(h.timers.size, 0);
  h.frame(32);
  assert.equal(h.frames.size, 1);
  assert.equal(h.timers.size, 1);
  closeTo(h.deadline(), 1332);
  const deadlineCallback = [...h.timers.values()][0].callback;
  // No more animation frames arrive after staging, as in a hidden tab.
  h.timer();
  assert.ok(jobs.every((job) => job.complete === 1));
  assert.ok(jobs.every((job) => job.last.phase === "complete"));
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  deadlineCallback();
  h.runner.refresh();
  assert.ok(jobs.every((job) => job.complete === 1));
});

test("pickup paints before the trip starts and staging reads the latest route and upgrade", () => {
  const h = harness();
  const job = h.job();
  h.frame(250);
  job.target = world(24);
  job.speed.efficiency = 2;
  h.runner.refresh();
  assert.equal(job.last.phase, "pickup");
  assert.equal(h.timers.size, 0, "refresh must not advance the two painted frame boundaries");
  h.frame(500);
  closeTo(h.deadline(), 1800);
  h.frame(639);
  assert.equal(job.last.phase, "pickup");
  h.frame(650);
  assert.equal(job.last.phase, "accelerating");
  h.timer();
  assert.equal(job.complete, 1);
  pointCloseTo(job.last.point, world(24));
});

test("the shared timer advances to the next robot without rescheduling on ordinary frames", () => {
  const h = harness();
  const near = h.job("near", 4);
  const far = h.job("far", 28);
  h.stage();
  const timerId = [...h.timers.keys()][0];
  h.frame(200);
  h.frame(400);
  assert.equal([...h.timers.keys()][0], timerId);
  h.timer();
  assert.equal(near.complete, 1);
  assert.equal(far.complete, 0);
  assert.equal(h.timers.size, 1);
  assert.equal(h.frames.size, 1);
  closeTo(h.deadline(), Math.ceil(300 + 28000 / 12));
  h.timer();
  assert.equal(far.complete, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
});

test("a moved destination replans from exact current position and speed and rejects the old timer", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  const oldTimer = [...h.timers.values()][0].callback;
  h.frame(500);
  const before = job.last;
  job.target = world(20, 5);
  h.runner.refresh();
  pointCloseTo(job.last.point, before.point);
  closeTo(job.last.speed, before.speed);
  assert.ok(h.deadline() > 1300);
  const after = job.last;
  oldTimer();
  assert.equal(job.last, after, "a replaced timer cannot publish stale samples");
  assert.equal(job.complete, 0);
  h.timer();
  pointCloseTo(job.last.point, job.target);
  assert.equal(job.complete, 1);
});

test("moving a plot during landing resumes at its old location without another pickup", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  h.frame(1200);
  assert.equal(job.last.phase, "landing");
  job.target = world(16);
  h.runner.refresh();
  pointCloseTo(job.last.point, world(12));
  assert.equal(job.last.phase, "accelerating");
  closeTo(h.deadline(), Math.ceil(1200 + 4000 / 12 + 160));
  h.timer();
  pointCloseTo(job.last.point, world(16));
  assert.equal(job.complete, 1);
});

test("a late background timer checks the live destination before releasing its worker", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  job.target = world(24);
  // The destination changed without an animation frame, and the old timer
  // fires long after its 1.3-second deadline.
  h.timer(5000);
  assert.equal(job.complete, 0);
  pointCloseTo(job.last.point, world(12));
  assert.equal(job.last.phase, "accelerating");
  closeTo(h.deadline(), 6160);
  h.timer();
  assert.equal(job.complete, 1);
  pointCloseTo(job.last.point, world(24));
});

test("upgrades and expired buffs change remaining travel with continuous position and speed", () => {
  const h = harness();
  const job = h.job("worker", 28);
  h.stage();
  const originalDeadline = h.deadline();
  h.frame(700);
  const before = job.last;
  job.speed = { efficiency: 2, buff: 1.5 };
  h.runner.refresh();
  pointCloseTo(job.last.point, before.point);
  closeTo(job.last.speed, before.speed);
  const upgradedDeadline = h.deadline();
  assert.ok(upgradedDeadline < originalDeadline);
  h.frame(850);
  const beforeExpiry = job.last;
  job.speed.buff = 1;
  h.runner.refresh();
  pointCloseTo(job.last.point, beforeExpiry.point);
  closeTo(job.last.speed, beforeExpiry.speed);
  assert.ok(h.deadline() > upgradedDeadline);
  h.timer();
  assert.equal(job.complete, 1);
});

test("arrival holds during a plot drag without spinning timers, and follows later draft movement", () => {
  const h = harness();
  const job = h.job();
  job.allowed = false;
  h.stage();
  h.timer();
  assert.equal(job.complete, 0);
  assert.equal(job.last.phase, "landing");
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 1);
  h.frame(2000);
  assert.equal(h.timers.size, 0);
  job.target = world(20);
  h.runner.refresh();
  pointCloseTo(job.last.point, world(12));
  assert.equal(job.last.phase, "accelerating");
  closeTo(h.deadline(), Math.ceil(2000 + 8000 / 12 + 160));
  h.timer();
  assert.equal(job.complete, 0);
  assert.equal(h.timers.size, 0);
  job.allowed = true;
  h.runner.refresh();
  assert.equal(job.complete, 1);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

test("cancelling a dragged plot returns along a real route before completing", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  job.allowed = false;
  job.target = world(20);
  h.frame(500);
  h.timer();
  pointCloseTo(job.last.point, world(20));
  job.allowed = true;
  job.target = world(12);
  h.runner.refresh();
  assert.equal(job.complete, 0);
  pointCloseTo(job.last.point, world(20));
  assert.equal(job.last.phase, "accelerating");
  h.timer();
  assert.equal(job.complete, 1);
  pointCloseTo(job.last.point, world(12));
});

test("speed changes during landing cannot delay the drop, including an overdue held arrival", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  h.frame(1200);
  job.speed = { efficiency: 3, buff: 2 };
  h.runner.refresh();
  closeTo(h.deadline(), 1300);
  job.allowed = false;
  h.timer();
  h.setNow(1800);
  job.speed.buff = 1;
  h.runner.refresh();
  assert.equal(h.timers.size, 0);
  job.allowed = true;
  h.runner.refresh();
  assert.equal(job.complete, 1);
});

test("manual takeover cancels staged and active callbacks, even if already queued", () => {
  for (const active of [false, true]) {
    const h = harness();
    const job = h.job();
    if (active) h.stage();
    const staleFrame = [...h.frames.values()][0];
    const staleTimer = [...h.timers.values()][0]?.callback;
    const last = job.last;
    job.handle.cancel();
    h.setNow(5000);
    staleFrame();
    staleTimer?.();
    h.runner.refresh();
    assert.equal(job.complete, 0);
    assert.equal(job.last, last);
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
  }
});

test("an old worker handle cannot cancel its replacement", () => {
  const h = harness();
  const old = h.job();
  h.stage();
  const oldTimer = [...h.timers.values()][0].callback;
  const replacement = h.job("worker", 4);
  old.handle.cancel();
  oldTimer();
  h.stage();
  h.timer();
  assert.equal(old.complete, 0);
  assert.equal(replacement.complete, 1);
});

test("reset and unmount clear every job and prevent callbacks in the previous world", () => {
  for (const dispose of [false, true]) {
    const h = harness();
    const jobs = [h.job("first"), h.job("second", 28)];
    h.stage();
    const staleFrame = [...h.frames.values()][0];
    const staleTimer = [...h.timers.values()][0].callback;
    if (dispose) h.runner.dispose();
    else h.runner.cancelAll();
    h.setNow(5000);
    staleFrame();
    staleTimer();
    h.runner.refresh();
    assert.ok(jobs.every((job) => job.complete === 0));
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    const fresh = h.job("new-world", 4);
    if (dispose) {
      assert.equal(fresh.samples.length, 0);
      assert.equal(h.frames.size, 0);
    } else {
      h.stage();
      h.timer();
      assert.equal(fresh.complete, 1);
    }
  }
});

test("manual takeover from an update callback prevents that same tick's completion", () => {
  const h = harness();
  let handle;
  let completed = 0;
  handle = h.runner.start("worker", {
    from: world(0), getTarget: () => world(12), getSpeed: () => ({ efficiency: 1, buff: 1 }),
    onUpdate(sample) { if (sample.phase === "complete") handle.cancel(); },
    onComplete() { completed += 1; },
  });
  h.stage();
  h.timer();
  assert.equal(completed, 0);
  assert.equal(h.frames.size, 0);
});

test("a deadline crossed while painting still completes without another frame", () => {
  const h = harness();
  let completed = 0;
  h.runner.start("worker", {
    from: world(0), getTarget: () => world(12), getSpeed: () => ({ efficiency: 1, buff: 1 }),
    onUpdate(sample) {
      // Simulate work in the final update taking longer than the remaining
      // landing interval while the browser is about to pause its frames.
      if (sample.phase === "landing") h.setNow(h.now() + 20);
    },
    onComplete() { completed += 1; },
  });
  h.stage();
  h.frame(1290);
  assert.equal(h.now(), 1310);
  assert.equal(h.timers.size, 1);
  h.timer(1310);
  assert.equal(completed, 1);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

test("fractional deadlines round up to avoid premature completion or zero-delay timer loops", () => {
  const h = harness();
  const job = h.job("worker", 4);
  h.stage();
  closeTo(h.deadline(), 634);
  h.frame(633);
  assert.equal(job.complete, 0);
  assert.equal(job.last.phase, "landing");
  h.timer();
  assert.equal(h.now(), 634);
  assert.equal(job.complete, 1);
  assert.equal(h.timers.size, 0);
});

test("reset and replacement during a frame cannot update another worker from the old world", () => {
  const h = harness();
  let reset = false;
  let replacement;
  let oldWorldCompletions = 0;
  h.runner.start("first", {
    from: world(0), getTarget: () => world(12), getSpeed: () => ({ efficiency: 1, buff: 1 }),
    onUpdate(sample) {
      if (sample.phase !== "cruising" || reset) return;
      reset = true;
      h.runner.cancelAll();
      replacement = h.job("second", 4);
    },
    onComplete() { oldWorldCompletions += 1; },
  });
  const second = h.job("second", 28);
  h.stage();
  const oldSampleCount = second.samples.length;
  h.frame(500);
  assert.equal(second.samples.length, oldSampleCount);
  assert.equal(oldWorldCompletions, 0);
  assert.equal(h.frames.size, 1);
  assert.equal(h.timers.size, 0);
  h.stage();
  h.timer();
  assert.equal(replacement.complete, 1);
  assert.equal(second.complete, 0);
  assert.equal(oldWorldCompletions, 0);
});

test("completion can enqueue the same worker again without inheriting the old deadline", () => {
  const h = harness();
  let replacement;
  let firstCompletions = 0;
  h.job("worker", 4, {
    onComplete() {
      firstCompletions += 1;
      replacement = h.job("worker", 12);
    },
  });
  h.stage();
  const oldTimer = [...h.timers.values()][0].callback;
  h.timer();
  assert.equal(firstCompletions, 1);
  assert.equal(replacement.complete, 0);
  assert.equal(h.timers.size, 0);
  h.stage();
  closeTo(h.deadline(), 1934);
  oldTimer();
  assert.equal(replacement.complete, 0);
  h.timer();
  assert.equal(replacement.complete, 1);
  assert.equal(firstCompletions, 1);
});

test("refresh samples elapsed travel instead of restarting the acceleration ramp", () => {
  const h = harness();
  const job = h.job();
  h.stage();
  const motion = createTransportMotion(world(0), world(12), 0);
  for (const time of [200, 350, 750, 1000]) {
    h.setNow(time);
    h.runner.refresh();
    const expected = sampleTransportMotion(motion, time);
    pointCloseTo(job.last.point, expected.point);
    closeTo(job.last.speed, expected.speed);
    closeTo(h.deadline(), 1300);
  }
});
