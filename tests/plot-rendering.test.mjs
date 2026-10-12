import test from 'node:test';
import assert from 'node:assert/strict';
import { layeredBackingPlots } from '../app/plot-rendering.ts';
const plot = (id, x, y) => ({ id, x, y, cols: 8, rows: 8, type: 'gather', name: id, purchasePrice: 0 });
test('front-to-back source order retains original layers where a shadow could cover an earlier top', () => {
  assert.deepEqual([...layeredBackingPlots([plot('front', 0, 460), plot('back', 0, 0)])], ['back']);
});
test('normal back-to-front order and separated plots retain baked eligibility', () => {
  assert.equal(layeredBackingPlots([plot('back', 0, 0), plot('front', 0, 460), plot('separate', 1000, 0)]).size, 0);
});

test('diagonal neighbours retain original lower layers even if one becomes hovered', () => {
  assert.deepEqual([...layeredBackingPlots([plot('upper', 0, 0), plot('lower', 416, 216)])].sort(), ['lower', 'upper']);
});

test('rectangular imported plots retain their original proportions and side depth', () => {
  assert.deepEqual([...layeredBackingPlots([
    { ...plot('wide', 0, 0), rows: 4 },
    { ...plot('tall', 2000, 0), cols: 4 },
  ])].sort(), ['tall', 'wide']);
});
