import type { ResourceKind } from "./resource-activity.ts";

export type ZoneType = "gather" | "process" | "synthesis" | "living";
export type ZoneId = string;
export type Personality = "leader" | "slowBurn" | "lazy";
export type RecipeId = "rough" | "refined";
export type SynthesisRecipeId = "cans" | "screws" | "rebar";
export type SpecialItemId = "canOpener" | "smartLeader" | "holyLight";
export type ResearchId = "synthesis" | "orders";
export type WorkerStatus =
  | "idle"
  | "gathering"
  | "processing"
  | "synthesizing"
  | "waiting"
  | "slacking"
  | "exhausted"
  | "resting"
  | "ready"
  | "dragging";

export type WorkerState = {
  id: string;
  name: string;
  role?: "foreman";
  mood: number;
  stamina: number;
  efficiency: number;
  spirit: number;
  personality: Personality;
  zoneId: ZoneId | null;
  status: WorkerStatus;
  u: number;
  v: number;
  x: number;
  y: number;
  duration: number;
  facing: "left" | "right";
  continuousWork: number;
  lazyElapsed: number;
  lazyCheckInterval?: number;
  slowStacks: number;
  lastWorkZoneId: ZoneId | null;
};

export type PlotState = {
  id: ZoneId;
  type: ZoneType;
  name: string;
  x: number;
  y: number;
  cols: 4 | 8;
  rows: 4 | 8;
  purchasePrice: number;
  enabled?: boolean;
};

export type SchedulerRobotState = {
  efficiency: number;
  intervalSeconds: number;
  duties: { rest: boolean; work: boolean; wake: boolean };
};

export const SCHEDULER_EFFICIENCY_STEP = .02;
export const SCHEDULER_EFFICIENCY_MAX = 1.5;

export type SchedulerDuty = keyof SchedulerRobotState["duties"];

export type ProcessPlotState = {
  recipe: RecipeId;
  produced: number;
  batch: { active: boolean; progress: number; reservedRaw: number };
};

export type SynthesisPlotState = {
  recipe: SynthesisRecipeId;
  produced: number;
  batch: { active: boolean; progress: number; reserved: Partial<Record<"rough" | "refined" | "screws", number>> };
};

export type OrderState = {
  id: string;
  remaining: number;
  processed: { kind: RecipeId; amount: number };
  synthesized: { kind: "screws" | "rebar"; amount: number };
  reward: "coins" | "special";
};
export type HolyLightEffect = {
  id: string;
  x: number;
  y: number;
  remaining: number;
};

export type TimedEffectsState = {
  canOpener: number;
  smartLeader: number;
  holyLight: HolyLightEffect[];
};

export type GameState = {
  version: 9;
  rebirthCount: 0 | 1;
  coins: number;
  inventory: {
    raw: number;
    cans: number;
    rough: number;
    refined: number;
    screws: number;
    rebar: number;
    specials: Record<SpecialItemId, number>;
  };
  plots: PlotState[];
  workers: WorkerState[];
  processPlots: Record<ZoneId, ProcessPlotState>;
  synthesisPlots: Record<ZoneId, SynthesisPlotState>;
  market: { roughPrice: number; refinedPrice: number; elapsed: number };
  schedulerSeconds: number;
  schedulerBots: number;
  schedulerRobots: SchedulerRobotState[];
  canOpenerSeconds: number;
  canOpenerCooldown: number;
  autoCanSupply: boolean;
  autoSchedulerSupply: boolean;
  schedulerServiceUnlocked: boolean;
  orders: OrderState[];
  orderElapsed: number;
  orderSerial: number;
  research: Record<ResearchId, number>;
  effects: TimedEffectsState;
  plotPurchases: Record<ZoneType, number>;
};

export const INITIAL_PLOTS: PlotState[] = [
  { id: "gather", type: "gather", name: "采集区", x: 80, y: 170, cols: 8, rows: 8, purchasePrice: 1200, enabled: true },
  { id: "process", type: "process", name: "加工区", x: 1080, y: 170, cols: 8, rows: 8, purchasePrice: 1200, enabled: true },
  { id: "living", type: "living", name: "生活区", x: 790, y: 745, cols: 4, rows: 4, purchasePrice: 300, enabled: true },
];

export const RECIPES = {
  rough: { name: "粗加工", raw: 75, seconds: 10, basePrice: 10 },
  refined: { name: "精加工", raw: 200, seconds: 30, basePrice: 30 },
} as const;

export const SYNTHESIS_RECIPES = {
  cans: { name: "罐头", seconds: 60, output: 20, inputs: { rough: 1, refined: 1 } },
  screws: { name: "螺丝", seconds: 90, output: 10, inputs: { rough: 20 } },
  rebar: { name: "钢筋", seconds: 135, output: 10, inputs: { screws: 2, rough: 10, refined: 5 } },
} as const;

export const SYNTHESIS_SELL_PRICES = { screws: 30, rebar: 50 } as const;

export const SPECIAL_ITEM_NAMES: Record<SpecialItemId, string> = {
  canOpener: "罐头起子",
  smartLeader: "智械领袖",
  holyLight: "圣光洗礼",
};

export const RESEARCH = {
  synthesis: { name: "合成工程", costs: [50_000, 200_000, 800_000, 3_200_000, 12_800_000] },
  orders: { name: "订单网络", costs: [50_000, 200_000, 800_000, 3_200_000, 12_800_000] },
} as const;

export const PERSONALITY_NAMES: Record<Personality, string> = {
  leader: "领班",
  slowBurn: "慢热",
  lazy: "懒汉",
};

export const STATUS_NAMES: Record<WorkerStatus, string> = {
  idle: "待命",
  gathering: "采集中",
  processing: "加工中",
  synthesizing: "合成中",
  waiting: "等待原料",
  slacking: "摸鱼中",
  exhausted: "心情低落",
  resting: "休息中",
  ready: "精神饱满",
  dragging: "调度中",
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function staminaDrainRate(stamina: number) {
  return clamp(1 - (stamina - 5) * .1, .5, 1.4);
}

export function gatherAttributeRate(efficiency: number) {
  return clamp(1 + (efficiency - 5) * .1, .6, 1.5);
}

export function processAttributeRate(efficiency: number) {
  return 1 / clamp(1 - (efficiency - 5) * .1, .5, 1.4);
}

export function recoveryRate(spirit: number) {
  return 2 * clamp(1 + (spirit - 5) * .1, .6, 1.5);
}

export function isForeman(worker: Pick<WorkerState, "role">) {
  return worker.role === "foreman";
}

export function guardedPlotIds(workers: WorkerState[]): Set<string> {
  return new Set(workers
    .filter((worker) => isForeman(worker) && worker.zoneId && worker.status !== "dragging")
    .map((worker) => worker.zoneId!));
}

function personalityRate(worker: WorkerState, zoneLeaderCount: number) {
  if (isForeman(worker)) return 1;
  const otherLeaders = zoneLeaderCount - (worker.personality === "leader" ? 1 : 0);
  const leaderRate = 1 - (worker.personality === "leader" ? .1 : 0) + otherLeaders * .1;
  const slowBuff = worker.personality === "slowBurn" ? 1 + worker.slowStacks * .05 : 1;
  return leaderRate * slowBuff;
}

export function randomMarketPrice(base: number, random = Math.random) {
  return Math.round(base * (.8 + random() * .4));
}

export function createInitialWorker(x: number, y: number): WorkerState {
  return {
    id: "worker-1",
    name: "小人 1",
    mood: 100,
    stamina: 5,
    efficiency: 5,
    spirit: 5,
    personality: "slowBurn",
    zoneId: "living",
    status: "ready",
    u: 2,
    v: 2,
    x,
    y,
    duration: 800,
    facing: "right",
    continuousWork: 0,
    lazyElapsed: 0,
    slowStacks: 0,
    lastWorkZoneId: null,
  };
}

export function createInitialState(x: number, y: number): GameState {
  return {
    version: 9,
    rebirthCount: 0,
    coins: 100,
    inventory: { raw: 0, cans: 20, rough: 0, refined: 0, screws: 0, rebar: 0, specials: { canOpener: 0, smartLeader: 0, holyLight: 0 } },
    plots: INITIAL_PLOTS.map((plot) => ({ ...plot })),
    workers: [createInitialWorker(x, y)],
    processPlots: {
      process: { recipe: "rough", produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } },
    },
    synthesisPlots: {},
    market: { roughPrice: 10, refinedPrice: 30, elapsed: 0 },
    schedulerSeconds: 0,
    schedulerBots: 1,
    schedulerRobots: [{ efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }],
    canOpenerSeconds: 0,
    canOpenerCooldown: 0,
    autoCanSupply: false,
    autoSchedulerSupply: false,
    schedulerServiceUnlocked: false,
    orders: [],
    orderElapsed: 0,
    orderSerial: 0,
    research: { synthesis: 0, orders: 0 },
    effects: { canOpener: 0, smartLeader: 0, holyLight: [] },
    plotPurchases: { gather: 0, process: 0, synthesis: 0, living: 0 },
  };
}

export function createRandomWorker(
  index: number,
  x: number,
  y: number,
  random = Math.random,
): WorkerState {
  const personalities: Personality[] = ["leader", "slowBurn", "lazy"];
  return {
    ...createInitialWorker(x, y),
    id: `worker-${Date.now()}-${index}`,
    name: `小人 ${index}`,
    stamina: 1 + Math.floor(random() * 10),
    efficiency: 1 + Math.floor(random() * 10),
    spirit: 1 + Math.floor(random() * 10),
    personality: personalities[Math.floor(random() * personalities.length)],
  };
}

export function changeRecipe(state: GameState, plotId: ZoneId, recipe: RecipeId): GameState {
  const current = state.processPlots[plotId];
  if (!current || current.recipe === recipe) return state;
  return {
    ...state,
    inventory: {
      ...state.inventory,
      raw: state.inventory.raw + current.batch.reservedRaw,
    },
    processPlots: {
      ...state.processPlots,
      [plotId]: {
        recipe,
        produced: 0,
        batch: { active: false, progress: 0, reservedRaw: 0 },
      },
    },
  };
}

function refundSynthesisBatch(inventory: GameState["inventory"], batch: SynthesisPlotState["batch"]) {
  const next = { ...inventory };
  for (const [kind, amount] of Object.entries(batch.reserved)) {
    if (kind === "rough" || kind === "refined" || kind === "screws") next[kind] += amount ?? 0;
  }
  return next;
}

export function changeSynthesisRecipe(state: GameState, plotId: ZoneId, recipe: SynthesisRecipeId): GameState {
  const current = state.synthesisPlots[plotId];
  if (!current || current.recipe === recipe) return state;
  return {
    ...state,
    inventory: refundSynthesisBatch(state.inventory, current.batch),
    synthesisPlots: {
      ...state.synthesisPlots,
      [plotId]: { recipe, produced: 0, batch: { active: false, progress: 0, reserved: {} } },
    },
  };
}

export function togglePlotEnabled(state: GameState, plotId: ZoneId): GameState {
  if (!state.plots.some((plot) => plot.id === plotId)) return state;
  return {
    ...state,
    plots: state.plots.map((plot) => plot.id === plotId ? { ...plot, enabled: plot.enabled === false } : plot),
  };
}

export function buyCans(state: GameState, amount: number): GameState {
  const cost = amount * 2;
  if (state.coins < cost) return state;
  return {
    ...state,
    coins: state.coins - cost,
    inventory: { ...state.inventory, cans: state.inventory.cans + amount },
  };
}

export function buyAutoCanSupply(state: GameState): GameState {
  if (state.autoCanSupply || state.coins < 5000) return state;
  return { ...state, coins: state.coins - 5000, autoCanSupply: true };
}

export function buyAutoSchedulerSupply(state: GameState): GameState {
  if (state.autoSchedulerSupply || state.coins < 5000) return state;
  return { ...state, coins: state.coins - 5000, autoSchedulerSupply: true, schedulerServiceUnlocked: true };
}

export function buyWorker(
  state: GameState,
  x: number,
  y: number,
  random = Math.random,
  placement?: { zoneId: ZoneId; u: number; v: number },
): GameState {
  const cost = workerPurchasePrice(state.workers.length);
  if (state.coins < cost) return state;
  const zoneId = placement?.zoneId ?? "living";
  const livingPlot = state.plots.find((plot) => plot.id === zoneId && plot.type === "living");
  const capacity = livingPlot ? Math.floor(livingPlot.cols * livingPlot.rows / 4) : 0;
  if (!livingPlot || livingPlot.enabled === false || state.workers.filter((worker) => worker.zoneId === zoneId).length >= capacity) return state;
  const worker = {
    ...createRandomWorker(state.workers.length + 1, x, y, random),
    zoneId,
    u: placement?.u ?? 2,
    v: placement?.v ?? 2,
  };
  return {
    ...state,
    coins: state.coins - cost,
    workers: [...state.workers, worker],
  };
}

export function plotPurchasePrice(size: 4 | 8) {
  return size === 8 ? 1200 : 300;
}

const ceilToTen = (value: number) => Math.ceil(value / 10) * 10;
const roundToTen = (value: number) => Math.round(value / 10) * 10;
const ceilToHundred = (value: number) => Math.ceil(value / 100) * 100;

export function workerPurchasePrice(workerCount: number) {
  return ceilToTen(100 * 1.15 ** Math.floor(workerCount / 25));
}

export function schedulerBotPrice(state: GameState) {
  const purchased = Math.max(0, state.schedulerBots - 1);
  return ceilToHundred(1000 * (1 + .45 * purchased + .06 * purchased ** 2));
}

export function nextPlotPrice(state: GameState, type: ZoneType, size: 4 | 8) {
  const purchased = Math.max(0, state.plotPurchases[type] ?? 0);
  return roundToTen(plotPurchasePrice(size) * (1 + .18 * purchased + .012 * purchased ** 2));
}

export function buyPlot(state: GameState, plot: PlotState): GameState {
  const cost = nextPlotPrice(state, plot.type, plot.cols);
  if (state.coins < cost) return state;
  return {
    ...state,
    coins: state.coins - cost,
    plots: [...state.plots, { ...plot, purchasePrice: cost, enabled: true }],
    processPlots: plot.type === "process" ? {
      ...state.processPlots,
      [plot.id]: { recipe: "rough", produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } },
    } : state.processPlots,
    synthesisPlots: plot.type === "synthesis" ? {
      ...state.synthesisPlots,
      [plot.id]: { recipe: "cans", produced: 0, batch: { active: false, progress: 0, reserved: {} } },
    } : state.synthesisPlots,
    plotPurchases: { ...state.plotPurchases, [plot.type]: (state.plotPurchases[plot.type] ?? 0) + 1 },
  };
}

export function recyclePlot(state: GameState, plotId: string): GameState {
  const plot = state.plots.find((item) => item.id === plotId);
  if (
    !plot ||
    state.plots.filter((item) => item.type === plot.type).length <= 1 ||
    state.workers.some((worker) => worker.zoneId === plotId)
  ) return state;
  return {
    ...state,
    coins: state.coins + Math.floor(plot.purchasePrice * .7),
    inventory: plot.type === "process" ? {
      ...state.inventory,
      raw: state.inventory.raw + (state.processPlots[plotId]?.batch.reservedRaw ?? 0),
    } : plot.type === "synthesis" ? refundSynthesisBatch(state.inventory, state.synthesisPlots[plotId]?.batch ?? { active: false, progress: 0, reserved: {} }) : state.inventory,
    plots: state.plots.filter((item) => item.id !== plotId),
    processPlots: plot.type === "process"
      ? Object.fromEntries(Object.entries(state.processPlots).filter(([id]) => id !== plotId))
      : state.processPlots,
    synthesisPlots: plot.type === "synthesis"
      ? Object.fromEntries(Object.entries(state.synthesisPlots).filter(([id]) => id !== plotId))
      : state.synthesisPlots,
  };
}

export function buyScheduler(state: GameState): GameState {
  if (state.coins < 100) return state;
  return { ...state, coins: state.coins - 100, schedulerSeconds: state.schedulerSeconds + 60, schedulerServiceUnlocked: true };
}

export function buySchedulerBot(state: GameState): GameState {
  const cost = schedulerBotPrice(state);
  if (state.coins < cost) return state;
  return {
    ...state,
    coins: state.coins - cost,
    schedulerBots: state.schedulerBots + 1,
    schedulerRobots: [...state.schedulerRobots, { efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }],
  };
}

export function buyCanOpener(state: GameState): GameState {
  return state;
}

export function buyResearch(state: GameState, id: ResearchId): GameState {
  const level = state.research[id];
  const cost = RESEARCH[id].costs[level];
  if (cost === undefined || state.coins < cost) return state;
  return { ...state, coins: state.coins - cost, research: { ...state.research, [id]: level + 1 } };
}

export function useSpecialItem(state: GameState, id: Exclude<SpecialItemId, "holyLight">): GameState {
  if (state.inventory.specials[id] <= 0) return state;
  return {
    ...state,
    inventory: { ...state.inventory, specials: { ...state.inventory.specials, [id]: state.inventory.specials[id] - 1 } },
    effects: { ...state.effects, [id]: state.effects[id] + 120 },
  };
}

export function placeHolyLight(state: GameState, x: number, y: number): GameState {
  if (state.inventory.specials.holyLight <= 0) return state;
  const existingIds = new Set(state.effects.holyLight.map((light) => light.id));
  let serial = state.effects.holyLight.length + 1;
  while (existingIds.has(`holy-light-${serial}`)) serial += 1;
  return {
    ...state,
    inventory: { ...state.inventory, specials: { ...state.inventory.specials, holyLight: state.inventory.specials.holyLight - 1 } },
    effects: { ...state.effects, holyLight: [...state.effects.holyLight, { id: `holy-light-${serial}`, x, y, remaining: 60 }] },
  };
}

export function upgradeSchedulerEfficiency(state: GameState, robotIndex: number): GameState {
  const robot = state.schedulerRobots[robotIndex];
  if (state.coins < 100 || !robot || robot.efficiency >= SCHEDULER_EFFICIENCY_MAX) return state;
  return {
    ...state,
    coins: state.coins - 100,
    schedulerRobots: state.schedulerRobots.map((robot, index) => index === robotIndex
      ? { ...robot, efficiency: Math.min(SCHEDULER_EFFICIENCY_MAX, Math.round((robot.efficiency + SCHEDULER_EFFICIENCY_STEP) * 100) / 100) }
      : robot),
  };
}

export function upgradeSchedulerInterval(state: GameState, robotIndex: number): GameState {
  const robot = state.schedulerRobots[robotIndex];
  if (state.coins < 100 || !robot || robot.intervalSeconds <= .1) return state;
  return {
    ...state,
    coins: state.coins - 100,
    schedulerRobots: state.schedulerRobots.map((item, index) => index === robotIndex
      ? { ...item, intervalSeconds: Math.max(.1, Math.round((item.intervalSeconds - .1) * 10) / 10) }
      : item),
  };
}

export function toggleSchedulerDuty(state: GameState, robotIndex: number, duty: SchedulerDuty): GameState {
  if (!state.schedulerRobots[robotIndex]) return state;
  return {
    ...state,
    schedulerRobots: state.schedulerRobots.map((robot, index) => index === robotIndex
      ? { ...robot, duties: { ...robot.duties, [duty]: !robot.duties[duty] } }
      : robot),
  };
}

export function chooseAutoDispatch(
  state: GameState,
  busyWorkerIds: string[] = [],
  reservedTargetIds: string[] = [],
  duties: SchedulerRobotState["duties"] = { rest: true, work: true, wake: true },
  dutyOrder: readonly SchedulerDuty[] = ["rest", "work", "wake"],
): { workerId: string; targetId: string; action: "rest" | "work" | "wake" | "evacuate" } | null {
  const busy = new Set([...busyWorkerIds, ...state.workers.filter((worker) => worker.status === "dragging").map((worker) => worker.id)]);
  const capacity = (plot: PlotState) => Math.floor(plot.cols * plot.rows / 4);
  const plotsById = new Map(state.plots.map((plot) => [plot.id, plot]));
  const occupancyByPlot = new Map<string, number>();
  for (const worker of state.workers) {
    if (worker.zoneId) occupancyByPlot.set(worker.zoneId, (occupancyByPlot.get(worker.zoneId) ?? 0) + 1);
  }
  for (const targetId of reservedTargetIds) occupancyByPlot.set(targetId, (occupancyByPlot.get(targetId) ?? 0) + 1);
  const occupancy = (plotId: string) => occupancyByPlot.get(plotId) ?? 0;
  const livingPlots = state.plots.filter((plot) => plot.type === "living" && plot.enabled !== false && occupancy(plot.id) < capacity(plot));
  const workPlots = state.plots.filter((plot) => plot.type !== "living" && plot.enabled !== false && occupancy(plot.id) < capacity(plot));
  const requiredRaw = Math.min(
    ...state.plots
      .filter((plot) => plot.type === "process" && plot.enabled !== false)
      .map((plot) => RECIPES[state.processPlots[plot.id]?.recipe ?? "rough"].raw),
  );
  const preferredType: ZoneType = state.inventory.raw >= requiredRaw ? "process" : "gather";
  const balancedWorkPlot = (plots = workPlots) => [...plots].sort((a, b) => {
    const ratioDifference = occupancy(a.id) / capacity(a) - occupancy(b.id) / capacity(b);
    if (ratioDifference) return ratioDifference;
    const typeDifference = Number(b.type === preferredType) - Number(a.type === preferredType);
    return typeDifference || occupancy(a.id) - occupancy(b.id) || a.id.localeCompare(b.id);
  })[0];
  const balancedLivingPlot = () => [...livingPlots].sort((a, b) => occupancy(a.id) / capacity(a) - occupancy(b.id) / capacity(b))[0];

  // Evacuation takes precedence over every configured duty and includes foremen.
  for (const worker of state.workers) {
    if (busy.has(worker.id) || !worker.zoneId) continue;
    const source = plotsById.get(worker.zoneId);
    if (source?.enabled !== false) continue;
    const needsRest = worker.mood <= 0 || (source.type === "living" && worker.mood < 100);
    const target = (needsRest ? balancedLivingPlot() : undefined)
      ?? (worker.mood > 0 && source.type !== "living" ? balancedWorkPlot(workPlots.filter((plot) => plot.type === source.type)) : undefined)
      ?? balancedWorkPlot()
      ?? balancedLivingPlot();
    if (target) return { workerId: worker.id, targetId: target.id, action: "evacuate" };
  }

  // Foremen occupy ordinary work slots, but only evacuation may move them automatically.
  for (const worker of state.workers) if (isForeman(worker)) busy.add(worker.id);
  const exhausted = duties.rest ? state.workers.find((worker) =>
    !busy.has(worker.id) &&
    worker.status === "exhausted" &&
    (!worker.zoneId || plotsById.get(worker.zoneId)?.type !== "living")
  ) : undefined;

  // The shared robot queue puts recently assigned duties last. Skip duties with
  // no eligible job without changing the order of other waiting duties.
  for (const duty of dutyOrder) {
    if (!duties[duty]) continue;
    if (duty === "rest" && exhausted) {
      const target = balancedLivingPlot();
      if (target) return { workerId: exhausted.id, targetId: target.id, action: "rest" };

      // Make room for recovery when every living slot is occupied or reserved.
      if (duties.work) {
        const candidate = state.workers
          .filter((worker) => !busy.has(worker.id) && worker.mood > 0 && Boolean(worker.zoneId) && plotsById.get(worker.zoneId!)?.type === "living")
          .sort((a, b) => b.mood - a.mood)[0];
        const workTarget = balancedWorkPlot();
        if (candidate && workTarget) return { workerId: candidate.id, targetId: workTarget.id, action: "work" };
      }
    }
    if (duty === "work") {
      const ready = state.workers.find((worker) =>
        !busy.has(worker.id) &&
        worker.status === "ready" &&
        Boolean(worker.zoneId) && plotsById.get(worker.zoneId!)?.type === "living"
      );
      const target = balancedWorkPlot();
      if (ready && target) return { workerId: ready.id, targetId: target.id, action: "work" };
    }
    if (duty === "wake") {
      const slacking = state.workers.find((worker) => !busy.has(worker.id) && worker.status === "slacking" && Boolean(worker.zoneId) && plotsById.get(worker.zoneId!)?.enabled !== false);
      if (slacking?.zoneId) return { workerId: slacking.id, targetId: slacking.zoneId, action: "wake" };
    }
  }
  return null;
}

export function sellProducts(
  state: GameState,
  kind: "rough" | "refined" | "screws" | "rebar" | "all",
  amount?: number,
): GameState {
  const requestedAmount = kind !== "all" && amount !== undefined ? Math.floor(amount) : undefined;
  if (requestedAmount !== undefined && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) return state;
  const saleCount = (product: "rough" | "refined" | "screws" | "rebar") => {
    if (kind !== "all" && kind !== product) return 0;
    return requestedAmount === undefined ? state.inventory[product] : Math.min(requestedAmount, Math.max(0, Math.floor(state.inventory[product])));
  };
  const roughCount = saleCount("rough");
  const refinedCount = saleCount("refined");
  const screwCount = saleCount("screws");
  const rebarCount = saleCount("rebar");
  if (roughCount + refinedCount + screwCount + rebarCount === 0) return state;
  return {
    ...state,
    coins: state.coins + roughCount * state.market.roughPrice + refinedCount * state.market.refinedPrice + screwCount * SYNTHESIS_SELL_PRICES.screws + rebarCount * SYNTHESIS_SELL_PRICES.rebar,
    inventory: {
      ...state.inventory,
      rough: state.inventory.rough - roughCount,
      refined: state.inventory.refined - refinedCount,
      screws: state.inventory.screws - screwCount,
      rebar: state.inventory.rebar - rebarCount,
    },
  };
}

const HALF_TILE_WIDTH = 52;
const plotCenter = (plot: PlotState) => ({ x: plot.x + plot.rows * 52, y: plot.y + plot.rows * 27 });
const pointInDiamond = (x: number, y: number, plot: PlotState) => {
  const center = plotCenter(plot);
  return Math.abs(x - center.x) / (plot.rows * 52) + Math.abs(y - center.y) / (plot.rows * 27) <= 1;
};
export function circleHitsPlot(x: number, y: number, radius: number, plot: PlotState) {
  const r = radius * HALF_TILE_WIDTH;
  const center = plotCenter(plot);
  if (pointInDiamond(x, y, plot)) return true;
  const vertices = [
    { x: center.x, y: plot.y },
    { x: plot.x + plot.rows * 104, y: center.y },
    { x: center.x, y: plot.y + plot.rows * 54 },
    { x: plot.x, y: center.y },
  ];
  const scaleY = HALF_TILE_WIDTH / 27;
  const circle = { x, y: y * scaleY };
  const scaledVertices = vertices.map((point) => ({ x: point.x, y: point.y * scaleY }));
  const distanceToEdge = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const lengthSquared = edgeX * edgeX + edgeY * edgeY;
    const projection = lengthSquared === 0 ? 0 : ((circle.x - start.x) * edgeX + (circle.y - start.y) * edgeY) / lengthSquared;
    const clamped = Math.max(0, Math.min(1, projection));
    return Math.hypot(circle.x - (start.x + edgeX * clamped), circle.y - (start.y + edgeY * clamped));
  };
  return scaledVertices.some((start, index) => distanceToEdge(start, scaledVertices[(index + 1) % scaledVertices.length]) <= r);
}

const randomSpecial = (random: () => number): SpecialItemId => (["canOpener", "smartLeader", "holyLight"] as SpecialItemId[])[Math.min(2, Math.floor(random() * 3))];

function createOrder(state: GameState, random: () => number): OrderState {
  const processed: RecipeId = random() < .5 ? "rough" : "refined";
  const synthesized: "screws" | "rebar" = random() < .5 ? "screws" : "rebar";
  const processWorkers = Math.max(1, state.workers.filter((worker) => { const plot = state.plots.find((item) => item.id === worker.zoneId); return plot?.type === "process" && plot.enabled !== false; }).length);
  const synthesisWorkers = Math.max(1, state.workers.filter((worker) => { const plot = state.plots.find((item) => item.id === worker.zoneId); return plot?.type === "synthesis" && plot.enabled !== false; }).length);
  const processedCapacity = processWorkers * 300 / RECIPES[processed].seconds;
  const synthesisRecipe = SYNTHESIS_RECIPES[synthesized];
  const synthesisCapacity = synthesisWorkers * 300 / synthesisRecipe.seconds * synthesisRecipe.output;
  const processedAmount = Math.max(1, Math.floor(processedCapacity * (.3 + random() * .3)));
  const batches = Math.max(1, Math.floor(synthesisCapacity * (.3 + random() * .3) / synthesisRecipe.output));
  return {
    id: `order-${state.orderSerial + 1}`,
    remaining: 300,
    processed: { kind: processed, amount: processedAmount },
    synthesized: { kind: synthesized, amount: batches * synthesisRecipe.output },
    reward: random() < .75 ? "coins" : "special",
  };
}

export function submitOrder(state: GameState, orderId: string, random = Math.random): GameState {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || state.inventory[order.processed.kind] < order.processed.amount || state.inventory[order.synthesized.kind] < order.synthesized.amount) return state;
  const inventory = {
    ...state.inventory,
    specials: { ...state.inventory.specials },
    [order.processed.kind]: state.inventory[order.processed.kind] - order.processed.amount,
    [order.synthesized.kind]: state.inventory[order.synthesized.kind] - order.synthesized.amount,
  };
  const coins = state.coins + orderCoinReward(state, order);
  if (order.reward === "special") {
    const item = randomSpecial(random);
    inventory.specials[item] += 1;
  }
  return { ...state, coins, inventory, orders: state.orders.filter((item) => item.id !== orderId) };
}

export function orderCoinReward(state: GameState, order: OrderState) {
  const processedPrice = order.processed.kind === "rough" ? state.market.roughPrice : state.market.refinedPrice;
  const synthPrice = SYNTHESIS_SELL_PRICES[order.synthesized.kind];
  const standardReward = Math.ceil((order.processed.amount * processedPrice + order.synthesized.amount * synthPrice) * 1.5 * (1 + state.research.orders * .1));
  return order.reward === "special" ? Math.ceil(standardReward * 1.5) : standardReward;
}

export function stepGame(state: GameState, seconds: number, random = Math.random, onResourceChange?: (kind: ResourceKind, delta: number) => void): GameState {
  const dt = clamp(seconds, 0, 1);
  if (dt <= 0) return state;
  const inventory = { ...state.inventory, specials: { ...state.inventory.specials } };
  let coins = state.coins;
  if (state.autoCanSupply && inventory.cans < 200 && coins >= 400) {
    inventory.cans += 200; coins -= 400;
    onResourceChange?.("cans", 200); onResourceChange?.("coins", -400);
  }
  let market = { ...state.market, elapsed: state.market.elapsed + dt };
  if (market.elapsed >= 300) market = { roughPrice: randomMarketPrice(10, random), refinedPrice: randomMarketPrice(30, random), elapsed: market.elapsed % 300 };
  let schedulerSeconds = Math.max(0, state.schedulerSeconds - dt);
  if (state.autoSchedulerSupply && schedulerSeconds < 180 && coins >= 300) {
    schedulerSeconds += 180; coins -= 300;
    onResourceChange?.("coins", -300);
  }

  const effects: TimedEffectsState = {
    canOpener: Math.max(0, state.effects.canOpener - dt),
    smartLeader: Math.max(0, state.effects.smartLeader - dt),
    holyLight: state.effects.holyLight
      .map((light) => ({ ...light, remaining: light.remaining - dt }))
      .filter((light) => light.remaining > 0),
  };
  const processPlots = Object.fromEntries(Object.entries(state.processPlots).map(([id, value]) => [id, { ...value, batch: { ...value.batch } }]));
  const synthesisPlots = Object.fromEntries(Object.entries(state.synthesisPlots).map(([id, value]) => [id, { ...value, batch: { ...value.batch, reserved: { ...value.batch.reserved } } }]));
  const plots = state.plots;
  const workers = state.workers.map((worker) => ({ ...worker }));

  const plotById = new Map(plots.map((plot) => [plot.id, plot]));
  const zoneTypes = new Map(plots.map((plot) => [plot.id, plot.type]));
  const workZones: ZoneType[] = ["gather", "process", "synthesis"];
  const holyPlot = (plot: PlotState) => effects.holyLight.some((light) => circleHitsPlot(light.x, light.y, 8, plot));
  const guarded = guardedPlotIds(workers);
  const productionMultiplier = (plot: PlotState, holy: boolean) => 1 + Number(holy) + Number(guarded.has(plot.id));
  for (const worker of workers) {
    if (worker.status === "dragging") continue;
    if (isForeman(worker)) {
      worker.mood = 100;
      worker.continuousWork = worker.slowStacks = worker.lazyElapsed = 0;
      delete worker.lazyCheckInterval;
      if (worker.status === "slacking" || worker.status === "exhausted") worker.status = "idle";
    }
    const plot = worker.zoneId ? plotById.get(worker.zoneId) : undefined;
    const zoneType = plot?.type;
    if (!plot || !zoneType) { worker.status = "idle"; worker.continuousWork = worker.slowStacks = worker.lazyElapsed = 0; delete worker.lazyCheckInterval; continue; }
    if (plot.enabled === false) {
      worker.status = "idle";
      worker.continuousWork = worker.slowStacks = worker.lazyElapsed = 0;
      delete worker.lazyCheckInterval;
      continue;
    }
    if (zoneType === "living") {
      worker.continuousWork = worker.slowStacks = worker.lazyElapsed = 0;
      delete worker.lazyCheckInterval;
      if (worker.mood >= 100) { worker.mood = 100; worker.status = "ready"; }
      else if (inventory.cans > 0) {
        const rate = recoveryRate(worker.spirit) * (effects.canOpener > 0 || state.canOpenerSeconds > 0 ? 1.5 : 1) * (guarded.has(plot.id) ? 2 : 1);
        const actualSeconds = Math.min(dt, (100 - worker.mood) / rate, inventory.cans / .01);
        inventory.cans -= .01 * actualSeconds;
        onResourceChange?.("cans", -.01 * actualSeconds);
        worker.mood = clamp(worker.mood + rate * actualSeconds, 0, 100);
        worker.status = worker.mood >= 100 ? "ready" : "resting";
      } else worker.status = "waiting";
      continue;
    }
    if (worker.mood <= 0) { worker.mood = 0; worker.status = "exhausted"; worker.lazyElapsed = 0; delete worker.lazyCheckInterval; continue; }
    if (workZones.includes(zoneType) && !isForeman(worker)) {
      worker.continuousWork += dt;
      if (worker.personality === "slowBurn") worker.slowStacks = Math.floor(worker.continuousWork / 10);
      if (worker.personality === "lazy" && worker.status !== "slacking") {
        if (worker.lazyCheckInterval === undefined) {
          // Fresh work and pre-jitter saves receive a full independent interval.
          // Do not reuse old elapsed time, which could trigger a batch on load.
          worker.lazyElapsed = 0;
          worker.lazyCheckInterval = 18 + random() * 4;
        }
        worker.lazyElapsed += dt;
        if (worker.lazyElapsed >= worker.lazyCheckInterval) {
          worker.lazyElapsed -= worker.lazyCheckInterval;
          // Draw the probability separately from the next interval: neither
          // shorter nor longer intervals should be more likely to cause slacking.
          if (random() < .3) {
            worker.status = "slacking";
            worker.lazyElapsed = 0;
            delete worker.lazyCheckInterval;
          } else worker.lazyCheckInterval = 18 + random() * 4;
        }
      } else if (worker.status === "slacking") {
        worker.lazyElapsed = 0;
        delete worker.lazyCheckInterval;
      }
    }
  }

  const gatherWorkers = workers.filter((worker) => worker.zoneId && zoneTypes.get(worker.zoneId) === "gather" && worker.mood > 0 && worker.status !== "dragging" && plotById.get(worker.zoneId)?.enabled !== false);
  const gatherLeaders = new Map<string, number>();
  for (const worker of gatherWorkers) if (!isForeman(worker) && worker.personality === "leader") gatherLeaders.set(worker.zoneId!, (gatherLeaders.get(worker.zoneId!) ?? 0) + 1);
  for (const worker of gatherWorkers) {
    const plot = plotById.get(worker.zoneId!)!;
    const holy = holyPlot(plot);
    if (!holy && !isForeman(worker)) worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100);
    if (worker.status !== "slacking") {
      const rate = gatherAttributeRate(worker.efficiency) * personalityRate(worker, gatherLeaders.get(worker.zoneId!) ?? 0) * productionMultiplier(plot, holy);
      inventory.raw += 10 * rate * dt;
      onResourceChange?.("raw", 10 * rate * dt);
      worker.status = worker.mood <= 0 ? "exhausted" : "gathering";
    } else if (worker.mood <= 0) worker.status = "exhausted";
  }

  const workersByType = (type: ZoneType) => {
    const map = new Map<string, WorkerState[]>();
    for (const worker of workers) if (worker.zoneId && zoneTypes.get(worker.zoneId) === type && worker.mood > 0 && worker.status !== "dragging" && plotById.get(worker.zoneId)?.enabled !== false) {
      const group = map.get(worker.zoneId); if (group) group.push(worker); else map.set(worker.zoneId, [worker]);
    }
    return map;
  };
  const processWorkersByPlot = workersByType("process");
  for (const plot of plots.filter((item) => item.type === "process" && item.enabled !== false)) {
    const plotState = processPlots[plot.id] ?? { recipe: "rough" as const, produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } };
    processPlots[plot.id] = plotState;
    const group = processWorkersByPlot.get(plot.id) ?? [];
    const active = group.filter((worker) => worker.status !== "slacking");
    const recipe = RECIPES[plotState.recipe];
    if (!plotState.batch.active && active.length && inventory.raw >= recipe.raw) {
      inventory.raw -= recipe.raw;
      onResourceChange?.("raw", -recipe.raw);
      plotState.batch = { active: true, progress: 0, reservedRaw: recipe.raw };
    }
    if (plotState.batch.active && active.length) {
      const leaders = group.filter((worker) => !isForeman(worker) && worker.personality === "leader").length;
      const holy = holyPlot(plot);
      let contribution = 0;
      for (const worker of active) { if (!holy && !isForeman(worker)) worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100); contribution += processAttributeRate(worker.efficiency) * personalityRate(worker, leaders) * productionMultiplier(plot, holy); worker.status = worker.mood <= 0 ? "exhausted" : "processing"; }
      for (const worker of group.filter((item) => item.status === "slacking")) { if (!holy && !isForeman(worker)) worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100); if (worker.mood <= 0) worker.status = "exhausted"; }
      plotState.batch.progress += contribution * dt / recipe.seconds;
      while (plotState.batch.progress >= 1) {
        const overflow = plotState.batch.progress - 1; inventory[plotState.recipe] += 1; plotState.produced += 1;
        onResourceChange?.(plotState.recipe, 1);
        if (inventory.raw >= recipe.raw) {
          inventory.raw -= recipe.raw;
          onResourceChange?.("raw", -recipe.raw);
          plotState.batch = { active: true, progress: overflow, reservedRaw: recipe.raw };
        }
        else plotState.batch = { active: false, progress: 0, reservedRaw: 0 };
      }
    } else for (const worker of group) if (worker.status !== "slacking" && worker.status !== "exhausted") worker.status = "waiting";
  }

  const synthesisWorkersByPlot = workersByType("synthesis");
  for (const plot of plots.filter((item) => item.type === "synthesis" && item.enabled !== false)) {
    const plotState = synthesisPlots[plot.id] ?? { recipe: "cans" as const, produced: 0, batch: { active: false, progress: 0, reserved: {} } };
    synthesisPlots[plot.id] = plotState;
    const group = synthesisWorkersByPlot.get(plot.id) ?? [];
    const active = group.filter((worker) => worker.status !== "slacking");
    const recipe = SYNTHESIS_RECIPES[plotState.recipe];
    const canReserve = Object.entries(recipe.inputs).every(([kind, amount]) => inventory[kind as "rough" | "refined" | "screws"] >= amount);
    if (!plotState.batch.active && active.length && canReserve) {
      const reserved: SynthesisPlotState["batch"]["reserved"] = {};
      for (const [kind, amount] of Object.entries(recipe.inputs)) {
        inventory[kind as "rough" | "refined" | "screws"] -= amount;
        onResourceChange?.(kind as ResourceKind, -amount);
        reserved[kind as "rough" | "refined" | "screws"] = amount;
      }
      plotState.batch = { active: true, progress: 0, reserved };
    }
    if (plotState.batch.active && active.length) {
      const leaders = group.filter((worker) => !isForeman(worker) && worker.personality === "leader").length;
      const holy = holyPlot(plot);
      let contribution = 0;
      for (const worker of active) { if (!holy && !isForeman(worker)) worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100); contribution += processAttributeRate(worker.efficiency) * personalityRate(worker, leaders) * (1 + state.research.synthesis * .15) * productionMultiplier(plot, holy); worker.status = worker.mood <= 0 ? "exhausted" : "synthesizing"; }
      for (const worker of group.filter((item) => item.status === "slacking")) { if (!holy && !isForeman(worker)) worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100); if (worker.mood <= 0) worker.status = "exhausted"; }
      plotState.batch.progress += contribution * dt / recipe.seconds;
      while (plotState.batch.progress >= 1) {
        const overflow = plotState.batch.progress - 1; inventory[plotState.recipe] += recipe.output; plotState.produced += recipe.output;
        onResourceChange?.(plotState.recipe, recipe.output);
        const reserveAgain = Object.entries(recipe.inputs).every(([kind, amount]) => inventory[kind as "rough" | "refined" | "screws"] >= amount);
        if (reserveAgain) {
          const reserved: SynthesisPlotState["batch"]["reserved"] = {};
          for (const [kind, amount] of Object.entries(recipe.inputs)) {
            inventory[kind as "rough" | "refined" | "screws"] -= amount;
            onResourceChange?.(kind as ResourceKind, -amount);
            reserved[kind as "rough" | "refined" | "screws"] = amount;
          }
          plotState.batch = { active: true, progress: overflow, reserved };
        }
        else plotState.batch = { active: false, progress: 0, reserved: {} };
      }
    } else for (const worker of group) if (worker.status !== "slacking" && worker.status !== "exhausted") worker.status = "waiting";
  }

  const orders = state.orders.map((order) => ({ ...order, remaining: order.remaining - dt })).filter((order) => order.remaining > 0).slice(0, 2);
  let orderElapsed = Math.min(180, state.orderElapsed + dt);
  let orderSerial = state.orderSerial;
  if (orderElapsed >= 180 && plots.some((plot) => plot.type === "synthesis") && orders.length < 2) {
    const order = createOrder({ ...state, plots, workers, orderSerial }, random);
    orders.push(order);
    orderSerial += 1;
    orderElapsed = 0;
  }
  const canOpenerSeconds = Math.max(0, state.canOpenerSeconds - dt);
  return { ...state, coins, inventory, workers, plots, processPlots, synthesisPlots, market, schedulerSeconds, canOpenerSeconds, canOpenerCooldown: 0, orders, orderElapsed, orderSerial, effects };
}

export function parseSavedState(value: string | null): GameState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Omit<Partial<GameState>, "version" | "workers" | "effects"> & {
      version?: number;
      effects?: Omit<Partial<TimedEffectsState>, "holyLight"> & {
        holyLight?: HolyLightEffect[] | Omit<HolyLightEffect, "id"> | null;
      };
      workers?: (Omit<WorkerState, "status"> & {
        status: WorkerStatus | "unconscious" | "recovering";
        recoveryRemaining?: number;
        moving?: boolean;
        motion?: string;
      })[];
      recipe?: RecipeId;
      recipeProduced?: number;
      batch?: ProcessPlotState["batch"];
    };
    if (
      ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(parsed.version ?? 0) ||
      !Number.isFinite(parsed.coins) ||
      !Array.isArray(parsed.workers) ||
      !parsed.inventory ||
      !parsed.market ||
      ((parsed.version ?? 0) >= 3 && !parsed.processPlots) ||
      ((parsed.version ?? 0) < 3 && !parsed.batch)
    ) return null;
    if (parsed.workers.some((worker) => worker.role !== undefined && worker.role !== "foreman")) return null;
    const foremanCount = parsed.workers.filter(isForeman).length;
    if (foremanCount > 1) return null;
    // Older previews already carried this reward. Preserve it while preventing
    // another first-rebirth grant; current saves must carry a consistent record.
    if (parsed.version === 9 && (
      (parsed.rebirthCount !== 0 && parsed.rebirthCount !== 1)
      || parsed.rebirthCount !== foremanCount
    )) return null;
    const rebirthCount: 0 | 1 = foremanCount === 1 ? 1 : 0;
    if (parsed.workers.some((worker) => worker.lazyCheckInterval !== undefined && (
      !Number.isFinite(worker.lazyCheckInterval) || worker.lazyCheckInterval < 18 || worker.lazyCheckInterval > 22
    ))) return null;
    // Earlier saves stored one circle (or null); keep its position and timer.
    const savedHolyLight = parsed.effects?.holyLight;
    const holyLight: HolyLightEffect[] = savedHolyLight == null ? []
      : Array.isArray(savedHolyLight) ? savedHolyLight
      : [{ ...savedHolyLight, id: "holy-light-legacy" }];
    const holyLightIds = new Set<string>();
    for (const light of holyLight) {
      if (!light || typeof light.id !== "string" || !light.id.trim() || holyLightIds.has(light.id)
        || !Number.isFinite(light.x) || !Number.isFinite(light.y)
        || !Number.isFinite(light.remaining) || light.remaining < 0) return null;
      holyLightIds.add(light.id);
    }
    const rawPlots = Array.isArray(parsed.plots) && parsed.plots.length
      ? parsed.plots
      : INITIAL_PLOTS.map((plot) => ({ ...plot }));
    const plots = rawPlots.map((plot) => {
      const restored = { ...plot } as PlotState & { damagedRemaining?: number; reinforcedFor?: string | null };
      delete restored.damagedRemaining;
      delete restored.reinforcedFor;
      return {
        ...restored,
        purchasePrice: Number.isFinite(plot.purchasePrice) && plot.purchasePrice > 0
          ? plot.purchasePrice
          : plotPurchasePrice(plot.cols),
        enabled: plot.enabled !== false,
      };
    });
    const zoneTypes = new Map(plots.map((plot) => [plot.id, plot.type]));
    const firstProcessId = plots.find((plot) => plot.type === "process")?.id;
    const processPlots = Object.fromEntries(plots
      .filter((plot) => plot.type === "process")
      .map((plot) => {
        const saved = parsed.processPlots?.[plot.id];
        const migrated = plot.id === firstProcessId && (parsed.version ?? 0) < 3 ? {
          recipe: parsed.recipe === "refined" ? "refined" as const : "rough" as const,
          produced: Number.isFinite(parsed.recipeProduced) ? Math.max(0, Math.floor(parsed.recipeProduced!)) : 0,
          batch: parsed.batch
            ? {
                active: Boolean(parsed.batch.active),
                progress: Number.isFinite(parsed.batch.progress) ? Math.max(0, parsed.batch.progress) : 0,
                reservedRaw: Number.isFinite(parsed.batch.reservedRaw) ? Math.max(0, parsed.batch.reservedRaw) : 0,
              }
            : { active: false, progress: 0, reservedRaw: 0 },
        } : null;
        return [plot.id, saved ? {
          recipe: saved.recipe === "refined" ? "refined" as const : "rough" as const,
          produced: Number.isFinite(saved.produced) ? Math.max(0, Math.floor(saved.produced)) : 0,
          batch: {
            active: Boolean(saved.batch?.active),
            progress: Number.isFinite(saved.batch?.progress) ? Math.max(0, saved.batch.progress) : 0,
            reservedRaw: Number.isFinite(saved.batch?.reservedRaw) ? Math.max(0, saved.batch.reservedRaw) : 0,
          },
        } : migrated ?? {
          recipe: "rough" as const,
          produced: 0,
          batch: { active: false, progress: 0, reservedRaw: 0 },
        }];
      }));
    const synthesisPlots = Object.fromEntries(plots.filter((plot) => plot.type === "synthesis").map((plot) => {
      const saved = parsed.synthesisPlots?.[plot.id];
      const recipe: SynthesisRecipeId = saved?.recipe === "screws" || saved?.recipe === "rebar" ? saved.recipe : "cans";
      return [plot.id, {
        recipe,
        produced: Number.isFinite(saved?.produced) ? Math.max(0, Math.floor(saved!.produced)) : 0,
        batch: {
          active: Boolean(saved?.batch?.active),
          progress: Number.isFinite(saved?.batch?.progress) ? Math.max(0, saved!.batch.progress) : 0,
          reserved: { ...(saved?.batch?.reserved ?? {}) },
        },
      }];
    }));
    const schedulerBots = Number.isFinite(parsed.schedulerBots) ? Math.max(1, Math.floor(parsed.schedulerBots!)) : 1;
    const schedulerRobots = Array.from({ length: schedulerBots }, (_, index) => {
      const saved = Array.isArray(parsed.schedulerRobots) ? parsed.schedulerRobots[index] : null;
      return {
        efficiency: saved && Number.isFinite(saved.efficiency) ? clamp(saved.efficiency, 1, SCHEDULER_EFFICIENCY_MAX) : 1,
        intervalSeconds: saved && Number.isFinite(saved.intervalSeconds) ? clamp(saved.intervalSeconds, .1, 3) : 3,
        duties: {
          rest: saved?.duties?.rest ?? true,
          work: saved?.duties?.work ?? true,
          wake: saved?.duties?.wake ?? true,
        },
      };
    });
    return {
      version: 9,
      rebirthCount,
      coins: parsed.coins!,
      plots,
      processPlots,
      synthesisPlots,
      schedulerSeconds: Number.isFinite(parsed.schedulerSeconds) ? parsed.schedulerSeconds! : 0,
      schedulerBots,
      schedulerRobots,
      canOpenerSeconds: 0,
      canOpenerCooldown: 0,
      autoCanSupply: Boolean(parsed.autoCanSupply),
      autoSchedulerSupply: Boolean(parsed.autoSchedulerSupply),
      schedulerServiceUnlocked: Boolean(parsed.schedulerServiceUnlocked || parsed.schedulerSeconds! > 0 || parsed.autoSchedulerSupply),
      inventory: {
        raw: parsed.inventory.raw,
        cans: parsed.inventory.cans,
        rough: parsed.inventory.rough,
        refined: parsed.inventory.refined,
        screws: Number.isFinite(parsed.inventory.screws) ? parsed.inventory.screws : 0,
        rebar: Number.isFinite(parsed.inventory.rebar) ? parsed.inventory.rebar : 0,
        specials: {
          canOpener: Number.isFinite(parsed.inventory.specials?.canOpener) ? parsed.inventory.specials!.canOpener : 0,
          smartLeader: Number.isFinite(parsed.inventory.specials?.smartLeader) ? parsed.inventory.specials!.smartLeader : 0,
          holyLight: Number.isFinite(parsed.inventory.specials?.holyLight) ? parsed.inventory.specials!.holyLight : 0,
        },
      },
      market: {
        ...parsed.market!,
        roughPrice: Math.round(parsed.market.roughPrice),
        refinedPrice: Math.round(parsed.market.refinedPrice),
      },
      workers: parsed.workers.map((worker) => {
        // Retired meteor injuries must not leave old saves unable to work.
        const wasInjured = worker.status === "unconscious" || worker.status === "recovering" || (worker.recoveryRemaining ?? 0) > 0;
        const restored = { ...worker };
        delete restored.moving;
        delete restored.motion;
        delete restored.recoveryRemaining;
        if (wasInjured || worker.status === "dragging" || isForeman(worker)) {
          restored.lazyElapsed = 0;
          delete restored.lazyCheckInterval;
        }
        if (isForeman(worker)) restored.continuousWork = restored.slowStacks = 0;
        const mood = wasInjured || isForeman(worker) ? 100 : worker.mood;
        const status: WorkerStatus = wasInjured || worker.status === "dragging" || (isForeman(worker) && (worker.status === "slacking" || worker.status === "exhausted"))
          ? worker.zoneId && zoneTypes.get(worker.zoneId) === "living"
            ? (mood >= 100 ? "ready" : "resting")
            : mood <= 0 ? "exhausted" : "idle"
          : worker.status as WorkerStatus;
        return {
          ...restored,
          mood,
          status,
          lastWorkZoneId: worker.lastWorkZoneId ?? null,
        };
      }),
      orders: Array.isArray(parsed.orders) ? parsed.orders.filter((order) => order && order.remaining > 0).slice(0, 2) : [],
      orderElapsed: Number.isFinite(parsed.orderElapsed) ? clamp(parsed.orderElapsed!, 0, 180) : 0,
      orderSerial: Number.isFinite(parsed.orderSerial) ? Math.max(0, Math.floor(parsed.orderSerial!)) : 0,
      research: {
        synthesis: clamp(Math.floor(parsed.research?.synthesis ?? 0), 0, 5),
        orders: clamp(Math.floor(parsed.research?.orders ?? 0), 0, 5),
      },
      effects: {
        canOpener: Math.max(0, parsed.effects?.canOpener ?? parsed.canOpenerSeconds ?? 0),
        smartLeader: Math.max(0, parsed.effects?.smartLeader ?? 0),
        holyLight,
      },
      plotPurchases: parsed.plotPurchases ?? {
        gather: Math.max(0, plots.filter((plot) => plot.type === "gather").length - 1),
        process: Math.max(0, plots.filter((plot) => plot.type === "process").length - 1),
        synthesis: plots.filter((plot) => plot.type === "synthesis").length,
        living: Math.max(0, plots.filter((plot) => plot.type === "living").length - 1),
      },
    };
  } catch {
    return null;
  }
}
