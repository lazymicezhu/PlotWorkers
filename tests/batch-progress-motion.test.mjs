import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceBatchMotion,
  createBatchMotion,
  updateBatchMotion,
} from "../app/batch-progress-motion.ts";

const snapshot = (completed, progress, active = true, recipe = "screws") => ({ recipe, completed, progress, active });
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

function play(motion, deltaMs = 16) {
  const frames = [motion];
  for (let frame = 0; frame < 2000 && motion.phase !== "idle"; frame += 1) {
    motion = advanceBatchMotion(motion, deltaMs);
    frames.push(motion);
  }
  assert.equal(motion.phase, "idle", "confirmed progress must eventually settle");
  return frames;
}

function assertCycles(frames, completed) {
  const fills = frames.filter((frame, index) => frame.phase === "full" && frames[index - 1]?.phase !== "full");
  assert.deepEqual(fills.map((frame) => frame.position), completed);
  for (const frame of frames) {
    assert.ok(frame.value >= 0 && frame.value <= 1);
    assert.ok(frame.position <= frame.target + 1e-9, "animation must not invent future production");
    if (frame.phase === "full") assert.equal(frame.value, 1);
    if (frame.phase === "reset") assert.equal(frame.value, 0);
  }
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    assert.ok(current.position >= previous.position, "confirmed progress must move forward");
    if (previous.phase === "full" && current.phase !== "full") {
      assert.equal(current.phase, "reset", "a completed batch must show an empty frame before the next batch");
      assert.equal(current.value, 0);
    }
    if (current.value < previous.value) {
      assert.equal(previous.value, 1, "the fill must reach the right edge before resetting");
      assert.equal(current.value, 0);
    }
  }
}

test("a batch rollover fills completely, shows zero, then animates the next batch", () => {
  const start = createBatchMotion(snapshot(0, .94));
  const frames = play(updateBatchMotion(start, snapshot(1, .08)));
  assertCycles(frames, [1]);
  closeTo(frames.at(-1).position, 1.08);
  closeTo(frames.at(-1).value, .08);
  const reset = frames.findIndex((frame) => frame.phase === "reset");
  assert.ok(frames.slice(reset + 1).some((frame) => frame.value > 0 && frame.value < .08));
});

test("one update containing several batches plays every complete cycle", () => {
  const frames = play(updateBatchMotion(createBatchMotion(snapshot(0, .2)), snapshot(3, .25)));
  assertCycles(frames, [1, 2, 3]);
  closeTo(frames.at(-1).position, 3.25);
  closeTo(frames.at(-1).value, .25);
});

test("a completed batch still fills when missing materials leave production inactive", () => {
  const frames = play(updateBatchMotion(createBatchMotion(snapshot(0, .94)), snapshot(1, 0, false)));
  assertCycles(frames, [1]);
  assert.equal(frames.at(-1).position, 1);
  assert.equal(frames.at(-1).value, 0);
  assert.deepEqual(advanceBatchMotion(frames.at(-1), 5000), frames.at(-1));
});

test("ordinary progress advances continuously for one second and never predicts beyond its target", () => {
  let motion = updateBatchMotion(createBatchMotion(snapshot(0, .2)), snapshot(0, .7));
  for (let frame = 1; frame <= 100; frame += 1) {
    const previous = motion;
    motion = advanceBatchMotion(motion, 10);
    assert.ok(motion.value > previous.value, "every frame should advance during interpolation");
    closeTo(motion.value, .2 + .5 * frame / 100);
    assert.ok(motion.position <= motion.target);
  }
  assert.equal(motion.phase, "idle");
  closeTo(advanceBatchMotion(motion, 10000).value, .7);
});

test("repeated snapshots do not restart an in-flight animation", () => {
  const target = snapshot(1, .15);
  let uninterrupted = updateBatchMotion(createBatchMotion(snapshot(0, .8)), target);
  let repeated = uninterrupted;
  for (let frame = 0; frame < 200; frame += 1) {
    uninterrupted = advanceBatchMotion(uninterrupted, 16);
    repeated = advanceBatchMotion(updateBatchMotion(repeated, { ...target }), 16);
    closeTo(repeated.position, uninterrupted.position);
    closeTo(repeated.value, uninterrupted.value);
    assert.equal(repeated.phase, uninterrupted.phase);
  }
  assert.equal(repeated.phase, "idle");
  closeTo(repeated.position, 1.15);
});

test("changing recipes or rolling back progress discards pending cycles and aligns immediately", () => {
  for (const replacement of [snapshot(0, .12, true, "rebar"), snapshot(2, .4)]) {
    const queued = updateBatchMotion(createBatchMotion(snapshot(0, .2)), snapshot(3, .25));
    const changed = updateBatchMotion(advanceBatchMotion(queued, 16), replacement);
    const expected = replacement.completed + replacement.progress;
    closeTo(changed.position, expected);
    closeTo(changed.target, expected);
    closeTo(changed.value, replacement.progress);
    assert.equal(changed.phase, "idle");
    assert.deepEqual(advanceBatchMotion(changed, 5000), changed);
  }
});

test("full progress stays visible for at least forty milliseconds before an empty frame", () => {
  let motion = updateBatchMotion(createBatchMotion(snapshot(0, .94)), snapshot(1, .08));
  for (let frame = 0; motion.phase !== "full" && frame < 2000; frame += 1) motion = advanceBatchMotion(motion, 16);
  assert.equal(motion.phase, "full");
  for (let elapsed = 10; elapsed < 40; elapsed += 10) {
    motion = advanceBatchMotion(motion, 10);
    assert.equal(motion.phase, "full");
    assert.equal(motion.value, 1);
  }
  const frames = play(motion, 10);
  const firstNonFull = frames.find((frame) => frame.phase !== "full");
  assert.equal(firstNonFull.phase, "reset");
  assert.equal(firstNonFull.value, 0);
});

test("long frames cannot skip complete or empty boundary frames", () => {
  const frames = play(updateBatchMotion(createBatchMotion(snapshot(0, .2)), snapshot(3, .25)), 10000);
  assertCycles(frames, [1, 2, 3]);
  closeTo(frames.at(-1).value, .25);
});

test("successive one-second snapshots stay continuous and preserve every batch rollover", () => {
  let motion = createBatchMotion(snapshot(0, .2));
  const frames = [motion];
  for (const target of [.54, .88, 1.22, 1.56, 1.9, 2.24, 2.58, 2.92, 3.26]) {
    const previous = motion;
    motion = updateBatchMotion(motion, snapshot(Math.floor(target), target % 1));
    closeTo(motion.position, previous.position);
    closeTo(motion.value, previous.value);
    for (let frame = 0; frame < 50; frame += 1) {
      const before = motion;
      motion = advanceBatchMotion(motion, 20);
      assert.ok(motion.position - before.position < .01, "a new snapshot must not create a visual jump");
      frames.push(motion);
    }
  }
  frames.push(...play(motion).slice(1));
  assertCycles(frames, [1, 2, 3]);
  closeTo(frames.at(-1).value, .26);
});

test("a maximum-speed factory preserves every cycle for a minute without accumulating a long queue", () => {
  const batchesPerSecond = 15.36;
  const seconds = 60;
  const deltaMs = 1000 / 60;
  let motion = createBatchMotion(snapshot(0, 0, true, "rough"));
  const frames = [motion];
  let maximumSettledLag = 0;
  for (let second = 1; second <= seconds; second += 1) {
    const target = batchesPerSecond * second;
    motion = updateBatchMotion(motion, snapshot(Math.floor(target), target % 1, true, "rough"));
    for (let frame = 0; frame < 60; frame += 1) {
      motion = advanceBatchMotion(motion, deltaMs);
      frames.push(motion);
    }
    // Measure after the one-second playback window, not immediately after a
    // snapshot legitimately adds more than fifteen confirmed batches.
    maximumSettledLag = Math.max(maximumSettledLag, target - motion.position);
  }
  frames.push(...play(motion, deltaMs).slice(1));
  const finalTarget = batchesPerSecond * seconds;
  assertCycles(frames, Array.from({ length: Math.floor(finalTarget) }, (_, index) => index + 1));
  closeTo(frames.at(-1).position, finalTarget);
  closeTo(frames.at(-1).value, finalTarget % 1);
  assert.ok(maximumSettledLag <= 2, `playback fell ${maximumSettledLag} batches behind after a one-second window`);
});

test("new snapshots during full and reset frames preserve those frames and append later batches", () => {
  let motion = updateBatchMotion(createBatchMotion(snapshot(0, .94)), snapshot(1, .08));
  for (let frame = 0; motion.phase !== "full" && frame < 2000; frame += 1) motion = advanceBatchMotion(motion, 16);
  assert.equal(motion.phase, "full");
  motion = advanceBatchMotion(motion, 20);
  motion = updateBatchMotion(motion, snapshot(2, .2));
  assert.equal(motion.phase, "full");
  assert.equal(motion.value, 1);
  motion = advanceBatchMotion(motion, 19);
  assert.equal(motion.phase, "full");
  motion = advanceBatchMotion(motion, 1);
  assert.equal(motion.phase, "reset", "a new snapshot must not restart the full-frame hold");
  motion = updateBatchMotion(motion, snapshot(3, .25));
  assert.equal(motion.phase, "reset");
  assert.equal(motion.value, 0);
  const frames = play(motion);
  assertCycles(frames, [2, 3]);
  closeTo(frames.at(-1).value, .25);
});

test("opening at an integer batch count starts empty and only animates newly confirmed work", () => {
  for (const active of [false, true]) {
    const initial = createBatchMotion(snapshot(7, 0, active));
    assert.equal(initial.position, 7);
    assert.equal(initial.value, 0);
    assert.equal(initial.phase, "idle");
    const frames = play(updateBatchMotion(initial, snapshot(7, .3)));
    assertCycles(frames, []);
    closeTo(frames.at(-1).value, .3);
  }
});

test("opening at exactly full progress holds and resets even when the next snapshot has the same total", () => {
  let motion = createBatchMotion(snapshot(7, 1));
  assert.equal(motion.position, 8);
  assert.equal(motion.value, 1);
  assert.equal(motion.phase, "full");
  motion = advanceBatchMotion(motion, 20);
  motion = updateBatchMotion(motion, snapshot(8, 0, false));
  assert.equal(motion.phase, "full");
  assert.equal(motion.value, 1);
  motion = advanceBatchMotion(motion, 19);
  assert.equal(motion.phase, "full");
  motion = advanceBatchMotion(motion, 1);
  assert.equal(motion.phase, "reset");
  assert.equal(motion.value, 0);
  const frames = play(motion);
  assertCycles(frames, []);
  assert.equal(frames.at(-1).position, 8);
  assert.equal(frames.at(-1).value, 0);
});

test("snapshot and frame updates leave their input motion unchanged", () => {
  const start = createBatchMotion(snapshot(0, .94));
  const original = structuredClone(start);
  const moving = updateBatchMotion(start, snapshot(1, .08));
  assert.deepEqual(start, original);
  const beforeFrame = structuredClone(moving);
  advanceBatchMotion(moving, 16);
  assert.deepEqual(moving, beforeFrame);
});
