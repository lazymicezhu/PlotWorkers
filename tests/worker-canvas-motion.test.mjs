import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasLayerZIndex, canvasOcclusionDepths, canvasWorkerLayer, canvasWorkerContains, canvasWorkerPosition, canvasViewport, createCanvasWorkerHandoffs, retargetCanvasWorker } from '../app/worker-canvas-motion.ts';

test('a retargeted walk starts at its visible position and honors the new duration', () => {
  const start = retargetCanvasWorker(undefined, { x: 0, y: 20 }, 1000, 0);
  const outbound = retargetCanvasWorker(start, { x: 100, y: 60 }, 1000, 0);
  assert.deepEqual(canvasWorkerPosition(outbound, 250), { x: 25, y: 30 });
  const redirected = retargetCanvasWorker(outbound, { x: 75, y: 10 }, 500, 250);
  assert.deepEqual(canvasWorkerPosition(redirected, 250), { x: 25, y: 30 });
  assert.deepEqual(canvasWorkerPosition(redirected, 500), { x: 50, y: 20 });
  assert.deepEqual(canvasWorkerPosition(redirected, 750), { x: 75, y: 10 });
  assert.deepEqual(canvasWorkerPosition(redirected, 1200), { x: 75, y: 10 });
});

test('unrelated updates do not restart walking; hovered workers use their captured visible position', () => {
  const moving = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, startedAt: 0, duration: 1000 };
  assert.equal(retargetCanvasWorker(moving, { x: 100, y: 0 }, 900, 300), moving);
  const paused = retargetCanvasWorker(moving, { x: 30, y: 0 }, 1000, 300, true);
  assert.deepEqual(canvasWorkerPosition(paused, 900), { x: 30, y: 0 });
  assert.deepEqual(canvasWorkerPosition(retargetCanvasWorker(moving, { x: 40, y: 40 }, 0, 300), 300), { x: 40, y: 40 });
});

test('viewport texture covers exactly the same screen pixels under pan and fractional zoom, without a DPR cap', () => {
  const dpr = 2.5;
  const scale = .42;
  const rect = { left: -187.5, top: 42.25 };
  const view = canvasViewport(rect, scale, 1900, 995, dpr);
  assert.equal(view.pixelWidth, 5070);
  assert.equal(view.pixelHeight, 2808);
  assert.ok(Math.abs(rect.left + view.left * scale + 64) < 1e-9);
  assert.ok(Math.abs(rect.top + view.top * scale + 64) < 1e-9);
  assert.ok(Math.abs(view.width * scale - 2028) < 1e-9);
  const zoomed = canvasViewport({ left: 9999, top: -9999 }, 1.5, 1900, 995, dpr);
  assert.equal(zoomed.pixelWidth, view.pixelWidth);
  assert.equal(zoomed.pixelHeight, view.pixelHeight);
});

test('hit bounds match DOM walker anchor and exclude the non-interactive badge', () => {
  const position = { x: 120.5, y: 200.25 };
  assert.equal(canvasWorkerContains(position, { x: 88.5, y: 102.73 }), true);
  assert.equal(canvasWorkerContains(position, { x: 152.5, y: 208.73 }), true);
  assert.equal(canvasWorkerContains(position, { x: 120.5, y: 100 }), false);
  assert.equal(canvasWorkerContains(position, { x: 152.51, y: 150 }), false);
});


test('a returned worker starts exactly at the captured DOM point before moving toward its final target', () => {
  const handoffs = createCanvasWorkerHandoffs();
  const world = {};
  const captured = { x: 120.25, y: 82.5 };
  // This works before Canvas has mounted; the store is independent of rendering.
  handoffs.set(world, 'worker-1', captured, 100);
  captured.x = 999;
  const seed = handoffs.consume(world, 'worker-1', 116);
  const motion = retargetCanvasWorker(undefined, { x: 220.25, y: 182.5 }, 500, 116, false, seed);
  assert.deepEqual(canvasWorkerPosition(motion, 116), { x: 120.25, y: 82.5 });
  assert.deepEqual(canvasWorkerPosition(motion, 366), { x: 170.25, y: 132.5 });
  assert.deepEqual(canvasWorkerPosition(motion, 616), { x: 220.25, y: 182.5 });
  assert.equal(handoffs.consume(world, 'worker-1', 117), undefined);
});

test('interrupted transport handoffs replace old motion, then retarget continuously in either direction', () => {
  const old = { from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, startedAt: 0, duration: 1000 };
  const returned = retargetCanvasWorker(old, { x: 100, y: 100 }, 400, 500, false, { x: 70, y: 30 });
  assert.deepEqual(canvasWorkerPosition(returned, 500), { x: 70, y: 30 });
  const reversed = retargetCanvasWorker(returned, { x: 25, y: 20 }, 500, 700);
  assert.deepEqual(canvasWorkerPosition(reversed, 700), { x: 85, y: 65 });
  assert.deepEqual(canvasWorkerPosition(reversed, 950), { x: 55, y: 42.5 });
  assert.deepEqual(canvasWorkerPosition(reversed, 1200), { x: 25, y: 20 });
});

test('handoff seeds are isolated by world, replaced by newer captures, and expire or clear without timers', () => {
  const handoffs = createCanvasWorkerHandoffs(2000);
  const a = {}, b = {};
  handoffs.set(a, 'worker-1', { x: 1, y: 2 }, 0);
  handoffs.set(b, 'worker-1', { x: 3, y: 4 }, 0);
  handoffs.set(a, 'worker-1', { x: 5, y: 6 }, 100);
  assert.deepEqual(handoffs.consume(a, 'worker-1', 200), { x: 5, y: 6 });
  assert.equal(handoffs.consume(b, 'worker-1', 2000), undefined);
  handoffs.set(a, 'worker-1', { x: 7, y: 8 }, 3000);
  handoffs.clear(a);
  assert.equal(handoffs.consume(a, 'worker-1', 3001), undefined);
  handoffs.set(b, 'worker-2', { x: Infinity, y: 8 }, 3000);
  assert.equal(handoffs.consume(b, 'worker-2', 3001), undefined);
});


test('DOM occluders form sorted unique boundaries with a single base layer when absent', () => {
  assert.deepEqual(canvasOcclusionDepths([120000, 102000, 120000, NaN, Infinity]), [102000, 120000]);
  assert.deepEqual(canvasOcclusionDepths([]), []);
  assert.equal(canvasWorkerLayer(799999, []), 0);
  assert.equal(canvasLayerZIndex(0, []), 999);
});

test('ordinary workers at equal depth stay behind DOM sprites while later depths draw above them', () => {
  const boundaries = canvasOcclusionDepths([1000, 1001, 120000, 800000]);
  const depths = [999, 1000, 1001, 1002, 119999, 120000, 120001, 800000, 800001];
  const expected = [0, 0, 1, 2, 2, 2, 3, 3, 4];
  let cursor = 0;
  for (let index = 0; index < depths.length; index += 1) {
    cursor = canvasWorkerLayer(depths[index], boundaries, cursor);
    assert.equal(cursor, expected[index]);
    assert.equal(canvasWorkerLayer(depths[index], boundaries), expected[index]);
  }
  assert.deepEqual(boundaries.map((_, index) => canvasLayerZIndex(index + 1, boundaries)), [1001, 1002, 120001, 800001]);
  assert.ok(canvasLayerZIndex(boundaries.length, boundaries) < 900000);
});
