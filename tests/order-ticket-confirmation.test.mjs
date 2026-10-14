import assert from "node:assert/strict";
import test from "node:test";
import { isGoldenOrderConfirmationCurrent } from "../app/order-ticket-confirmation.ts";

const order = () => ({
  id: "order-1",
  remaining: 120,
  processed: { kind: "rough", amount: 100 },
  synthesized: { kind: "screws", amount: 50 },
  reward: "coins",
});

test("a confirmation stays valid while the same order counts down", () => {
  const expected = order();
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, remaining: 75 }), true);
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, remaining: .01 }), true);
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, rerolled: false }), true);
  assert.equal(isGoldenOrderConfirmationCurrent({ ...expected, rerolled: true }, { ...expected, remaining: 10, rerolled: true }), true);
});

test("a disappeared or expired order invalidates its confirmation", () => {
  const expected = order();
  assert.equal(isGoldenOrderConfirmationCurrent(expected, undefined), false);
  for (const remaining of [0, -1, NaN]) {
    assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, remaining }), false);
  }
});

test("an order with a different id cannot use another order's confirmation", () => {
  const expected = order();
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, id: "order-2" }), false);
});

test("a same-id replacement needs a new confirmation even when its requirements happen to match", () => {
  const expected = order();
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, rerolled: true }), false);
});

test("changes to either material kind or amount invalidate a confirmation", () => {
  const expected = order();
  const changes = [
    { processed: { ...expected.processed, kind: "refined" } },
    { processed: { ...expected.processed, amount: 101 } },
    { synthesized: { ...expected.synthesized, kind: "rebar" } },
    { synthesized: { ...expected.synthesized, amount: 51 } },
  ];
  for (const change of changes) {
    assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, ...change }), false);
  }
});

test("a changed reward invalidates a confirmation", () => {
  const expected = order();
  assert.equal(isGoldenOrderConfirmationCurrent(expected, { ...expected, reward: "special" }), false);
});
