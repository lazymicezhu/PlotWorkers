import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECIAL_ITEM_IDS,
  SPECIAL_ITEM_NAMES,
  createInitialState,
  orderCoinReward,
  parseSavedState,
  startOrderTracking,
  stepGame,
  submitOrder,
  useGoldenOrderTicket as consumeGoldenOrderTicket,
  useOrderRefreshTicket as consumeOrderRefreshTicket,
  useSpecialItem,
} from "../app/game-engine.ts";

const order = (id = "order-1", reward = "coins") => ({
  id, remaining: 300,
  processed: { kind: "refined", amount: 5 },
  synthesized: { kind: "screws", amount: 10 }, reward,
});

function factory() {
  const state = createInitialState(0, 0);
  state.plots.push({ id: "synthesis", type: "synthesis", name: "合成区", x: 0, y: 0, cols: 4, rows: 4, purchasePrice: 300 });
  state.synthesisPlots.synthesis = { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } };
  state.inventory.specials.orderRefresh = 2;
  state.inventory.specials.goldenOrder = 2;
  state.orderSerial = 1;
  return state;
}

const noRandom = () => assert.fail("rejected and coin-only actions must not draw rewards or orders");

test("new games include both ticket types with no free tickets", () => {
  const state = createInitialState(0, 0);
  assert.deepEqual(Object.keys(state.inventory.specials), SPECIAL_ITEM_IDS);
  assert.equal(state.inventory.specials.orderRefresh, 0);
  assert.equal(state.inventory.specials.goldenOrder, 0);
  assert.equal(SPECIAL_ITEM_NAMES.orderRefresh, "订单刷新券");
  assert.equal(SPECIAL_ITEM_NAMES.goldenOrder, "黄金订单券");
  assert.equal(useSpecialItem(state, "orderRefresh"), state);
  assert.equal(useSpecialItem(state, "goldenOrder"), state);
});

test("refresh tickets add one order in a free slot without replacing an order or resetting timers", () => {
  const state = factory();
  state.orders = [order()];
  state.orderElapsed = 179;
  state.orderRefreshCooldown = 83;
  state.research.delivery = 2;
  const before = structuredClone(state);
  const next = consumeOrderRefreshTicket(state, () => .5);
  assert.deepEqual(state, before);
  assert.equal(next.orders.length, 2);
  assert.equal(next.orders[0], state.orders[0]);
  assert.equal(next.orders[1].id, "order-2");
  assert.equal(next.orders[1].remaining, 360);
  assert.equal(next.inventory.specials.orderRefresh, 1);
  assert.equal(next.orderSerial, 2);
  assert.equal(next.orderElapsed, 179);
  assert.equal(next.orderRefreshCooldown, 83);
  assert.deepEqual(next.research, state.research);
  assert.equal(consumeOrderRefreshTicket(next, noRandom), next);
});

test("refresh tickets honor full slots, synthesis unlock, and valid ticket stock", () => {
  const full = factory();
  full.orders = [order(), order("order-2")];
  assert.equal(consumeOrderRefreshTicket(full, noRandom), full);
  const locked = createInitialState(0, 0);
  locked.inventory.specials.orderRefresh = 1;
  assert.equal(consumeOrderRefreshTicket(locked, noRandom), locked);
  for (const count of [0, -1, .5, undefined, null, NaN, Infinity, "1"]) {
    const state = factory();
    state.inventory.specials.orderRefresh = count;
    assert.equal(consumeOrderRefreshTicket(state, noRandom), state, `invalid refresh stock: ${count}`);
  }
});

test("refresh tickets do not postpone the next natural order or require an enabled synthesis plot", () => {
  const state = factory();
  state.plots.find((plot) => plot.id === "synthesis").enabled = false;
  state.orderElapsed = 179;
  const refreshed = consumeOrderRefreshTicket(state, () => .5);
  assert.equal(refreshed.orders.length, 1);
  assert.equal(refreshed.orderElapsed, 179);
  const next = stepGame(refreshed, 1, () => .5);
  assert.equal(next.orders.length, 2);
  assert.equal(next.orders[1].id, "order-3");
  assert.equal(next.orderElapsed, 0);
  assert.equal(next.inventory.specials.orderRefresh, 1);
});

test("expired orders free refresh-ticket slots and their stale production plan is restored", () => {
  const state = factory();
  state.research.planning = 1;
  state.orders = [order()];
  const tracked = startOrderTracking(state, "order-1");
  tracked.orders[0] = { ...tracked.orders[0], remaining: 0 };
  tracked.orders.push(order("order-2"));
  tracked.orderSerial = 2;
  const next = consumeOrderRefreshTicket(tracked, () => .5);
  assert.deepEqual(next.orders.map((item) => item.id), ["order-2", "order-3"]);
  assert.equal(next.productionPlan, null);
  assert.equal(next.inventory.specials.orderRefresh, 1);
});

test("golden tickets complete the chosen order with zero materials and the full coin reward", () => {
  const state = factory();
  state.orders = [order(), order("order-2")];
  state.market.refinedPrice = 37;
  state.research.orders = 3;
  const before = structuredClone(state);
  const next = consumeGoldenOrderTicket(state, "order-2", noRandom);
  assert.deepEqual(state, before);
  assert.deepEqual(next.inventory, { ...state.inventory, specials: { ...state.inventory.specials, goldenOrder: 1 } });
  assert.equal(next.coins, state.coins + orderCoinReward(state, state.orders[1]));
  assert.deepEqual(next.orders, [state.orders[0]]);
  assert.equal(next.orderElapsed, state.orderElapsed);
  assert.equal(consumeGoldenOrderTicket(next, "order-2", noRandom), next);
});

test("golden delivery keeps stocked resources and gives the same special-order rewards as normal delivery", () => {
  const state = factory();
  state.orders = [order("special", "special")];
  state.inventory.refined = 12;
  state.inventory.screws = 25;
  state.inventory.raw = 200;
  const normal = submitOrder(state, "special", () => .8);
  const golden = consumeGoldenOrderTicket(state, "special", () => .8);
  assert.equal(golden.coins, normal.coins);
  assert.equal(golden.coins, state.coins + orderCoinReward(state, state.orders[0]));
  assert.equal(golden.inventory.refined, 12);
  assert.equal(golden.inventory.screws, 25);
  assert.equal(golden.inventory.raw, 200);
  assert.equal(normal.inventory.refined, 7);
  assert.equal(normal.inventory.screws, 15);
  assert.equal(normal.inventory.specials.goldenOrder, 2);
  assert.equal(golden.inventory.specials.goldenOrder, 1);
  assert.equal(golden.inventory.specials.orderRefresh, 3);
  assert.equal(normal.inventory.specials.orderRefresh, 3);
  assert.equal(consumeGoldenOrderTicket(golden, "special", noRandom), golden);
});

test("a golden ticket earned on its own delivery is preserved without allowing a second payout", () => {
  const state = factory();
  state.inventory.specials.goldenOrder = 1;
  state.orders = [order("special", "special")];
  const next = consumeGoldenOrderTicket(state, "special", () => .98);
  assert.equal(next.inventory.specials.goldenOrder, 1);
  assert.equal(next.orders.length, 0);
  assert.equal(consumeGoldenOrderTicket(next, "special", noRandom), next);
});

test("invalid golden deliveries and expired ordinary orders neither spend tickets nor pay rewards", () => {
  for (const count of [0, -1, .5, undefined, null, NaN, Infinity, "1"]) {
    const state = factory();
    state.orders = [order("special", "special")];
    state.inventory.specials.goldenOrder = count;
    assert.equal(consumeGoldenOrderTicket(state, "special", noRandom), state, `invalid golden stock: ${count}`);
  }
  const state = factory();
  state.orders = [order("expired", "special")];
  state.orders[0].remaining = 0;
  state.inventory.refined = 100;
  state.inventory.screws = 100;
  assert.equal(consumeGoldenOrderTicket(state, "missing", noRandom), state);
  assert.equal(consumeGoldenOrderTicket(state, "expired", noRandom), state);
  assert.equal(submitOrder(state, "expired", noRandom), state);
  state.orders[0].remaining = -1;
  assert.equal(consumeGoldenOrderTicket(state, "expired", noRandom), state);
});

test("ordinary delivery still requires materials even when a golden ticket is available", () => {
  const state = factory();
  state.orders = [order("special", "special")];
  assert.equal(submitOrder(state, "special", noRandom), state);
  state.inventory.refined = 5;
  assert.equal(submitOrder(state, "special", noRandom), state);
  state.inventory.screws = 10;
  const next = submitOrder(state, "special", () => 0);
  assert.equal(next.inventory.refined, 0);
  assert.equal(next.inventory.screws, 0);
  assert.equal(next.inventory.specials.goldenOrder, 2);
});

test("special reward probability boundaries give each common item 25%, refresh tickets 23%, and golden tickets 2%", () => {
  for (const [roll, expected] of [
    [0, "canOpener"], [.249999, "canOpener"], [.25, "smartLeader"], [.499999, "smartLeader"],
    [.5, "holyLight"], [.749999, "holyLight"], [.75, "orderRefresh"], [.979999, "orderRefresh"],
    [.98, "goldenOrder"], [.999999, "goldenOrder"], [1, "goldenOrder"],
  ]) {
    const state = createInitialState(0, 0);
    state.orders = [order("special", "special")];
    state.inventory.refined = 5;
    state.inventory.screws = 10;
    const next = submitOrder(state, "special", () => roll);
    assert.equal(next.inventory.specials[expected], 1, `roll ${roll}`);
    assert.equal(Object.values(next.inventory.specials).reduce((sum, count) => sum + count, 0), 1);
  }
});

test("golden completion restores production plans after current batches finish", () => {
  const state = factory();
  state.research.planning = 1;
  state.inventory.raw = 10000;
  state.inventory.rough = 50;
  const worker = state.workers[0];
  state.workers = [
    { ...worker, id: "process-worker", zoneId: "process", status: "idle" },
    { ...worker, id: "synthesis-worker", zoneId: "synthesis", status: "idle" },
  ];
  state.orders = [order()];
  const tracked = stepGame(startOrderTracking(state, "order-1"), 1, () => 1);
  assert.equal(tracked.processPlots.process.recipe, "refined");
  assert.equal(tracked.synthesisPlots.synthesis.recipe, "screws");
  assert.equal(tracked.processPlots.process.batch.active, true);
  assert.equal(tracked.synthesisPlots.synthesis.batch.active, true);
  const original = structuredClone(tracked);
  let next = consumeGoldenOrderTicket(tracked, "order-1", noRandom);
  assert.deepEqual(tracked, original);
  assert.equal(next.productionPlan.phase, "restoring");
  assert.deepEqual(next.processPlots.process.batch, tracked.processPlots.process.batch);
  assert.deepEqual(next.synthesisPlots.synthesis.batch, tracked.synthesisPlots.synthesis.batch);
  assert.deepEqual(next.inventory, { ...tracked.inventory, specials: { ...tracked.inventory.specials, goldenOrder: 1 } });
  for (let elapsed = 0; elapsed < 100 && next.productionPlan; elapsed += 1) next = stepGame(next, 1, () => 1);
  assert.equal(next.productionPlan, null);
  assert.equal(next.processPlots.process.recipe, "rough");
  assert.equal(next.synthesisPlots.synthesis.recipe, "cans");
});

test("golden completion of another order leaves an existing production plan attached", () => {
  const state = factory();
  state.research.planning = 1;
  state.orders = [order(), order("order-2")];
  const tracked = startOrderTracking(state, "order-1");
  const next = consumeGoldenOrderTicket(tracked, "order-2", noRandom);
  assert.equal(next.productionPlan, tracked.productionPlan);
  assert.equal(next.productionPlan.orderId, "order-1");
});

test("older version-10 saves fill missing tickets with zero and existing ticket counts round-trip", () => {
  const state = createInitialState(0, 0);
  state.inventory.specials.canOpener = 3;
  delete state.inventory.specials.orderRefresh;
  delete state.inventory.specials.goldenOrder;
  const loaded = parseSavedState(JSON.stringify(state));
  assert.ok(loaded);
  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.inventory.specials, { canOpener: 3, smartLeader: 0, holyLight: 0, orderRefresh: 0, goldenOrder: 0 });
  const withTickets = factory();
  assert.deepEqual(parseSavedState(JSON.stringify(withTickets)).inventory.specials, withTickets.inventory.specials);
});

test("save loading rejects malformed ticket counts that could bypass inventory checks", () => {
  for (const id of ["orderRefresh", "goldenOrder"]) for (const count of [-1, .5, "2", null, true, {}, [], Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    const state = factory();
    state.inventory.specials[id] = count;
    assert.equal(parseSavedState(JSON.stringify(state)), null, `${id}=${JSON.stringify(count)}`);
  }
  for (const container of [null, "tickets", [], 3]) {
    const state = factory();
    state.inventory.specials = container;
    assert.equal(parseSavedState(JSON.stringify(state)), null);
  }
});
