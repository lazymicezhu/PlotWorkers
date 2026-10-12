import assert from "node:assert/strict";
import test from "node:test";
import { advanceCameraMotion, cameraNeedsCullingRefresh, CAMERA_CULL_MARGIN_WORLD, createCameraFrameQueue, createCameraMotion } from "../app/camera-motion.ts";

const closeTo = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
};

function run(motion, target, frames, fps) {
  for (let frame = 0; frame < frames; frame += 1) motion = advanceCameraMotion(motion, target, 1 / fps);
  return motion;
}

test("a resting target is approached smoothly without overshoot on either axis", () => {
  let motion = createCameraMotion({ x: -250, y: 400 });
  const target = { x: 420, y: -180 };
  for (let frame = 0; frame < 180; frame += 1) {
    const previous = motion;
    motion = advanceCameraMotion(motion, target, 1 / 60);
    assert.ok(motion.position.x >= previous.position.x && motion.position.x <= target.x);
    assert.ok(motion.position.y <= previous.position.y && motion.position.y >= target.y);
    if (frame === 0) assert.ok(motion.position.x - previous.position.x < 20, "starting follow must not jump to the worker");
    if (frame === 23) assert.ok(Math.abs(target.x - motion.position.x) < 20, "camera should be within 3% after 400ms");
  }
  assert.deepEqual(motion, { position: target, velocity: { x: 0, y: 0 } });
  assert.deepEqual(run(motion, target, 120, 60), motion, "settled camera must not jitter");
});

test("30, 60 and 120Hz agree at shared points on the same follow trajectory", () => {
  const target = { x: 640, y: -290 };
  for (const seconds of [0.1, 0.2, 0.4, 0.8]) {
    const motions = [30, 60, 120].map((fps) => run(createCameraMotion({ x: 0, y: 40 }), target, Math.round(seconds * fps), fps));
    for (const motion of motions.slice(1)) {
      for (const part of ["position", "velocity"]) {
        closeTo(motion[part].x, motions[0][part].x);
        closeTo(motion[part].y, motions[0][part].y);
      }
    }
  }
});

test("switching follow targets preserves current position and momentum", () => {
  const moving = run(createCameraMotion({ x: 0, y: 0 }), { x: 700, y: 400 }, 6, 60);
  const reversed = { x: -400, y: -250 };
  assert.equal(advanceCameraMotion(moving, reversed, 0), moving);
  const next = advanceCameraMotion(moving, reversed, 1e-7);
  closeTo(next.position.x, moving.position.x, 0.001);
  closeTo(next.position.y, moving.position.y, 0.001);
  closeTo(next.velocity.x, moving.velocity.x, 0.1);
  closeTo(next.velocity.y, moving.velocity.y, 0.1);
  assert.ok(next.position.x > moving.position.x, "new target must not instantly reverse existing momentum");
  assert.deepEqual(run(moving, reversed, 180, 60), { position: reversed, velocity: { x: 0, y: 0 } });
});

test("a closer target catches existing momentum without overshooting", () => {
  const moving = run(createCameraMotion({ x: 0, y: 0 }), { x: 1000, y: -1000 }, 6, 60);
  const target = { x: moving.position.x + 1, y: moving.position.y - 1 };
  const next = advanceCameraMotion(moving, target, 1 / 60);
  assert.deepEqual(next, { position: target, velocity: { x: 0, y: 0 } });
});

test("a long background pause advances at most one 50ms frame", () => {
  const motion = createCameraMotion({ x: 0, y: 0 });
  const target = { x: 1000, y: -1000 };
  assert.deepEqual(advanceCameraMotion(motion, target, 60), advanceCameraMotion(motion, target, 0.05));
  assert.ok(advanceCameraMotion(motion, target, 60).position.x < 200);
});

test("zero, negative and non-finite elapsed times do not move a valid camera", () => {
  const motion = run(createCameraMotion({ x: 30, y: 20 }), { x: 400, y: 100 }, 6, 60);
  for (const seconds of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(advanceCameraMotion(motion, { x: 200, y: 100 }, seconds), motion);
  }
});

test("invalid coordinates and velocities never produce non-finite scene positions", () => {
  assert.deepEqual(createCameraMotion({ x: NaN, y: Infinity }), { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });
  for (const seconds of [0, 1 / 60]) {
    const repaired = advanceCameraMotion(
      { position: { x: NaN, y: 20 }, velocity: { x: Infinity, y: NaN } },
      { x: 40, y: Infinity }, seconds,
    );
    assert.deepEqual(repaired, { position: { x: 40, y: 20 }, velocity: { x: 0, y: 0 } });
  }
  const extreme = advanceCameraMotion(createCameraMotion({ x: Number.MAX_VALUE, y: 0 }), { x: -Number.MAX_VALUE, y: NaN }, 1 / 60);
  assert.ok(Number.isFinite(extreme.position.x) && Number.isFinite(extreme.velocity.x));
});

test("motion helpers leave caller-owned positions, targets and state unchanged", () => {
  const point = { x: 10, y: 20 };
  const motion = createCameraMotion(point);
  const target = { x: 400, y: -300 };
  const before = structuredClone(motion);
  assert.notEqual(motion.position, point);
  advanceCameraMotion(motion, target, 1 / 60);
  assert.deepEqual(motion, before);
  assert.deepEqual(point, { x: 10, y: 20 });
  assert.deepEqual(target, { x: 400, y: -300 });
});


test("manual culling refresh uses world units even at minimum zoom", () => {
  assert.equal(CAMERA_CULL_MARGIN_WORLD, 240);
  for (const zoom of [.28, .31, .62, 1.5]) {
    const snapshot = { x: -70, y: 15 };
    assert.equal(cameraNeedsCullingRefresh({ x: snapshot.x + 119 * zoom, y: snapshot.y - 119 * zoom }, snapshot, zoom), false);
    assert.equal(cameraNeedsCullingRefresh({ x: snapshot.x + 121 * zoom, y: snapshot.y }, snapshot, zoom), true);
    assert.equal(cameraNeedsCullingRefresh({ x: snapshot.x, y: snapshot.y - 241 * zoom }, snapshot, zoom, CAMERA_CULL_MARGIN_WORLD), true);
  }
});

test("half-margin snapshots keep the live viewport covered throughout a drag", () => {
  for (const zoom of [.28, .31, .62, 1.5]) {
    let snapshot = { x: 0, y: 0 };
    for (let frame = 0; frame < 720; frame += 1) {
      const live = { x: Math.sin(frame / 60 * Math.PI / 2) * 140, y: Math.sin(frame / 60 * Math.PI / 4) * 45 };
      if (cameraNeedsCullingRefresh(live, snapshot, zoom)) snapshot = live;
      for (const [axis, size] of [["x", 1900], ["y", 995]]) {
        const liveLow = -live[axis] / zoom - size / (2 * zoom);
        const liveHigh = -live[axis] / zoom + size / (2 * zoom);
        const renderedLow = -snapshot[axis] / zoom - size / (2 * zoom) - CAMERA_CULL_MARGIN_WORLD;
        const renderedHigh = -snapshot[axis] / zoom + size / (2 * zoom) + CAMERA_CULL_MARGIN_WORLD;
        assert.ok(liveLow >= renderedLow && liveHigh <= renderedHigh, `viewport remains covered at zoom ${zoom}`);
      }
    }
  }
});

function frameHarness() {
  let serial = 0;
  const callbacks = new Map();
  const cancelled = [];
  const commits = [];
  const queue = createCameraFrameQueue({
    requestFrame(callback) { const id = ++serial; callbacks.set(id, callback); return id; },
    cancelFrame(id) { cancelled.push(id); },
    commit(position, forceSnapshot) { commits.push({ position, forceSnapshot }); },
  });
  return { queue, callbacks, cancelled, commits };
}

test("many pointer moves produce one camera paint at the latest position", () => {
  const { queue, callbacks, commits } = frameHarness();
  for (let i = 0; i < 30; i += 1) queue.queue({ x: i, y: -i });
  assert.equal(callbacks.size, 1);
  assert.equal(commits.length, 0);
  callbacks.get(1)();
  assert.deepEqual(commits, [{ position: { x: 29, y: -29 }, forceSnapshot: false }]);
  queue.queue({ x: 40, y: 12 });
  assert.equal(callbacks.size, 2);
  callbacks.get(2)();
  assert.deepEqual(commits[1], { position: { x: 40, y: 12 }, forceSnapshot: false });
});

test("pointer release paints its final coordinates and invalidates the queued frame", () => {
  const { queue, callbacks, cancelled, commits } = frameHarness();
  queue.queue({ x: 80, y: 20 });
  queue.flush({ x: 85, y: 24 });
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(commits, [{ position: { x: 85, y: 24 }, forceSnapshot: true }]);
  callbacks.get(1)();
  assert.equal(commits.length, 1, "old rAF cannot pull the camera back after pointer release");
});

test("cancellation or scene reset cannot overwrite a subsequent drag", () => {
  const { queue, callbacks, commits } = frameHarness();
  queue.queue({ x: 800, y: 200 });
  queue.cancel();
  queue.queue({ x: -30, y: 40 });
  callbacks.get(1)();
  assert.equal(commits.length, 0);
  callbacks.get(2)();
  assert.deepEqual(commits, [{ position: { x: -30, y: 40 }, forceSnapshot: false }]);
});

test("cancel, lost capture or blur can flush the last received pointer position", () => {
  const { queue, callbacks, commits } = frameHarness();
  queue.queue({ x: 25, y: -12 });
  queue.flush();
  callbacks.get(1)();
  assert.deepEqual(commits, [{ position: { x: 25, y: -12 }, forceSnapshot: true }]);
  queue.cancel();
  queue.flush();
  assert.equal(commits.length, 1, "an empty queue does not create a stale extra paint");
});
