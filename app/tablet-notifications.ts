import type { GameState, OrderState, SpecialItemId } from "./game-engine.ts";

export type TabletNotificationPage = "orders" | "inventory";

export type TabletNotificationSnapshot = {
  orderIds: readonly string[];
  readySeenIds: readonly string[];
  specials: Readonly<Record<SpecialItemId, number>>;
};

const specialItemIds: readonly SpecialItemId[] = ["canOpener", "smartLeader", "holyLight"];

function isOrderReady(game: GameState, order: OrderState) {
  return game.inventory[order.processed.kind] >= order.processed.amount
    && game.inventory[order.synthesized.kind] >= order.synthesized.amount;
}

/** Establish a quiet baseline when loading a game, importing a save, or starting over. */
export function snapshotTabletNotifications(game: GameState): TabletNotificationSnapshot {
  return {
    orderIds: game.orders.map((order) => order.id),
    readySeenIds: game.orders.filter((order) => isOrderReady(game, order)).map((order) => order.id),
    specials: { ...game.inventory.specials },
  };
}

/** Notice meaningful events without treating each simulation tick as an update. */
export function reconcileTabletNotifications(
  previous: TabletNotificationSnapshot,
  game: GameState,
): { snapshot: TabletNotificationSnapshot; pages: TabletNotificationPage[] } {
  const orderIds = new Set(previous.orderIds);
  const activeOrderIds = new Set(game.orders.map((order) => order.id));
  // Order IDs are never reused within a world; retired orders need no history.
  const readySeenIds = new Set(previous.readySeenIds.filter((id) => activeOrderIds.has(id)));
  let ordersChanged = false;

  for (const order of game.orders) {
    if (!orderIds.has(order.id)) ordersChanged = true;
    if (isOrderReady(game, order) && !readySeenIds.has(order.id)) {
      ordersChanged = true;
      // Keep the first ready event even if inventory later falls below its requirements.
      readySeenIds.add(order.id);
    }
  }

  const pages: TabletNotificationPage[] = [];
  if (ordersChanged) pages.push("orders");
  if (specialItemIds.some((id) => game.inventory.specials[id] > previous.specials[id])) {
    pages.push("inventory");
  }

  return {
    snapshot: {
      orderIds: [...activeOrderIds],
      readySeenIds: [...readySeenIds],
      specials: { ...game.inventory.specials },
    },
    pages,
  };
}
