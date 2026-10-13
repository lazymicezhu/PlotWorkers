import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../app/game-engine.ts";
import { reconcileTabletNotifications, snapshotTabletNotifications } from "../app/tablet-notifications.ts";

const fresh = () => createInitialState(100, 200);
const order = (id) => ({
  id,
  remaining: 120,
  processed: { kind: "rough", amount: 10 },
  synthesized: { kind: "screws", amount: 5 },
  reward: "coins",
});

test("initial loads establish a quiet baseline including already ready orders and owned items", () => {
  const game = fresh();
  game.orders = [order("existing")];
  game.inventory.rough = 10;
  game.inventory.screws = 5;
  game.inventory.specials.holyLight = 2;
  const baseline = snapshotTabletNotifications(game);

  assert.deepEqual(reconcileTabletNotifications(baseline, game).pages, []);
  game.inventory.screws = 0;
  const spent = reconcileTabletNotifications(baseline, game);
  game.inventory.screws = 5;
  assert.deepEqual(reconcileTabletNotifications(spent.snapshot, game).pages, []);
});

test("new orders notify once and one ready order does not duplicate its page", () => {
  const game = fresh();
  const baseline = snapshotTabletNotifications(game);
  game.orders = [order("new-1"), order("new-2")];
  game.inventory.rough = 10;
  game.inventory.screws = 5;
  const received = reconcileTabletNotifications(baseline, game);

  assert.deepEqual(received.pages, ["orders"]);
  assert.deepEqual(reconcileTabletNotifications(received.snapshot, game).pages, []);
  game.orders = [];
  assert.deepEqual(reconcileTabletNotifications(received.snapshot, game).pages, []);
});

test("both order requirements must be met and later replenishment does not repeat the ready event", () => {
  const game = fresh();
  game.orders = [order("waiting")];
  let snapshot = snapshotTabletNotifications(game);
  game.inventory.rough = 10;
  let next = reconcileTabletNotifications(snapshot, game);
  assert.deepEqual(next.pages, []);

  game.inventory.screws = 5;
  next = reconcileTabletNotifications(next.snapshot, game);
  assert.deepEqual(next.pages, ["orders"]);
  snapshot = next.snapshot;

  game.inventory.rough = 0;
  next = reconcileTabletNotifications(snapshot, game);
  assert.deepEqual(next.pages, []);
  game.inventory.rough = 10;
  assert.deepEqual(reconcileTabletNotifications(next.snapshot, game).pages, []);
});

test("special item gains notify, consumption does not, and later gains use the latest balance", () => {
  for (const id of ["canOpener", "smartLeader", "holyLight"]) {
    const game = fresh();
    game.inventory.specials[id] = 5;
    const baseline = snapshotTabletNotifications(game);
    game.inventory.specials[id] = 2;
    const consumed = reconcileTabletNotifications(baseline, game);
    assert.deepEqual(consumed.pages, []);
    game.inventory.specials[id] = 3;
    const gained = reconcileTabletNotifications(consumed.snapshot, game);
    assert.deepEqual(gained.pages, ["inventory"]);
    assert.deepEqual(reconcileTabletNotifications(gained.snapshot, game).pages, []);
  }
});

test("ordinary production, market changes, mood and progress do not create notifications", () => {
  const game = fresh();
  game.orders = [order("waiting")];
  const baseline = snapshotTabletNotifications(game);
  game.coins += 100;
  game.inventory.raw += 500;
  game.inventory.rough = 9;
  game.inventory.screws = 4;
  game.inventory.cans += 20;
  game.market.roughPrice += 1;
  game.workers[0].mood -= 10;
  game.processPlots.process.batch.progress = 0.8;
  game.orders[0].remaining -= 10;

  assert.deepEqual(reconcileTabletNotifications(baseline, game).pages, []);
});

test("independent events notify both pages while snapshots own their data and preserve previous state", () => {
  const game = fresh();
  const baseline = snapshotTabletNotifications(game);
  const original = structuredClone(baseline);
  game.orders = [order("new")];
  game.inventory.rough = 10;
  game.inventory.screws = 5;
  game.inventory.specials.canOpener = 1;
  const received = reconcileTabletNotifications(baseline, game);

  assert.deepEqual(received.pages, ["orders", "inventory"]);
  assert.deepEqual(baseline, original);
  game.orders[0].id = "changed";
  game.inventory.specials.canOpener = 8;
  assert.deepEqual(received.snapshot.orderIds, ["new"]);
  assert.deepEqual(received.snapshot.readySeenIds, ["new"]);
  assert.equal(received.snapshot.specials.canOpener, 1);
});

test("retired orders leave no growing notification history while active ready orders stay remembered", () => {
  const game = fresh();
  game.orders = [order("retired"), order("active")];
  game.inventory.rough = 10;
  game.inventory.screws = 5;
  const baseline = snapshotTabletNotifications(game);
  game.orders = [order("active")];
  game.inventory.rough = 0;
  const removed = reconcileTabletNotifications(baseline, game);

  assert.deepEqual(removed.pages, []);
  assert.deepEqual(removed.snapshot.readySeenIds, ["active"]);
  game.inventory.rough = 10;
  assert.deepEqual(reconcileTabletNotifications(removed.snapshot, game).pages, []);
});
