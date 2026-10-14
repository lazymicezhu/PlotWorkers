import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FISHING_ITEM_ART, interpolateFishingElapsed, poseForSeat, visibleOutcomeForSeat } from "../app/fishing-animator.ts";
import { FISHING_SEATS, FISHING_SPRITE_LAYOUT, LOOT_ITEMS, fishingImageLayout, fishingPhase, fishingSeatPoint, fishingSurfaceLayout } from "../app/fishing.ts";

const won = { itemId: "cans", kind: "product", quantity: 1 };
const empty = { itemId: null, kind: "empty", quantity: 0 };
const allFrames = Array.from({ length: 16 }, (_, index) => index);

test("pond top corners and its shared seam coincide with the standard plot footprint", () => {
  const plot = { x: 701, y: 421, cols: 4, rows: 4 };
  const { upper, lower } = fishingSurfaceLayout(plot);
  const map = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];
  const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
  near(map(upper, [768, 26]), [208, 0]);
  near(map(upper, [38, 453]), [0, 108]);
  near(map(upper, [1498, 453]), [416, 108]);
  near(map(lower, [38, 453]), [0, 108]);
  near(map(lower, [1498, 453]), [416, 108]);
  near(map(lower, [758, 881]), [208, 216]);
  for (const x of [38, 278, 768, 1304, 1498]) near(map(upper, [x, 453]), map(lower, [x, 453]));
  for (const seat of FISHING_SEATS) {
    const point = fishingSeatPoint(plot, seat);
    near([point.x - plot.x, point.y - plot.y], map(upper, FISHING_SPRITE_LAYOUT[seat].hip));
  }
});

for (const seat of FISHING_SEATS) {
  test(`shipping ${seat} atlas keeps all sixteen registered poses and rod tips`, async () => {
    const atlas = JSON.parse(await readFile(new URL(`../public/fishing/fishing-${seat}.json`, import.meta.url), "utf8"));
    const png = await readFile(new URL(`../public/fishing/fishing-${seat}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), atlas.width);
    assert.equal(png.readUInt32BE(20), atlas.height);
    assert.deepEqual(atlas.frames.map(frame => frame.index), allFrames);
    for (const frame of atlas.frames) {
      assert.deepEqual(frame.hip, atlas.hip);
      assert.ok(frame.x + frame.width <= atlas.width && frame.y + frame.height <= atlas.height);
      assert.ok(frame.rodTip.every(Number.isFinite));
      assert.ok(frame.rodTip[0] >= 0 && frame.rodTip[0] < frame.width);
      assert.ok(frame.rodTip[1] >= 0 && frame.rodTip[1] < frame.height);
      assert.ok(frame.opaquePixels > 0);
    }
    const plot = { x: 701, y: 421, cols: 4, rows: 4 };
    const image = fishingImageLayout(plot);
    const point = fishingSeatPoint(plot, seat);
    assert.equal(point.x, image.left + FISHING_SPRITE_LAYOUT[seat].hip[0] * image.scaleX);
    assert.equal(point.y, image.top + FISHING_SPRITE_LAYOUT[seat].hip[1] * image.scaleY);
  });
}

test("a full round uses every authored pose, while an empty round skips celebration", () => {
  const caught = new Set(), missed = new Set();
  for (let frame = 0; frame < 3600; frame++) {
    const elapsed = frame / 60;
    const seat = { elapsed, ...fishingPhase(elapsed) };
    caught.add(poseForSeat({ ...seat, outcome: won }).frame);
    missed.add(poseForSeat({ ...seat, outcome: empty }).frame);
  }
  assert.deepEqual([...caught].sort((a, b) => a - b), allFrames);
  assert.deepEqual([...missed].sort((a, b) => a - b), allFrames.filter(frame => frame !== 12 && frame !== 13));
});

test("every real product and special has matching artwork, without inventing rewards", () => {
  assert.deepEqual(Object.keys(FISHING_ITEM_ART), LOOT_ITEMS.map(item => item.id));
  for (const item of LOOT_ITEMS) {
    const outcome = { itemId: item.id, kind: item.kind, quantity: 1 };
    assert.deepEqual(visibleOutcomeForSeat({ outcome }), { ...outcome, label: item.name });
  }
  assert.deepEqual(visibleOutcomeForSeat({ outcome: empty }), { ...empty, label: "空杆" });
  assert.equal(visibleOutcomeForSeat({ outcome: { ...won, quantity: 0 } }), null);
  assert.equal(visibleOutcomeForSeat({ outcome: { itemId: "goldenOrder", kind: "special", quantity: 1 } }), null);
});

test("personal interpolation preserves lazy speed, pauses, and the current settlement boundary", () => {
  assert.equal(interpolateFishingElapsed(12, .75, 1), 12.75);
  assert.equal(interpolateFishingElapsed(12, .75, 2), 13.5);
  assert.equal(interpolateFishingElapsed(12, .75, 2, true), 12);
  assert.equal(interpolateFishingElapsed(59.5, 1, 2), 59.999);
  assert.equal(interpolateFishingElapsed(12, 300, 1), 13.25, "a delayed worker response cannot leave art freely advancing");
  assert.equal(interpolateFishingElapsed(12, -2, 1), 12);
});
