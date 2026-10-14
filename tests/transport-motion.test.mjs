import assert from "node:assert/strict";
import test from "node:test";
import { createTransportMotion, gridDistance, retargetTransportMotion, sampleTransportMotion, transportDurationMs } from "../app/transport-motion.ts";

const world = (u, v = 0) => ({ x: 52 * (u - v), y: 27 * (u + v) });
const closeTo = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
const pointCloseTo = (actual, expected) => { closeTo(actual.x, expected.x); closeTo(actual.y, expected.y); };

test("4, 12 and 28 grid routes take about .633, 1.3 and 2.633 seconds, including handling", () => {
  for (const [distance, duration] of [[4, 300 + 4000 / 12], [12, 1300], [28, 300 + 28000 / 12]]) {
    const motion = createTransportMotion(world(0), world(distance), 5000);
    closeTo(transportDurationMs(world(0), world(distance)), duration);
    closeTo(motion.completeAtMs, 5000 + duration);
    assert.equal(sampleTransportMotion(motion, 5000 + duration - 1).phase, "landing");
    assert.equal(sampleTransportMotion(motion, 5000 + duration).phase, "complete");
  }
});

test("distance inverts both isometric axes and measures fractional pickup/landing positions", () => {
  closeTo(gridDistance(world(2, 7), world(5, 11)), 5);
  closeTo(gridDistance(world(5, 11), world(2, 7)), 5);
  closeTo(gridDistance(world(-2.5, 4.25), world(.5, 8.25)), 5);
  closeTo(gridDistance(world(0), world(1, 1)), Math.SQRT2);
  // Camera transforms are deliberately outside this API; the original world
  // coordinates yield the same duration at every UI zoom.
  const from = world(2, 7);
  const to = world(5, 11);
  for (const zoom of [.28, .62, 1, 1.5]) {
    const screen = (point) => ({ x: point.x * zoom + 140, y: point.y * zoom - 85 });
    const unproject = (point) => ({ x: (point.x - 140) / zoom, y: (point.y + 85) / zoom });
    closeTo(transportDurationMs(unproject(screen(from)), unproject(screen(to))), 300 + 5000 / 12);
  }
});

test("flight reaches cruise after 15% of the route time and keeps 25% for gentle braking", () => {
  const motion = createTransportMotion(world(0), world(12), 0);
  const flightMs = 1000;
  const sample = (fraction) => sampleTransportMotion(motion, 140 + flightMs * fraction);
  closeTo(motion.flightEndsAtMs - motion.flightStartsAtMs, flightMs);
  closeTo(motion.completeAtMs, 1300);
  closeTo(sample(0).speed, 0);
  closeTo(sample(.075).speed, 15 / 2);
  closeTo(sample(.15).speed, 15);
  closeTo(sample(.25).speed, 15);
  closeTo(sample(.5).speed, 15);
  closeTo(sample(.75).speed, 15);
  closeTo(sample(.875).speed, 15 / 2);
  closeTo(sample(1).speed, 0);
  closeTo(sample(.15).progress, .09375);
  closeTo(sample(.25).progress, .21875);
  closeTo(sample(.5).progress, .53125);
  closeTo(sample(.75).progress, .84375);
  assert.equal(sample(.1499).phase, "accelerating");
  assert.ok(sample(.1499).speed < 15);
  assert.equal(sample(.1501).phase, "cruising");
  assert.equal(sample(.5).phase, "cruising");
  assert.equal(sample(.7499).phase, "cruising");
  assert.equal(sample(.7501).phase, "decelerating");
  assert.equal(sample(.875).phase, "decelerating");
  assert.equal(sample(1).phase, "landing");
});

test("efficiency and buff multiply flight speed without shortening pickup or landing", () => {
  const motion = createTransportMotion(world(0), world(12), 500, 2, 1.5);
  closeTo(transportDurationMs(world(0), world(12), 2, 1.5), 300 + 1000 / 3);
  closeTo(motion.completeAtMs, 800 + 1000 / 3);
  assert.equal(sampleTransportMotion(motion, 639).phase, "pickup");
  closeTo(sampleTransportMotion(motion, 800).speed, 45);
  assert.equal(sampleTransportMotion(motion, 974).phase, "landing");
  assert.equal(sampleTransportMotion(motion, 1133).phase, "landing");
});

test("zero-length routes stay finite and retain only the .3 second handling time", () => {
  const point = world(4, -2);
  const motion = createTransportMotion(point, point, 1000);
  closeTo(motion.completeAtMs, 1300);
  for (const now of [0, 1000, 1139, 1140, 1299, 1300, 5000]) {
    const sample = sampleTransportMotion(motion, now);
    assert.deepEqual(sample.point, point);
    assert.equal(sample.speed, 0);
    assert.ok(Number.isFinite(sample.progress) && Number.isFinite(sample.remainingMs));
  }
  assert.equal(sampleTransportMotion(motion, 1140).phase, "landing");
  assert.equal(sampleTransportMotion(motion, 1300).phase, "complete");
});

test("sampling is independent of frame rate, frame count, and long background pauses", () => {
  const motion = createTransportMotion(world(-3, 2), world(9, 2), 0);
  const byFrameRate = [];
  for (const fps of [30, 60, 120]) {
    const sharedSamples = [];
    for (let frame = 0; frame <= fps * 1.2; frame += 1) {
      const sample = sampleTransportMotion(motion, frame * 1000 / fps);
      if ([.4, .8, 1.2].some((seconds) => frame === Math.round(seconds * fps))) sharedSamples.push(sample);
    }
    byFrameRate.push(sharedSamples);
  }
  for (const samples of byFrameRate.slice(1)) {
    for (const [index, sample] of samples.entries()) {
      pointCloseTo(sample.point, byFrameRate[0][index].point);
      closeTo(sample.speed, byFrameRate[0][index].speed);
      closeTo(sample.remainingMs, byFrameRate[0][index].remainingMs);
    }
  }
  const completed = sampleTransportMotion(motion, 100000);
  assert.equal(completed.phase, "complete");
  assert.deepEqual(completed.point, world(9, 2));
  assert.equal(completed.remainingMs, 0);
});

test("reported grid speed matches the physical route's instantaneous velocity", () => {
  const motion = createTransportMotion(world(-3, 2), world(6, 14), 0, 1.5);
  const intervalMs = .001;
  for (const now of [200, 450, 750, 900]) {
    const before = sampleTransportMotion(motion, now - intervalMs);
    const after = sampleTransportMotion(motion, now + intervalMs);
    const physicalSpeed = gridDistance(before.point, after.point) / (2 * intervalMs / 1000);
    closeTo(physicalSpeed, sampleTransportMotion(motion, now).speed, 1e-6);
  }
});

test("retargeting at pickup preserves its original deadline despite repeated plot drags", () => {
  let motion = createTransportMotion(world(0), world(12), 0);
  for (let now = 10; now <= 130; now += 10) {
    motion = retargetTransportMotion(motion, world(12 + now / 100), now);
    closeTo(motion.pickupUntilMs, 140);
    assert.deepEqual(sampleTransportMotion(motion, now).point, world(0));
  }
  assert.equal(sampleTransportMotion(motion, 141).phase, "accelerating");
  assert.ok(sampleTransportMotion(motion, 150).speed > 0);
});

test("retargeting an active flight preserves position and scalar speed and reaches the new plot", () => {
  const old = createTransportMotion(world(0), world(12), 0);
  for (const now of [250, 800, 1050]) {
    const before = sampleTransportMotion(old, now);
    assert.ok(["accelerating", "cruising", "decelerating"].includes(before.phase));
    const target = world(10, 5);
    const redirected = retargetTransportMotion(old, target, now);
    const after = sampleTransportMotion(redirected, now);
    pointCloseTo(after.point, before.point);
    closeTo(after.speed, before.speed);
    assert.notEqual(after.phase, "pickup");
    const complete = sampleTransportMotion(redirected, redirected.completeAtMs);
    assert.equal(complete.phase, "complete");
    assert.deepEqual(complete.point, target);
  }
});

test("a plot moved inside the braking distance is reached without overshoot or teleport", () => {
  const old = createTransportMotion(world(0), world(12), 0);
  const now = 900;
  const before = sampleTransportMotion(old, now);
  const target = { x: before.point.x + 5.2, y: before.point.y + 2.7 };
  const redirected = retargetTransportMotion(old, target, now);
  pointCloseTo(sampleTransportMotion(redirected, now).point, before.point);
  closeTo(sampleTransportMotion(redirected, now).speed, before.speed);
  for (let time = now; time <= redirected.completeAtMs; time += 1) {
    const sample = sampleTransportMotion(redirected, time);
    assert.ok(sample.point.x >= before.point.x && sample.point.x <= target.x);
    assert.ok(sample.point.y >= before.point.y && sample.point.y <= target.y);
  }
  assert.deepEqual(sampleTransportMotion(redirected, redirected.completeAtMs).point, target);
});

test("continuous dragging does not repeatedly reset the acceleration ramp", () => {
  let motion = createTransportMotion(world(0), world(28), 0);
  let previousSpeed = 0;
  for (let frame = 1; frame <= 60; frame += 1) {
    const now = frame * 1000 / 60;
    const before = sampleTransportMotion(motion, now);
    motion = retargetTransportMotion(motion, world(28, frame / 120), now);
    const after = sampleTransportMotion(motion, now);
    pointCloseTo(after.point, before.point);
    closeTo(after.speed, before.speed);
    assert.ok(after.speed >= previousSpeed - 1e-8);
    previousSpeed = after.speed;
  }
  assert.ok(previousSpeed > 12, "a moving destination must not trap the robot at the start of its ramp");
  assert.equal(sampleTransportMotion(motion, motion.completeAtMs).phase, "complete");
});

test("moving the destination during landing resumes from the reached location without another pickup", () => {
  const old = createTransportMotion(world(0), world(12), 0);
  const now = 1200;
  const oldSample = sampleTransportMotion(old, now);
  assert.equal(oldSample.phase, "landing");
  const redirected = retargetTransportMotion(old, world(16), now);
  const current = sampleTransportMotion(redirected, now);
  pointCloseTo(current.point, oldSample.point);
  assert.equal(current.phase, "accelerating");
  closeTo(current.speed, 0);
  closeTo(redirected.completeAtMs, now + 4000 / 12 + 160);
  assert.deepEqual(sampleTransportMotion(redirected, redirected.completeAtMs).point, world(16));
});

test("live upgrades and expiring buffs replan remaining travel while preserving current speed", () => {
  const old = createTransportMotion(world(0), world(28), 0);
  const now = 1400;
  const before = sampleTransportMotion(old, now);
  const upgraded = retargetTransportMotion(old, old.to, now, 2, 1.5);
  const after = sampleTransportMotion(upgraded, now);
  pointCloseTo(after.point, before.point);
  closeTo(after.speed, before.speed);
  assert.ok(upgraded.completeAtMs < old.completeAtMs);
  const slowdownAt = now + 150;
  const slowdown = retargetTransportMotion(upgraded, old.to, slowdownAt, 1, 1);
  pointCloseTo(sampleTransportMotion(slowdown, slowdownAt).point, sampleTransportMotion(upgraded, slowdownAt).point);
  closeTo(sampleTransportMotion(slowdown, slowdownAt).speed, sampleTransportMotion(upgraded, slowdownAt).speed);
  assert.ok(slowdown.completeAtMs > upgraded.completeAtMs);
  assert.deepEqual(sampleTransportMotion(slowdown, slowdown.completeAtMs).point, old.to);
});

test("losing a speed buff beside a moved plot brakes continuously without overshooting", () => {
  const old = createTransportMotion(world(0), world(28), 0, 1, 3);
  const now = 700;
  const before = sampleTransportMotion(old, now);
  assert.equal(before.phase, "cruising");
  closeTo(before.speed, 45);
  const target = { x: before.point.x + 104, y: before.point.y + 54 };
  const redirected = retargetTransportMotion(old, target, now, 1, 1);
  const initial = sampleTransportMotion(redirected, now);
  pointCloseTo(initial.point, before.point);
  closeTo(initial.speed, before.speed);
  assert.equal(initial.phase, "decelerating");
  let previous = initial;
  for (let time = now + 1; time < redirected.flightEndsAtMs; time += 1) {
    const sample = sampleTransportMotion(redirected, time);
    assert.ok(sample.speed <= previous.speed);
    assert.ok(sample.point.x >= previous.point.x && sample.point.x <= target.x);
    assert.ok(sample.point.y >= previous.point.y && sample.point.y <= target.y);
    previous = sample;
  }
  const landed = sampleTransportMotion(redirected, redirected.flightEndsAtMs);
  assert.deepEqual(landed.point, target);
  closeTo(landed.speed, 0);
  assert.equal(landed.phase, "landing");
});

test("unchanged snapshots, late callbacks and landing upgrades never restart a job", () => {
  const motion = createTransportMotion(world(0), world(12), 0);
  assert.equal(retargetTransportMotion(motion, { ...motion.to }, 500), motion);
  const landing = retargetTransportMotion(motion, motion.to, 1200, 2);
  closeTo(landing.completeAtMs, motion.completeAtMs);
  assert.equal(sampleTransportMotion(landing, 1200).phase, "landing");
  assert.equal(retargetTransportMotion(motion, world(50), 2000), motion);
});

test("motion helpers do not mutate caller-owned points or previous plans", () => {
  const from = world(1, 3);
  const to = world(13, 3);
  const motion = createTransportMotion(from, to, 0);
  const original = structuredClone(motion);
  assert.notEqual(motion.from, from);
  assert.notEqual(motion.to, to);
  sampleTransportMotion(motion, 800);
  retargetTransportMotion(motion, world(7, 9), 800, 2);
  assert.deepEqual(motion, original);
  assert.deepEqual(from, world(1, 3));
  assert.deepEqual(to, world(13, 3));
});
