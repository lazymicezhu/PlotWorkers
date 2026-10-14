import assert from "node:assert/strict";
import test from "node:test";
import { buyCans, createInitialState } from "../app/game-engine.ts";

test("cans can be purchased in arbitrary positive integer quantities, including above the UI limit", () => {
  for (const amount of [1, 3, 17, 199, 200, 201, 1_250]) {
    const state = { ...createInitialState(0, 0), coins: amount * 2 + 13 };
    const original = structuredClone(state);
    const purchased = buyCans(state, amount);

    assert.notEqual(purchased, state);
    assert.equal(purchased.coins, 13);
    assert.equal(purchased.inventory.cans, original.inventory.cans + amount);
    assert.deepEqual(state, original, "purchasing must not mutate the previous state");
  }
});

test("buying cans can spend the exact remaining balance", () => {
  const state = { ...createInitialState(0, 0), coins: 34 };
  const purchased = buyCans(state, 17);
  assert.equal(purchased.coins, 0);
  assert.equal(purchased.inventory.cans, state.inventory.cans + 17);
});

test("insufficient coins preserve the original state and inventory", () => {
  for (const coins of [0, 1, 33]) {
    const state = { ...createInitialState(0, 0), coins };
    const original = structuredClone(state);
    assert.equal(buyCans(state, 17), state);
    assert.deepEqual(state, original);
  }
});

test("invalid quantities cannot change coins, cans or state identity", () => {
  const invalidAmounts = [
    0, -0, -1, -Number.MAX_SAFE_INTEGER, 0.1, 1.5,
    NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE,
    undefined, null, "10", true,
  ];
  // Even quantities beyond the safe integer range must be rejected when affordable.
  const state = { ...createInitialState(0, 0), coins: Number.MAX_VALUE };
  const original = structuredClone(state);
  for (const amount of invalidAmounts) {
    assert.equal(buyCans(state, amount), state, `reject ${String(amount)}`);
    assert.deepEqual(state, original);
  }
});
