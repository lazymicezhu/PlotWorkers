import assert from "node:assert/strict";
import test from "node:test";
import { formatHudExact, formatHudGain, formatHudNumber } from "../app/hud-number.ts";

test("small HUD balances retain ordinary numbers without rounding past a boundary", () => {
  for (const [value, expected] of [
    [0, "0"], [0.3, "0.3"], [9, "9"], [9.99, "9.9"],
    [999.99, "999.9"], [1_000, "1,000"], [9_999.99, "9,999"],
  ]) {
    assert.equal(formatHudNumber(value), expected);
    assert.equal(formatHudNumber(value, true), expected);
  }
});

test("compact HUD values keep stable precision and choose units before truncating", () => {
  for (const [value, single, paired] of [
    [10_000, "10.0K", "10.0K"],
    [10_999, "10.9K", "10.9K"],
    [99_999, "99.9K", "99.9K"],
    [100_000, "100.0K", "100K"],
    [999_999, "999.9K", "999K"],
    [1_000_000, "1.00M", "1.00M"],
    [1_130_000, "1.13M", "1.13M"],
    [9_999_999, "9.99M", "9.99M"],
    [10_000_000, "10.0M", "10.0M"],
    [999_999_999, "999.9M", "999M"],
    [1e9, "1.00B", "1.00B"],
    [1e12, "1.00T", "1.00T"],
    [1e15, "1.00Q", "1.00Q"],
    [Number.MAX_SAFE_INTEGER, "9.00Q", "9.00Q"],
  ]) {
    assert.equal(formatHudNumber(value), single);
    assert.equal(formatHudNumber(value, true), paired);
  }
});

test("compact values fit their slots and never overstate a positive finite balance", () => {
  const multiplier = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, Q: 1e15 };
  const displayedValue = (text) => {
    const suffix = text.at(-1);
    return suffix in multiplier ? Number(text.slice(0, -1)) * multiplier[suffix] : Number(text.replaceAll(",", ""));
  };
  const samples = [0.1, 0.3, 999.999, 9_999.999, Number.MAX_VALUE];
  for (const boundary of [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e12, 1e15, 1e18, 1e21, 1e100, 1e308]) {
    samples.push(boundary * (1 - Number.EPSILON), boundary, boundary * 1.23456789);
  }
  for (const value of samples) {
    for (const paired of [false, true]) {
      const text = formatHudNumber(value, paired);
      assert.ok(text.length <= (paired ? 5 : 6), `${value} becomes too wide: ${text}`);
      assert.ok(displayedValue(text) <= value, `${text} overstates ${value}`);
    }
  }
  assert.equal(formatHudNumber(1e18), "1e18");
  assert.equal(formatHudNumber(Number.MAX_VALUE, true), "1e308");
});

test("detail balances use full numbers with grouping and at most one decimal", () => {
  assert.equal(formatHudExact(1_234_567.89), "1,234,567.9");
  assert.equal(formatHudExact(10_000), "10,000");
  assert.equal(formatHudExact(0.1), "0.1");
});

test("positive production gains stay visible including sub-tenth increments", () => {
  for (const [value, expected] of [
    [0, "0"], [1, "1"], [0.1, "0.1"], [0.05, "0.05"],
    [0.009, "0.009"], [0.0005, "5e-4"], [Number.MIN_VALUE, "5e-324"],
    [10_000, "10.0K"],
  ]) assert.equal(formatHudGain(value), expected);
  for (const value of [0.099, 0.0123, 0.000987, Number.MIN_VALUE]) {
    const text = formatHudGain(value);
    assert.ok(Number(text) > 0, `${value} must not disappear as zero`);
    assert.ok(Number(text) <= value, `${text} overstates ${value}`);
    assert.ok(!text.startsWith("+"), "the caller supplies +");
  }
});

test("invalid or negative game values fall back to a safe zero", () => {
  for (const value of [-0, -0.1, -1e9, NaN, Infinity, -Infinity]) {
    assert.equal(formatHudNumber(value), "0");
    assert.equal(formatHudNumber(value, true), "0");
    assert.equal(formatHudExact(value), "0");
    assert.equal(formatHudGain(value), "0");
  }
});
