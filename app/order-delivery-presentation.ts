/** A UI-only gate: a successful trade cannot run again while its paper is leaving. */
export function createOrderDeliveryGate() {
  const claimed = new Set<string>();
  return {
    attempt(id: string, prepare: () => void, commit: () => boolean): "success" | "failed" | "duplicate" {
      if (claimed.has(id)) return "duplicate";
      claimed.add(id);
      try {
        // Retain the card before a synchronous parent update removes the real order.
        prepare();
        if (commit()) return "success";
        claimed.delete(id);
        return "failed";
      } catch (error) {
        claimed.delete(id);
        throw error;
      }
    },
  };
}

export type RetainedOrder<T> = { value: T; before: string[]; after: string[] };

/** Preserve leaving cards among surviving neighbors; new orders stay behind them. */
export function mergeRetainedOrders<T extends { id: string }>(live: T[], retained: RetainedOrder<T>[]): T[] {
  const retainedIds = new Set(retained.map(({ value }) => value.id));
  const cards = live.filter(({ id }) => !retainedIds.has(id));
  for (const { value, before, after } of retained) {
    const next = cards.findIndex(({ id }) => after.includes(id));
    if (next >= 0) cards.splice(next, 0, value);
    else {
      let previous = -1;
      for (let index = 0; index < cards.length; index++) {
        if (before.includes(cards[index].id)) previous = index;
      }
      cards.splice(previous + 1, 0, value);
    }
  }
  return cards;
}
