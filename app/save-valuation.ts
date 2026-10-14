import { RECIPES, RESEARCH, SCHEDULER_EFFICIENCY_MAX, SCHEDULER_EFFICIENCY_STEP, SYNTHESIS_SELL_PRICES, schedulerBotPrice, workerPurchasePrice } from "./game-engine.ts";
import type { GameState, ResearchId } from "./game-engine.ts";

export type SaveValuationItem = {
  id: "coins" | "inventory" | "workers" | "plots" | "robots" | "upgrades" | "schedulerTime";
  label: string;
  value: number;
};

export type SaveValuation = {
  version: 2;
  total: number;
  items: SaveValuationItem[];
  note: string;
};

// Change the valuation version when changing these rules. Market fluctuations do
// not affect the value of unsold stock, and work in progress retains input value.
export const SAVE_VALUATION_PRICES = {
  raw: RECIPES.rough.basePrice / RECIPES.rough.raw,
  cans: 2,
  rough: RECIPES.rough.basePrice,
  refined: RECIPES.refined.basePrice,
  ...SYNTHESIS_SELL_PRICES,
} as const;

const nonnegative = (value: number) => value > 0 ? Math.min(Number.MAX_SAFE_INTEGER, value) : 0;

/** Value currently owned assets, without counting future production or rewards. */
export function saveValuation(state: GameState): SaveValuation {
  const stock = {
    raw: nonnegative(state.inventory.raw),
    cans: nonnegative(state.inventory.cans),
    rough: nonnegative(state.inventory.rough),
    refined: nonnegative(state.inventory.refined),
    screws: nonnegative(state.inventory.screws),
    rebar: nonnegative(state.inventory.rebar),
  };
  for (const plot of state.plots) {
    if (plot.type === "process") {
      stock.raw += nonnegative(state.processPlots[plot.id]?.batch.reservedRaw ?? 0);
    } else if (plot.type === "synthesis") {
      const reserved = state.synthesisPlots[plot.id]?.batch.reserved;
      for (const kind of ["rough", "refined", "screws"] as const) {
        stock[kind] += nonnegative(reserved?.[kind] ?? 0);
      }
    }
  }
  const inventory = (Object.keys(stock) as (keyof typeof stock)[])
    .reduce((sum, kind) => sum + stock[kind] * SAVE_VALUATION_PRICES[kind], 0);
  const workers = state.workers.reduce((sum, _worker, index) => sum + workerPurchasePrice(index), 0);
  const plots = state.plots.reduce((sum, plot) => sum + nonnegative(plot.purchasePrice), 0);
  const robots = state.schedulerRobots.reduce((sum, robot, index) => {
    // The initially granted robot has the same base value as the first purchase.
    const base = schedulerBotPrice({ ...state, schedulerBots: Math.max(1, index) });
    // Replacement cost uses today's upgrade step, including legacy odd percentages.
    const efficiencyPoints = Math.round(Math.min(nonnegative(robot.efficiency - 1), SCHEDULER_EFFICIENCY_MAX - 1) * 100);
    const efficiencyLevels = Math.ceil(efficiencyPoints / Math.round(SCHEDULER_EFFICIENCY_STEP * 100));
    const intervalLevels = Math.min(29, Math.round(nonnegative(3 - robot.intervalSeconds) * 10));
    return sum + base + (efficiencyLevels + intervalLevels) * 100;
  }, 0);
  const research = (Object.keys(RESEARCH) as ResearchId[]).reduce((sum, id) =>
    sum + RESEARCH[id].costs.slice(0, Math.max(0, Math.floor(state.research[id])))
      .reduce((subtotal, cost) => subtotal + cost, 0), 0);
  const upgrades = research + (state.autoCanSupply ? 5000 : 0) + (state.autoSchedulerSupply ? 5000 : 0);
  const exactItems: SaveValuationItem[] = [
    { id: "coins", label: "持有金币", value: nonnegative(state.coins) },
    { id: "inventory", label: "库存与在制材料", value: inventory },
    { id: "workers", label: "人物", value: workers },
    { id: "plots", label: "地块", value: plots },
    { id: "robots", label: "机器人及升级", value: robots },
    { id: "upgrades", label: "永久研究与自动补给", value: upgrades },
    { id: "schedulerTime", label: "剩余调度时间", value: nonnegative(state.schedulerSeconds) * 100 / 60 },
  ];
  // Imported saves are validated separately. This also keeps the reusable value
  // calculator finite and its integer result safe for extreme external inputs.
  let remainingCapacity = Number.MAX_SAFE_INTEGER;
  for (const item of exactItems) {
    item.value = Math.min(nonnegative(item.value), remainingCapacity);
    remainingCapacity -= item.value;
  }
  const total = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(exactItems.reduce((sum, item) => sum + item.value, 0)));
  const items = exactItems.map((item) => ({ ...item, value: Math.floor(item.value) }));
  // Keep precision until the final sum, then distribute fractional coins by
  // largest remainder so the displayed integer rows always add up to the total.
  const remainderOrder = exactItems.map((item, index) => ({ index, fraction: item.value - items[index].value }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const remainingCoins = total - items.reduce((sum, item) => sum + item.value, 0);
  for (let index = 0; index < remainingCoins; index += 1) items[remainderOrder[index].index].value += 1;

  return {
    version: 2,
    total,
    items,
    note: "库存按固定基准价估算，包含生产中已预扣的材料；特殊物品暂未折价。",
  };
}
