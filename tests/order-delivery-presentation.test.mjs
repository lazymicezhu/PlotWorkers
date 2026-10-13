import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, submitOrder } from "../app/game-engine.ts";
import { createOrderDeliveryGate, mergeRetainedOrders } from "../app/order-delivery-presentation.ts";

const order = (id) => ({ id, remaining: 120, processed: { kind: "rough", amount: 10 }, synthesized: { kind: "screws", amount: 5 }, reward: "special" });

test("a synchronous successful trade removes the real order immediately and repeated clicks cannot trade again", () => {
  let game = createInitialState(100, 200);
  game.orders = [order("order-1")];
  game.inventory.rough = 40;
  game.inventory.screws = 20;
  const gate = createOrderDeliveryGate();
  let held;
  let commits = 0;
  const commit = () => {
    commits++;
    // This also covers re-entry before the first event has returned.
    assert.equal(gate.attempt("order-1", () => assert.fail("duplicate preparation"), commit), "duplicate");
    assert.equal(held.id, "order-1", "the UI snapshot exists before a synchronous state flush");
    const next = submitOrder(game, "order-1", () => 0);
    const success = next !== game;
    game = next;
    return success;
  };
  const prepare = () => { held = { ...game.orders[0] }; };
  assert.equal(gate.attempt("order-1", prepare, commit), "success");
  assert.equal(gate.attempt("order-1", prepare, commit), "duplicate");
  assert.equal(commits, 1);
  assert.equal(game.orders.length, 0);
  assert.equal(game.inventory.rough, 30);
  assert.equal(game.inventory.screws, 15);
  assert.equal(game.inventory.specials.canOpener, 1);
  assert.equal(held.remaining, 120, "the departing paper keeps its pre-trade countdown");
});

test("a rejected trade unlocks retries without spending stock or claiming a successful departure", () => {
  let game = createInitialState(100, 200);
  game.orders = [order("order-1")];
  const original = game;
  const gate = createOrderDeliveryGate();
  const commit = () => {
    const next = submitOrder(game, "order-1", () => 0);
    const success = next !== game;
    game = next;
    return success;
  };
  assert.equal(gate.attempt("order-1", () => {}, commit), "failed");
  assert.equal(game, original);
  game = { ...game, inventory: { ...game.inventory, rough: 10, screws: 5 } };
  assert.equal(gate.attempt("order-1", () => {}, commit), "success");
  assert.equal(game.orders.length, 0);
  assert.equal(game.inventory.rough, 0);
  assert.equal(game.inventory.screws, 0);
});

test("retained papers stay in place through simultaneous delivery, replacement orders, and animation completion", () => {
  const a = order("order-1"), b = order("order-2"), c = order("order-3"), d = order("order-4");
  const leavingA = { value: a, before: [], after: [b.id] };
  const leavingB = { value: b, before: [a.id], after: [] };
  const ids = (cards) => cards.map(({ id }) => id);
  assert.deepEqual(ids(mergeRetainedOrders([b], [leavingA])), [a.id, b.id]);
  assert.deepEqual(ids(mergeRetainedOrders([c, d], [leavingA, leavingB])), [a.id, b.id, c.id, d.id]);
  assert.deepEqual(ids(mergeRetainedOrders([c, d], [leavingB, leavingA])), [a.id, b.id, c.id, d.id]);
  assert.deepEqual(ids(mergeRetainedOrders([c], [leavingB])), [b.id, c.id]);
  assert.deepEqual(ids(mergeRetainedOrders([c, d], [])), [c.id, d.id]);
});

test("live expiry disappears without an exit animation and ticking data does not overwrite a retained snapshot", () => {
  const a = order("order-1"), b = order("order-2");
  const retained = { value: a, before: [], after: [b.id] };
  const cards = mergeRetainedOrders([{ ...a, remaining: 119 }, { ...b, remaining: 119 }], [retained]);
  assert.equal(cards[0], a);
  assert.equal(cards[1].remaining, 119);
  assert.deepEqual(mergeRetainedOrders([], [retained]), [a]);
  assert.deepEqual(mergeRetainedOrders([], []), []);
});

test("a failed callback releases the claim so the user can try again", () => {
  const gate = createOrderDeliveryGate();
  assert.throws(() => gate.attempt("order-1", () => {}, () => { throw new Error("commit failed"); }));
  assert.equal(gate.attempt("order-1", () => {}, () => true), "success");
});
