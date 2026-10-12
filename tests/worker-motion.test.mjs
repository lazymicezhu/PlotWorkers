import assert from "node:assert/strict";
import test from "node:test";
import { facingForDestination, parseWorkerTranslation } from "../app/worker-motion.ts";

test("walking reads the rendered translation including subpixel and negative world positions", () => {
  assert.deepEqual(parseWorkerTranslation("120.375px -9.25px"), { x: 120.375, y: -9.25 });
  assert.deepEqual(parseWorkerTranslation("  .5px   0px "), { x: .5, y: 0 });
  for (const invalid of ["none", "", "100% 0px", "NaNpx 2px", "Infinitypx 0px", "1px"]) assert.equal(parseWorkerTranslation(invalid), null);
});

test("turns follow the visible position even when the unfinished previous destination was beyond the new one", () => {
  // The worker is at x=20 on its way to x=100. A new x=60 destination
  // still lies to the right, even though it is left of the old destination.
  assert.equal(facingForDestination({ x: 20, y: 0 }, 60, "left"), "right");
  assert.equal(facingForDestination({ x: 100, y: 0 }, 60, "right"), "left");
});

test("subpixel movement and unavailable offscreen sprites do not cause spurious turns", () => {
  assert.equal(facingForDestination({ x: 20, y: 0 }, 20.1, "left"), "left");
  assert.equal(facingForDestination(null, 60, "left"), "left");
  assert.equal(facingForDestination({ x: 20, y: 0 }, NaN, "right"), "right");
});
