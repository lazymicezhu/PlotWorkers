import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialWorker } from '../app/game-engine.ts';
import { resolveWorkerDrop, workerAtPoint } from '../app/worker-drag.ts';

const source = { id: 'source', name: '采集', type: 'gather', x: 0, y: 0, cols: 4, rows: 4, enabled: true };
const target = { ...source, id: 'target', name: '休息', type: 'living', x: 600 };
const origin = { ...createInitialWorker(208, 54), id: 'one', zoneId: 'source', u: 1, v: 1, status: 'slacking', mood: 35, continuousWork: 9, slowStacks: 2 };
const dragged = { ...origin, status: 'dragging' };

test('clicking or cancelling preserves slacking status and does not grant a free wakeup', () => {
  const result = resolveWorkerDrop(dragged, origin, { x: 808, y: 54 }, false, [source, target], [dragged], []);
  assert.equal(result.worker.status, 'slacking'); assert.equal(result.worker.zoneId, 'source'); assert.equal(result.worker.mood, 35);
});

test('an incoming robot reserves the final slot and a rejected drop returns to the captured source', () => {
  const occupants = ['two', 'three', 'four'].map(id => ({ ...origin, id, zoneId: 'target' }));
  const result = resolveWorkerDrop(dragged, origin, { x: 808, y: 54 }, true, [source, target], [dragged, ...occupants], [{ workerId: 'five', targetId: 'target', action: 'rest' }]);
  assert.equal(result.accepted, false); assert.equal(result.worker.zoneId, 'source'); assert.match(result.notice, /正在搬入/);
});

test('drop relocates the worker and preserves its work-source while resetting zone-specific counters', () => {
  const result = resolveWorkerDrop(dragged, origin, { x: 808, y: 54 }, true, [source, target], [dragged], []);
  assert.equal(result.accepted, true); assert.equal(result.worker.status, 'resting'); assert.equal(result.worker.lastWorkZoneId, 'source');
  assert.equal(result.worker.continuousWork, 0); assert.equal(result.worker.slowStacks, 0); assert.deepEqual([result.worker.u, result.worker.v, result.worker.x, result.worker.y], [1, 1, 808, 54]);
});

test('disabled and outside drops restore the original worker; wake tasks do not reserve extra space', () => {
  for (const [plots, point] of [[[source, { ...target, enabled: false }], { x: 808, y: 54 }], [[source, target], { x: -900, y: 0 }]]) {
    assert.equal(resolveWorkerDrop(dragged, origin, point, true, plots, [dragged], []).accepted, false);
  }
  const occupants = ['two', 'three', 'four'].map(id => ({ ...origin, id, zoneId: 'target' }));
  const result = resolveWorkerDrop(dragged, origin, { x: 808, y: 54 }, true, [source, target], [dragged, ...occupants], [{ workerId: 'two', targetId: 'target', action: 'wake' }]);
  assert.equal(result.accepted, true);
});

test('captured in-flight positions project back to the same world point without rounding', () => {
  const point = { x: 210.75, y: 100.125 };
  const frozen = workerAtPoint(origin, point, source);
  assert.deepEqual({ x: (frozen.u - frozen.v) * 52 + 208, y: (frozen.u + frozen.v) * 27 }, point);
});
