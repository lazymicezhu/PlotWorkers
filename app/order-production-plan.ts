import type { GameState, RecipeId, SynthesisRecipeId, ZoneId } from "./game-engine.ts";

export type ProductionPlan = {
  orderId: string;
  phase: "tracking" | "restoring";
  /** Original recipes, kept until restoration has finished for each plot. */
  process: Record<ZoneId, RecipeId>;
  synthesis: Record<ZoneId, SynthesisRecipeId>;
  pausedPlotIds: ZoneId[];
};

export type SynthesisRecipeCatalog = Record<SynthesisRecipeId, {
  output: number;
  inputs: Partial<Record<RecipeId | "screws", number>>;
}>;

type Product = RecipeId | SynthesisRecipeId;
type Stock = Record<Product, number>;

export type OrderProductionStatus = {
  phase: "idle" | "tracking" | "ready" | "restoring" | "blocked";
  label: string;
  detail: string;
};

function clonePlan(plan: ProductionPlan): ProductionPlan {
  return { ...plan, process: { ...plan.process }, synthesis: { ...plan.synthesis }, pausedPlotIds: [...plan.pausedPlotIds] };
}

function cloneProductionState(state: GameState): GameState {
  return {
    ...state,
    inventory: { ...state.inventory },
    processPlots: Object.fromEntries(Object.entries(state.processPlots).map(([id, plot]) => [id, { ...plot, batch: { ...plot.batch } }])),
    synthesisPlots: Object.fromEntries(Object.entries(state.synthesisPlots).map(([id, plot]) => [id, { ...plot, batch: { ...plot.batch, reserved: { ...plot.batch.reserved } } }])),
    productionPlan: state.productionPlan ? clonePlan(state.productionPlan) : null,
  };
}

function hasStaff(state: GameState, id: string) {
  return state.workers.some((worker) => worker.zoneId === id && worker.mood > 0 && worker.status !== "dragging" && worker.status !== "slacking");
}

/** Enough food for about one ordinary recovery cycle per worker, with a 20-can minimum. */
export function productionPlanCanReserve(state: GameState) {
  return Math.max(20, Math.ceil(state.workers.filter((worker) => worker.role !== "foreman").length * .5));
}

function restorePlot(state: GameState, id: string, force: boolean): boolean {
  const plan = state.productionPlan;
  if (!plan) return true;
  const processRecipe = plan.process[id];
  const synthesisRecipe = plan.synthesis[id];
  const process = state.processPlots[id];
  const synthesis = state.synthesisPlots[id];
  if (processRecipe && process) {
    if (process.batch.active && !force) return false;
    if (process.batch.active) state.inventory.raw += process.batch.reservedRaw;
    process.batch = { active: false, progress: 0, reservedRaw: 0 };
    if (process.recipe !== processRecipe) { process.recipe = processRecipe; process.produced = 0; }
  }
  if (synthesisRecipe && synthesis) {
    if (synthesis.batch.active && !force) return false;
    if (synthesis.batch.active) for (const [kind, amount] of Object.entries(synthesis.batch.reserved)) {
      state.inventory[kind as RecipeId | "screws"] += amount ?? 0;
    }
    synthesis.batch = { active: false, progress: 0, reserved: {} };
    if (synthesis.recipe !== synthesisRecipe) { synthesis.recipe = synthesisRecipe; synthesis.produced = 0; }
  }
  delete plan.process[id];
  delete plan.synthesis[id];
  plan.pausedPlotIds = plan.pausedPlotIds.filter((plotId) => plotId !== id);
  return true;
}

function finishRestoring(state: GameState) {
  const plan = state.productionPlan;
  if (!plan) return;
  for (const id of [...Object.keys(plan.process), ...Object.keys(plan.synthesis)]) {
    const plot = state.plots.find((item) => item.id === id);
    // A stopped or unattended batch cannot finish: return its inputs instead.
    restorePlot(state, id, !plot || plot.enabled === false || !hasStaff(state, id));
  }
  if (!Object.keys(plan.process).length && !Object.keys(plan.synthesis).length) state.productionPlan = null;
}

export function startOrderTracking(state: GameState, orderId: string, recipes: SynthesisRecipeCatalog): GameState {
  if ((state.research.planning ?? 0) < 1 || state.productionPlan || !state.orders.some((order) => order.id === orderId && order.remaining > 0)) return state;
  const next = cloneProductionState(state);
  const process: ProductionPlan["process"] = {};
  const synthesis: ProductionPlan["synthesis"] = {};
  for (const plot of next.plots) {
    if (plot.enabled === false) continue;
    if (plot.type === "process" && next.processPlots[plot.id]) process[plot.id] = next.processPlots[plot.id].recipe;
    if (plot.type === "synthesis" && next.synthesisPlots[plot.id]) synthesis[plot.id] = next.synthesisPlots[plot.id].recipe;
  }
  if (!Object.keys(process).length && !Object.keys(synthesis).length) return state;
  next.productionPlan = { orderId, phase: "tracking", process, synthesis, pausedPlotIds: [] };
  refreshProductionPlan(next, recipes);
  return next;
}

export function cancelProductionPlan(state: GameState): GameState {
  if (!state.productionPlan) return state;
  const next = cloneProductionState(state);
  next.productionPlan!.phase = "restoring";
  finishRestoring(next);
  return next;
}

export const cancelOrderTracking = cancelProductionPlan;

/** Manual recipe choices relinquish ownership without restoring over the player's choice. */
export function releasePlannedPlot(state: GameState, plotId: string): GameState {
  const plan = state.productionPlan;
  if (!plan || (!(plotId in plan.process) && !(plotId in plan.synthesis))) return state;
  const nextPlan = clonePlan(plan);
  delete nextPlan.process[plotId];
  delete nextPlan.synthesis[plotId];
  nextPlan.pausedPlotIds = nextPlan.pausedPlotIds.filter((id) => id !== plotId);
  return {
    ...state,
    productionPlan: Object.keys(nextPlan.process).length || Object.keys(nextPlan.synthesis).length ? nextPlan : null,
  };
}

export function isPlannedPlotPaused(state: GameState, plotId: string): boolean {
  return state.productionPlan?.pausedPlotIds.includes(plotId) ?? false;
}

function projectedInventory(state: GameState, recipes: SynthesisRecipeCatalog): Stock {
  const stock: Stock = {
    rough: state.inventory.rough, refined: state.inventory.refined,
    cans: state.inventory.cans, screws: state.inventory.screws, rebar: state.inventory.rebar,
  };
  const enabled = new Set(state.plots.filter((plot) => plot.enabled !== false).map((plot) => plot.id));
  for (const [id, plot] of Object.entries(state.processPlots)) if (enabled.has(id) && plot.batch.active) stock[plot.recipe] += 1;
  for (const [id, plot] of Object.entries(state.synthesisPlots)) if (enabled.has(id) && plot.batch.active) stock[plot.recipe] += recipes[plot.recipe].output;
  return stock;
}

/**
 * Recompute at a batch boundary. The caller owns a mutable simulation copy.
 * In-flight output counts once; its inputs have already left inventory. Idle
 * assignments are also budgeted once across plots, so surplus plots stay idle.
 */
export function refreshProductionPlan(state: GameState, recipes: SynthesisRecipeCatalog): void {
  const plan = state.productionPlan;
  if (!plan) return;
  const order = state.orders.find((item) => item.id === plan.orderId && item.remaining > 0);
  if (plan.phase === "restoring" || !order || (state.research.planning ?? 0) < 1) {
    plan.phase = "restoring";
    finishRestoring(state);
    return;
  }

  // Disabling or recycling a plot must not leave a stale snapshot in a save.
  for (const id of [...Object.keys(plan.process), ...Object.keys(plan.synthesis)]) {
    const plot = state.plots.find((item) => item.id === id);
    if (!plot || plot.enabled === false || (id in plan.process && !state.processPlots[id]) || (id in plan.synthesis && !state.synthesisPlots[id])) restorePlot(state, id, true);
  }
  if (!Object.keys(plan.process).length && !Object.keys(plan.synthesis).length) { state.productionPlan = null; return; }

  const staffedPlots = new Set(state.workers
    .filter((worker) => worker.zoneId && worker.mood > 0 && worker.status !== "dragging" && worker.status !== "slacking")
    .map((worker) => worker.zoneId));
  const stock = projectedInventory(state, recipes);
  const targets: Stock = { rough: 0, refined: 0, screws: 0, rebar: 0, cans: productionPlanCanReserve(state) };
  targets[order.processed.kind] += order.processed.amount;
  targets[order.synthesized.kind] += order.synthesized.amount;
  const batches: Record<SynthesisRecipeId, number> = { cans: 0, screws: 0, rebar: 0 };
  // Reverse dependency order ensures screws for rebar and materials for cans
  // are included before choosing the next processing recipe.
  for (const kind of ["rebar", "screws", "cans"] as const) {
    const recipe = recipes[kind];
    batches[kind] = Math.max(0, Math.ceil((targets[kind] - stock[kind]) / recipe.output));
    for (const [input, amount] of Object.entries(recipe.inputs)) targets[input as RecipeId | "screws"] += (amount ?? 0) * batches[kind];
  }

  const deficits = { rough: Math.max(0, targets.rough - stock.rough), refined: Math.max(0, targets.refined - stock.refined) };
  const assignedStock = { ...stock };
  const paused = new Set<string>();
  for (const id of Object.keys(plan.process)) {
    const plot = state.processPlots[id];
    if (plot.batch.active) continue;
    if (!staffedPlots.has(id)) { paused.add(id); continue; }
    const needed = (["rough", "refined"] as const).filter((kind) => deficits[kind] > 0);
    if (!needed.length) { paused.add(id); continue; }
    // Fill the small food prerequisites first, then balance remaining deficits.
    const foodInput = batches.cans > 0 ? needed.find((kind) => assignedStock[kind] < (recipes.cans.inputs[kind] ?? 0)) : undefined;
    const kind = foodInput ?? needed.sort((a, b) => deficits[b] / Math.max(1, targets[b]) - deficits[a] / Math.max(1, targets[a]))[0];
    if (plot.recipe !== kind) { plot.recipe = kind; plot.produced = 0; }
    deficits[kind] = Math.max(0, deficits[kind] - 1);
    assignedStock[kind] += 1;
  }

  const available = { rough: state.inventory.rough, refined: state.inventory.refined, screws: state.inventory.screws };
  const reservedForDelivery = { rough: 0, refined: 0, screws: 0 };
  reservedForDelivery[order.processed.kind] = order.processed.amount;
  if (order.synthesized.kind === "screws") reservedForDelivery.screws = order.synthesized.amount;
  for (const id of Object.keys(plan.synthesis)) {
    const plot = state.synthesisPlots[id];
    if (plot.batch.active) continue;
    if (!staffedPlots.has(id)) { paused.add(id); continue; }
    const kind = (["cans", "screws", "rebar"] as const).find((candidate) => batches[candidate] > 0);
    if (!kind) { paused.add(id); continue; }
    if (plot.recipe !== kind) { plot.recipe = kind; plot.produced = 0; }
    batches[kind] -= 1;
    const inputs = Object.entries(recipes[kind].inputs) as [RecipeId | "screws", number][];
    // Food at zero stock takes precedence over delivery; otherwise the goods
    // already set aside for the order remain available for manual submission.
    const emergencyFood = kind === "cans" && state.inventory.cans <= 0;
    const canStart = inputs.every(([input, amount]) => available[input] >= amount + (emergencyFood ? 0 : reservedForDelivery[input]));
    if (!canStart) { paused.add(id); continue; }
    for (const [input, amount] of inputs) available[input] -= amount;
  }
  plan.pausedPlotIds = [...paused];
}

export function getOrderProductionStatus(state: GameState): OrderProductionStatus {
  const plan = state.productionPlan;
  if (!plan) return { phase: "idle", label: "未追踪", detail: "追踪一张订单，按库存缺口临时安排现有地块。" };
  if (plan.phase === "restoring") return { phase: "restoring", label: "正在恢复", detail: "当前批次完成后恢复原配方；无人或停用地块会退还批次材料。" };
  const order = state.orders.find((item) => item.id === plan.orderId && item.remaining > 0);
  if (!order) return { phase: "restoring", label: "正在恢复", detail: "订单已结束，地块正在恢复原配方。" };
  if (state.inventory[order.processed.kind] >= order.processed.amount && state.inventory[order.synthesized.kind] >= order.synthesized.amount) {
    return { phase: "ready", label: "可以交付", detail: "订单物品已备齐，已停止追加订单批次；交付后恢复原配方。" };
  }
  const processIds = Object.keys(plan.process);
  const synthesisIds = Object.keys(plan.synthesis);
  const lacksProcessed = state.inventory[order.processed.kind] < order.processed.amount;
  const lacksSynthesized = state.inventory[order.synthesized.kind] < order.synthesized.amount;
  if ((lacksProcessed && !processIds.some((id) => hasStaff(state, id))) || (lacksSynthesized && !synthesisIds.some((id) => hasStaff(state, id)))) {
    return { phase: "blocked", label: "等待人手", detail: "需要的加工或合成地块暂无可工作的工人，请安排人手或检查地块托管。" };
  }
  const ids = [...processIds, ...synthesisIds];
  const active = ids.some((id) => state.processPlots[id]?.batch.active || state.synthesisPlots[id]?.batch.active);
  if (!active && ids.length && ids.every((id) => plan.pausedPlotIds.includes(id) || !hasStaff(state, id) || state.workers.some((worker) => worker.zoneId === id && worker.status === "waiting"))) {
    return { phase: "blocked", label: "等待材料", detail: "产线正在等待原料或上游材料，请检查采集、库存和手动退出托管的地块。" };
  }
  return { phase: "tracking", label: "正在生产", detail: `托管 ${processIds.length} 个加工区、${synthesisIds.length} 个合成区；先补齐上游材料，并保留罐头补给。` };
}
