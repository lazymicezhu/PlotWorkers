import assert from "node:assert/strict";
import test from "node:test";
import {
  createPerformanceCollector,
  getPerformanceSnapshot,
  isPerformanceMonitoringEnabled,
  measureGameTask,
  recordGameTask,
  setPerformanceMonitoringEnabled,
} from "../app/performance-metrics.ts";

test("frame metrics use recent frame gaps and distinguish gaps exceeding 50 ms", () => {
  const collector = createPerformanceCollector();
  collector.recordFrame(0);
  for (let at = 20; at <= 1000; at += 20) collector.recordFrame(at);
  let snapshot = collector.snapshot(1000);
  assert.equal(snapshot.fps, 50);
  assert.equal(snapshot.frameP95Ms, 20);
  assert.equal(snapshot.longFrameCount, 0);
  collector.recordFrame(1050);
  collector.recordFrame(1110);
  snapshot = collector.snapshot(1110);
  assert.equal(snapshot.longFrameCount, 1);
  assert.equal(snapshot.frameP95Ms, 20);
  assert.equal(collector.snapshot(6110).frameCount, 0);
  assert.equal(collector.snapshot(6110).fps, null);
});

test("task windows expire idle tasks and keep averages, maxima and counts separate", () => {
  const collector = createPerformanceCollector();
  collector.recordTask("dispatch", 2, 100);
  collector.recordTask("dispatch", 6, 200);
  collector.recordTask("simulation", 15, 200);
  collector.recordTask("save", NaN, 200);
  collector.recordTask("save", -1, 200);
  const snapshot = collector.snapshot(300);
  assert.deepEqual(snapshot.tasks.dispatch, { count: 2, averageMs: 4, maxMs: 6, totalMs: 8 });
  assert.equal(snapshot.tasks.simulation.averageMs, 15);
  assert.equal(snapshot.tasks.save.averageMs, null);
  assert.equal(collector.snapshot(5100).tasks.dispatch.count, 1);
  assert.equal(collector.snapshot(5200).tasks.dispatch.count, 0);
});

test("reset discards samples and the gap across a hidden-tab pause", () => {
  const collector = createPerformanceCollector();
  collector.recordFrame(10);
  collector.recordFrame(30);
  collector.recordTask("simulation", 4, 30);
  collector.reset();
  collector.recordFrame(60000);
  let snapshot = collector.snapshot(60000);
  assert.equal(snapshot.fps, null);
  assert.equal(snapshot.tasks.simulation.count, 0);
  collector.recordFrame(60020);
  snapshot = collector.snapshot(60020);
  assert.equal(snapshot.fps, 50);
  assert.equal(snapshot.longFrameCount, 0);
});

test("monitoring is opt-in and measured actions preserve values and thrown errors", () => {
  setPerformanceMonitoringEnabled(false);
  const result = { value: 1 };
  assert.equal(measureGameTask("dispatch", () => result), result);
  recordGameTask("save", 5);
  assert.equal(isPerformanceMonitoringEnabled(), false);
  assert.equal(getPerformanceSnapshot(performance.now()).tasks.dispatch.count, 0);
  assert.equal(getPerformanceSnapshot(performance.now()).tasks.save.count, 0);

  setPerformanceMonitoringEnabled(true);
  try {
    assert.equal(measureGameTask("dispatch", () => result), result);
    const error = new Error("save failure");
    assert.throws(() => measureGameTask("save", () => { throw error; }), (actual) => actual === error);
    recordGameTask("simulation", 4.5);
    const snapshot = getPerformanceSnapshot(performance.now());
    assert.equal(snapshot.tasks.dispatch.count, 1);
    assert.equal(snapshot.tasks.save.count, 1);
    assert.equal(snapshot.tasks.simulation.averageMs, 4.5);
  } finally {
    setPerformanceMonitoringEnabled(false);
  }
  assert.equal(getPerformanceSnapshot(performance.now()).tasks.dispatch.count, 0);
});
