import assert from 'node:assert/strict';
import test from 'node:test';
import { startWorkerTransfer } from '../app/worker-transfer.ts';

function harness() {
  let next = 0;
  const frames = new Map(), timers = new Map(), events = [];
  const clock = {
    requestFrame: callback => { frames.set(++next, callback); return next; },
    cancelFrame: id => frames.delete(id),
    setTimer: (callback, ms) => { timers.set(++next, { callback, ms }); return next; },
    clearTimer: id => timers.delete(id),
  };
  const tickFrame = () => { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); };
  const tickTimer = () => { const [id, task] = timers.entries().next().value; timers.delete(id); task.callback(); return task.ms; };
  return { frames, timers, events, clock, tickFrame, tickTimer };
}

test('travel time starts only after pickup has painted, and completion waits for landing', () => {
  const h = harness();
  startWorkerTransfer(h.clock, 1800, { activate: () => h.events.push('move'), land: () => h.events.push('land'), complete: () => h.events.push('done') });
  h.tickFrame(); assert.deepEqual(h.events, []); assert.equal(h.timers.size, 0);
  h.tickFrame(); assert.deepEqual(h.events, ['move']);
  assert.equal(h.tickTimer(), 1800); assert.deepEqual(h.events, ['move', 'land']);
  assert.equal(h.tickTimer(), 160); assert.deepEqual(h.events, ['move', 'land', 'done']);
});

test('manual takeover cancels pending pickup frames and cannot start a late transfer', () => {
  const h = harness();
  const t = startWorkerTransfer(h.clock, 1400, { activate: () => h.events.push('move'), land() {}, complete: () => h.events.push('done') });
  h.tickFrame(); const stale = [...h.frames.values()][0]; t.cancel(); stale();
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0); assert.deepEqual(h.events, []);
});

test('cancelling after landing prevents an old task from dropping a manually moved worker', () => {
  const h = harness();
  const t = startWorkerTransfer(h.clock, 1400, { activate() {}, land: () => h.events.push('land'), complete: () => h.events.push('done') });
  h.tickFrame(); h.tickFrame(); h.tickTimer();
  const stale = [...h.timers.values()][0].callback; t.cancel(); stale();
  assert.deepEqual(h.events, ['land']); assert.equal(h.timers.size, 0);
});
