import { RESEARCH, SPECIAL_ITEM_IDS, SPECIAL_ITEM_NAMES } from "./game-engine.ts";
import type { GameState, ResearchId, SpecialItemId } from "./game-engine.ts";
import { cancelProductionPlan } from "./order-production-plan.ts";

export const DEBUG_MATERIAL_IDS = ["raw", "cans", "rough", "refined", "screws", "rebar"] as const;
type DebugMaterialId = typeof DEBUG_MATERIAL_IDS[number];
export const DEBUG_MATERIAL_NAMES: Record<DebugMaterialId, string> = {
  raw: "原料", cans: "罐头", rough: "粗加工", refined: "精加工", screws: "螺丝", rebar: "钢筋",
};
export type DebugResourceId = "coins" | DebugMaterialId | SpecialItemId;
export type DebugAction =
  | { type: "add-resource"; resource: DebugResourceId; amount: number }
  | { type: "reset-research" }
  | { type: "max-research" };

function checkedTotal(current: number, amount: number, name: string): number {
  if (!Number.isFinite(current) || current < 0 || current > Number.MAX_SAFE_INTEGER
    || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER - current) {
    throw new Error(`${name}数量超出可用范围，请减少增加数量。`);
  }
  return current + amount;
}

function resetResearch(state: GameState): GameState {
  // Resetting the planning unlock must not leave an unrestorable plan in saves.
  // Check refunds first so an overflow never partially changes the game state.
  const stock = { ...state.inventory };
  if (state.productionPlan) {
    for (const id of Object.keys(state.productionPlan.process)) {
      const batch = state.processPlots[id]?.batch;
      if (batch?.active) stock.raw = checkedTotal(stock.raw, batch.reservedRaw, DEBUG_MATERIAL_NAMES.raw);
    }
    for (const id of Object.keys(state.productionPlan.synthesis)) {
      const batch = state.synthesisPlots[id]?.batch;
      if (batch?.active) for (const kind of ["rough", "refined", "screws"] as const) {
        stock[kind] = checkedTotal(stock[kind], batch.reserved[kind] ?? 0, DEBUG_MATERIAL_NAMES[kind]);
      }
    }
  }
  const next = cancelProductionPlan(state, true);
  return {
    ...next,
    research: Object.fromEntries(Object.keys(RESEARCH).map((id) => [id, id === "fishing" && state.plots.some((plot) => plot.type === "fishing") ? 1 : 0])) as GameState["research"],
    researchInvestment: 0,
    orderRefreshCooldown: 0,
  };
}

/** Debug actions change only their requested values and never mutate the input. */
export function applyDebugAction(state: GameState, action: DebugAction): GameState {
  if (!action || typeof action !== "object") throw new Error("请选择有效的调试操作。");
  if (action.type === "reset-research") return resetResearch(state);
  if (action.type === "max-research") {
    const ids = Object.keys(RESEARCH) as ResearchId[];
    const additionalInvestment = ids.reduce((total, id) => total
      + RESEARCH[id].costs.slice(state.research[id]).reduce<number>((sum, cost) => sum + cost, 0), 0);
    return {
      ...state,
      research: Object.fromEntries(ids.map((id) => [id, RESEARCH[id].costs.length])) as GameState["research"],
      // Keep historical purchase prices; value only newly granted levels at current prices.
      researchInvestment: checkedTotal(state.researchInvestment, additionalInvestment, "研究投入"),
    };
  }
  if (action.type !== "add-resource") throw new Error("请选择有效的调试操作。");
  const { resource, amount } = action;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("增加数量必须是大于 0 的安全整数。");
  if (resource === "coins") return { ...state, coins: checkedTotal(state.coins, amount, "金币") };
  if ((DEBUG_MATERIAL_IDS as readonly string[]).includes(resource)) {
    const material = resource as DebugMaterialId;
    return { ...state, inventory: { ...state.inventory, [material]: checkedTotal(state.inventory[material], amount, DEBUG_MATERIAL_NAMES[material]) } };
  }
  if ((SPECIAL_ITEM_IDS as readonly string[]).includes(resource)) {
    const special = resource as SpecialItemId;
    const current = state.inventory.specials[special];
    if (!Number.isSafeInteger(current)) throw new Error("道具数量无效，请先恢复有效存档。");
    return { ...state, inventory: { ...state.inventory, specials: {
      ...state.inventory.specials, [special]: checkedTotal(current, amount, SPECIAL_ITEM_NAMES[special]),
    } } };
  }
  throw new Error("请选择有效的金币、物资或道具。");
}
