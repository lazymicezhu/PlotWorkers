import assert from "node:assert/strict";
import test from "node:test";
import { getWorkerTrackingZoom, parseCameraView, serializeCameraView } from "../app/camera-view-state.ts";

const savedView = (overrides = {}) => JSON.stringify({ version: 1, camera: { x: -432.75, y: 182.125 }, zoom: 0.62, ...overrides });

test("camera position and zoom survive a browser preference round trip", () => {
  const view = { camera: { x: -432.75, y: 182.125 }, zoom: 0.62 };
  const serialized = serializeCameraView(view);
  assert.deepEqual(JSON.parse(serialized), { version: 1, ...view });
  assert.deepEqual(parseCameraView(serialized), view);
  assert.notEqual(parseCameraView(serialized).camera, view.camera);
  assert.deepEqual(view, { camera: { x: -432.75, y: 182.125 }, zoom: 0.62 });
});

test("missing, broken and wrong-shaped preferences are ignored", () => {
  for (const serialized of [null, "", "{", "undefined", "null", "true", "1", '"camera"', "[]", "{}", '{"version":1}', savedView({ camera: null }), savedView({ camera: [] })]) {
    assert.equal(parseCameraView(serialized), null, `reject ${serialized}`);
  }
});

test("only the exact supported preference version is accepted", () => {
  for (const version of [undefined, null, 0, 2, -1, "1", true]) {
    assert.equal(parseCameraView(savedView({ version })), null);
  }
  assert.notEqual(parseCameraView(savedView()), null);
});

test("camera coordinates must be finite numbers within a safe transform range", () => {
  for (const axis of ["x", "y"]) {
    for (const value of [undefined, null, "12", true, {}, [], NaN, Infinity, -Infinity, 10_000_000.001, -10_000_000.001, Number.MAX_VALUE]) {
      assert.equal(parseCameraView(savedView({ camera: { x: 0, y: 0, [axis]: value } })), null, `${axis}=${String(value)}`);
    }
  }
  // JSON syntax can represent an exponent that overflows after parsing.
  assert.equal(parseCameraView('{"version":1,"camera":{"x":1e309,"y":0},"zoom":1}'), null);
  assert.deepEqual(parseCameraView(savedView({ camera: { x: 10_000_000, y: -10_000_000 } })).camera, { x: 10_000_000, y: -10_000_000 });
});

test("saved zoom is strictly validated without coercion or silent clamping", () => {
  for (const zoom of [undefined, null, "1", true, {}, [], NaN, Infinity, -Infinity, 0, -1, 0.279999, 1.500001]) {
    assert.equal(parseCameraView(savedView({ zoom })), null, `reject zoom ${String(zoom)}`);
  }
  for (const zoom of [0.28, 1.05, 1.5]) {
    assert.equal(parseCameraView(savedView({ zoom })).zoom, zoom);
  }
  assert.equal(parseCameraView('{"version":1,"camera":{"x":0,"y":0},"zoom":1e309}'), null);
});

test("serialization never writes invalid camera preferences", () => {
  for (const view of [null, {}, { camera: { x: NaN, y: 0 }, zoom: 1 }, { camera: { x: 0, y: Infinity }, zoom: 1 }, { camera: { x: 0, y: 0 }, zoom: 2 }]) {
    assert.throws(() => serializeCameraView(view), RangeError);
  }
});

test("tracking zoom reveals distant workers and preserves an already closer view", () => {
  for (const zoom of [0.28, 0.62, 1, 1.049, 1.05]) assert.equal(getWorkerTrackingZoom(zoom), 1.05);
  for (const zoom of [1.1, 1.25, 1.5]) assert.equal(getWorkerTrackingZoom(zoom), zoom);
});

test("repeated tracking never compounds zoom and invalid input stays safe", () => {
  for (const initial of [-1, 0.28, 0.62, 1.05, 1.2, 1.5, 2, NaN, Infinity, -Infinity]) {
    const target = getWorkerTrackingZoom(initial);
    assert.ok(target >= 1.05 && target <= 1.5);
    for (let click = 0; click < 20; click += 1) assert.equal(getWorkerTrackingZoom(target), target);
  }
  assert.equal(getWorkerTrackingZoom(2), 1.5);
  for (const zoom of [NaN, Infinity, -Infinity]) assert.equal(getWorkerTrackingZoom(zoom), 1.05);
});
