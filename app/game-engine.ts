export type ZoneType = "gather" | "process" | "living";
export type ZoneId = string;
export type Personality = "leader" | "slowBurn" | "lazy";
export type RecipeId = "rough" | "refined";
export type WorkerStatus =
  | "idle"
  | "gathering"
  | "processing"
  | "waiting"
  | "slacking"
  | "exhausted"
  | "resting"
  | "ready"
  | "dragging";

export type WorkerState = {
  id: string;
  name: string;
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
};

export type SchedulerRobotState = {
  efficiency: number;
  intervalSeconds: number;
  duties: { rest: boolean; work: boolean; wake: boolean };
};

export type SchedulerDuty = keyof SchedulerRobotState["duties"];

export type ProcessPlotState = {
  recipe: RecipeId;
  produced: number;
  batch: { active: boolean; progress: number; reservedRaw: number };
};

export type GameState = {
  version: 3;
  coins: number;
  inventory: {
    raw: number;
    cans: number;
    rough: number;
    refined: number;
    potions: number;
  };
  plots: PlotState[];
  workers: WorkerState[];
  processPlots: Record<ZoneId, ProcessPlotState>;
  market: { roughPrice: number; refinedPrice: number; elapsed: number };
  schedulerSeconds: number;
  schedulerBots: number;
  schedulerRobots: SchedulerRobotState[];
  canOpenerSeconds: number;
  canOpenerCooldown: number;
};

export const INITIAL_PLOTS: PlotState[] = [
  { id: "gather", type: "gather", name: "采集区", x: 80, y: 170, cols: 8, rows: 8, purchasePrice: 1200 },
  { id: "process", type: "process", name: "加工区", x: 1080, y: 170, cols: 8, rows: 8, purchasePrice: 1200 },
  { id: "living", type: "living", name: "生活区", x: 790, y: 745, cols: 4, rows: 4, purchasePrice: 300 },
];

export const RECIPES = {
  rough: { name: "粗加工", raw: 75, seconds: 10, basePrice: 10 },
  refined: { name: "精加工", raw: 200, seconds: 30, basePrice: 30 },
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

function personalityRate(worker: WorkerState, zoneLeaderCount: number) {
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
    version: 3,
    coins: 100,
    inventory: { raw: 0, cans: 20, rough: 0, refined: 0, potions: 0 },
    plots: INITIAL_PLOTS.map((plot) => ({ ...plot })),
    workers: [createInitialWorker(x, y)],
    processPlots: {
      process: { recipe: "rough", produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } },
    },
    market: { roughPrice: 10, refinedPrice: 30, elapsed: 0 },
    schedulerSeconds: 0,
    schedulerBots: 1,
    schedulerRobots: [{ efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }],
    canOpenerSeconds: 0,
    canOpenerCooldown: 0,
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

export function buyCans(state: GameState, amount: number): GameState {
  const cost = amount * 2;
  if (state.coins < cost) return state;
  return {
    ...state,
    coins: state.coins - cost,
    inventory: { ...state.inventory, cans: state.inventory.cans + amount },
  };
}

export function buyWorker(
  state: GameState,
  x: number,
  y: number,
  random = Math.random,
  placement?: { zoneId: ZoneId; u: number; v: number },
): GameState {
  if (state.coins < 100) return state;
  const zoneId = placement?.zoneId ?? "living";
  const livingPlot = state.plots.find((plot) => plot.id === zoneId && plot.type === "living");
  const capacity = livingPlot ? Math.floor(livingPlot.cols * livingPlot.rows / 4) : 0;
  if (!livingPlot || state.workers.filter((worker) => worker.zoneId === zoneId).length >= capacity) return state;
  const worker = {
    ...createRandomWorker(state.workers.length + 1, x, y, random),
    zoneId,
    u: placement?.u ?? 2,
    v: placement?.v ?? 2,
  };
  return {
    ...state,
    coins: state.coins - 100,
    workers: [...state.workers, worker],
  };
}

export function plotPurchasePrice(size: 4 | 8) {
  return size === 8 ? 1200 : 300;
}

export function buyPlot(state: GameState, plot: PlotState): GameState {
  const cost = plotPurchasePrice(plot.cols);
  if (state.coins < cost) return state;
  return {
    ...state,
    coins: state.coins - cost,
    plots: [...state.plots, { ...plot, purchasePrice: cost }],
    processPlots: plot.type === "process" ? {
      ...state.processPlots,
      [plot.id]: { recipe: "rough", produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } },
    } : state.processPlots,
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
    } : state.inventory,
    plots: state.plots.filter((item) => item.id !== plotId),
    processPlots: plot.type === "process"
      ? Object.fromEntries(Object.entries(state.processPlots).filter(([id]) => id !== plotId))
      : state.processPlots,
  };
}

export function buyScheduler(state: GameState): GameState {
  if (state.coins < 100) return state;
  return { ...state, coins: state.coins - 100, schedulerSeconds: state.schedulerSeconds + 60 };
}

export function buySchedulerBot(state: GameState): GameState {
  if (state.coins < 1000) return state;
  return {
    ...state,
    coins: state.coins - 1000,
    schedulerBots: state.schedulerBots + 1,
    schedulerRobots: [...state.schedulerRobots, { efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } }],
  };
}

export function buyCanOpener(state: GameState): GameState {
  if (state.coins < 300 || state.canOpenerCooldown > 0) return state;
  return { ...state, coins: state.coins - 300, canOpenerSeconds: 60, canOpenerCooldown: 300 };
}

export function upgradeSchedulerEfficiency(state: GameState, robotIndex: number): GameState {
  if (state.coins < 100 || !state.schedulerRobots[robotIndex]) return state;
  return {
    ...state,
    coins: state.coins - 100,
    schedulerRobots: state.schedulerRobots.map((robot, index) => index === robotIndex
      ? { ...robot, efficiency: Math.round((robot.efficiency + .01) * 100) / 100 }
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
): { workerId: string; targetId: string; action: "rest" | "work" | "wake" } | null {
  const busy = new Set(busyWorkerIds);
  const capacity = (plot: PlotState) => Math.floor(plot.cols * plot.rows / 4);
  const plotTypes = new Map(state.plots.map((plot) => [plot.id, plot.type]));
  const occupancyByPlot = new Map<string, number>();
  for (const worker of state.workers) {
    if (worker.zoneId) occupancyByPlot.set(worker.zoneId, (occupancyByPlot.get(worker.zoneId) ?? 0) + 1);
  }
  for (const targetId of reservedTargetIds) occupancyByPlot.set(targetId, (occupancyByPlot.get(targetId) ?? 0) + 1);
  const occupancy = (plotId: string) => occupancyByPlot.get(plotId) ?? 0;
  const livingPlots = state.plots.filter((plot) => plot.type === "living" && occupancy(plot.id) < capacity(plot));
  const workPlots = state.plots.filter((plot) => plot.type !== "living" && occupancy(plot.id) < capacity(plot));
  const requiredRaw = Math.min(
    ...state.plots
      .filter((plot) => plot.type === "process")
      .map((plot) => RECIPES[state.processPlots[plot.id]?.recipe ?? "rough"].raw),
  );
  const preferredType: ZoneType = state.inventory.raw >= requiredRaw ? "process" : "gather";
  const balancedWorkPlot = () => [...workPlots].sort((a, b) => {
    const ratioDifference = occupancy(a.id) / capacity(a) - occupancy(b.id) / capacity(b);
    if (ratioDifference) return ratioDifference;
    const typeDifference = Number(b.type === preferredType) - Number(a.type === preferredType);
    return typeDifference || occupancy(a.id) - occupancy(b.id) || a.id.localeCompare(b.id);
  })[0];
  const exhausted = duties.rest ? state.workers.find((worker) =>
    !busy.has(worker.id) &&
    worker.status === "exhausted" &&
    (!worker.zoneId || plotTypes.get(worker.zoneId) !== "living")
  ) : undefined;

  if (exhausted && livingPlots.length) {
    const target = [...livingPlots].sort((a, b) => occupancy(a.id) / capacity(a) - occupancy(b.id) / capacity(b))[0];
    return { workerId: exhausted.id, targetId: target.id, action: "rest" };
  }

  if (exhausted && !livingPlots.length && duties.work) {
    const candidate = state.workers
      .filter((worker) => !busy.has(worker.id) && worker.mood > 0 && Boolean(worker.zoneId) && plotTypes.get(worker.zoneId!) === "living")
      .sort((a, b) => b.mood - a.mood)[0];
    const target = balancedWorkPlot();
    if (candidate && target) return { workerId: candidate.id, targetId: target.id, action: "work" };
  }


  if (duties.wake) {
    const slacking = state.workers.find((worker) => !busy.has(worker.id) && worker.status === "slacking" && Boolean(worker.zoneId));
    if (slacking?.zoneId) return { workerId: slacking.id, targetId: slacking.zoneId, action: "wake" };
  }

  const ready = duties.work ? state.workers.find((worker) =>
    !busy.has(worker.id) &&
    worker.status === "ready" &&
    Boolean(worker.zoneId) && plotTypes.get(worker.zoneId!) === "living"
  ) : undefined;
  const target = balancedWorkPlot();
  return ready && target ? { workerId: ready.id, targetId: target.id, action: "work" } : null;
}

export function buyRebirthPotion(state: GameState): GameState {
  if (state.coins < 200) return state;
  return {
    ...state,
    coins: state.coins - 200,
    inventory: { ...state.inventory, potions: state.inventory.potions + 1 },
  };
}

export function applyRebirth(
  state: GameState,
  workerId: string,
  attributes?: { stamina: number; efficiency: number; spirit: number },
  random = Math.random,
): GameState {
  if (state.inventory.potions < 1 || !state.workers.some((worker) => worker.id === workerId)) return state;
  return {
    ...state,
    inventory: { ...state.inventory, potions: state.inventory.potions - 1 },
    workers: state.workers.map((worker) => worker.id === workerId ? {
      ...worker,
      stamina: attributes?.stamina ?? 1 + Math.floor(random() * 10),
      efficiency: attributes?.efficiency ?? 1 + Math.floor(random() * 10),
      spirit: attributes?.spirit ?? 1 + Math.floor(random() * 10),
    } : worker),
  };
}

export function sellProducts(
  state: GameState,
  kind: "rough" | "refined" | "all",
): GameState {
  const roughCount = kind === "refined" ? 0 : state.inventory.rough;
  const refinedCount = kind === "rough" ? 0 : state.inventory.refined;
  if (roughCount + refinedCount === 0) return state;
  return {
    ...state,
    coins: state.coins + roughCount * state.market.roughPrice + refinedCount * state.market.refinedPrice,
    inventory: {
      ...state.inventory,
      rough: state.inventory.rough - roughCount,
      refined: state.inventory.refined - refinedCount,
    },
  };
}

export function stepGame(
  state: GameState,
  seconds: number,
  random = Math.random,
): GameState {
  const dt = clamp(seconds, 0, 1);
  if (dt <= 0) return state;
  const inventory = { ...state.inventory };
  let market = { ...state.market, elapsed: state.market.elapsed + dt };
  if (market.elapsed >= 300) {
    market = {
      roughPrice: randomMarketPrice(10, random),
      refinedPrice: randomMarketPrice(30, random),
      elapsed: market.elapsed % 300,
    };
  }

  const processPlots = Object.fromEntries(
    Object.entries(state.processPlots).map(([id, value]) => [id, { ...value, batch: { ...value.batch } }]),
  );
  const schedulerSeconds = Math.max(0, state.schedulerSeconds - dt);
  const canOpenerSeconds = Math.max(0, state.canOpenerSeconds - dt);
  const canOpenerCooldown = Math.max(0, state.canOpenerCooldown - dt);
  const workers = state.workers.map((worker) => ({ ...worker }));
  const zoneTypes = new Map(state.plots.map((plot) => [plot.id, plot.type]));
  const workZones: ZoneType[] = ["gather", "process"];

  for (const worker of workers) {
    if (worker.status === "dragging") continue;
    const zoneType = worker.zoneId ? zoneTypes.get(worker.zoneId) : null;
    if (!worker.zoneId || !zoneType) {
      worker.status = "idle";
      worker.continuousWork = 0;
      worker.slowStacks = 0;
      worker.lazyElapsed = 0;
      continue;
    }
    if (zoneType === "living") {
      worker.continuousWork = 0;
      worker.slowStacks = 0;
      worker.lazyElapsed = 0;
      if (worker.mood >= 100) {
        worker.mood = 100;
        worker.status = "ready";
      } else if (inventory.cans > 0) {
        const rate = recoveryRate(worker.spirit) * (state.canOpenerSeconds > 0 ? 1.5 : 1);
        const desiredSeconds = Math.min(dt, (100 - worker.mood) / rate);
        const actualSeconds = Math.min(desiredSeconds, inventory.cans / .01);
        const canUse = .01 * actualSeconds;
        inventory.cans -= canUse;
        worker.mood = clamp(worker.mood + rate * actualSeconds, 0, 100);
        worker.status = worker.mood >= 100 ? "ready" : "resting";
      } else {
        worker.status = "waiting";
      }
      continue;
    }
    if (worker.mood <= 0) {
      worker.mood = 0;
      worker.status = "exhausted";
      continue;
    }
    if (workZones.includes(zoneType)) {
      worker.continuousWork += dt;
      if (worker.personality === "slowBurn") {
        worker.slowStacks = Math.floor(worker.continuousWork / 10);
      }
      if (worker.personality === "lazy" && worker.status !== "slacking") {
        worker.lazyElapsed += dt;
        if (worker.lazyElapsed >= 20) {
          worker.lazyElapsed %= 20;
          if (random() < .5) worker.status = "slacking";
        }
      }
    }
  }

  const gatherWorkers = workers.filter(
    (worker) => worker.zoneId && zoneTypes.get(worker.zoneId) === "gather" && worker.mood > 0 && worker.status !== "dragging",
  );
  const gatherLeaders = new Map<string, number>();
  for (const worker of gatherWorkers) {
    if (worker.zoneId && worker.personality === "leader") gatherLeaders.set(worker.zoneId, (gatherLeaders.get(worker.zoneId) ?? 0) + 1);
  }
  for (const worker of gatherWorkers) {
    const active = worker.status !== "slacking";
    worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100);
    if (active) {
      const rate = gatherAttributeRate(worker.efficiency) * personalityRate(worker, gatherLeaders.get(worker.zoneId!) ?? 0);
      inventory.raw += 10 * rate * dt;
      worker.status = worker.mood <= 0 ? "exhausted" : "gathering";
    } else {
      worker.status = worker.mood <= 0 ? "exhausted" : "slacking";
    }
  }

  const processWorkersByPlot = new Map<string, WorkerState[]>();
  for (const worker of workers) {
    if (!worker.zoneId || zoneTypes.get(worker.zoneId) !== "process" || worker.mood <= 0 || worker.status === "dragging") continue;
    const group = processWorkersByPlot.get(worker.zoneId);
    if (group) group.push(worker);
    else processWorkersByPlot.set(worker.zoneId, [worker]);
  }
  for (const plot of state.plots.filter((item) => item.type === "process")) {
    const plotState = processPlots[plot.id] ?? { recipe: "rough" as const, produced: 0, batch: { active: false, progress: 0, reservedRaw: 0 } };
    processPlots[plot.id] = plotState;
    const processWorkers = processWorkersByPlot.get(plot.id) ?? [];
    const leaderCount = processWorkers.filter((worker) => worker.personality === "leader").length;
    const activeProcessors = processWorkers.filter((worker) => worker.status !== "slacking");
    const recipe = RECIPES[plotState.recipe];
    if (!plotState.batch.active && activeProcessors.length > 0 && inventory.raw >= recipe.raw) {
      inventory.raw -= recipe.raw;
      plotState.batch = { active: true, progress: 0, reservedRaw: recipe.raw };
    }
    if (plotState.batch.active && activeProcessors.length > 0) {
      let contribution = 0;
      for (const worker of activeProcessors) {
        worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100);
        contribution += processAttributeRate(worker.efficiency) * personalityRate(worker, leaderCount);
        worker.status = worker.mood <= 0 ? "exhausted" : "processing";
      }
      for (const worker of processWorkers.filter((item) => item.status === "slacking")) {
        worker.mood = clamp(worker.mood - staminaDrainRate(worker.stamina) * dt, 0, 100);
        if (worker.mood <= 0) worker.status = "exhausted";
      }
      plotState.batch.progress += contribution * dt / recipe.seconds;
      while (plotState.batch.progress >= 1) {
        const overflow = plotState.batch.progress - 1;
        inventory[plotState.recipe] += 1;
        plotState.produced += 1;
        if (inventory.raw >= recipe.raw) {
          inventory.raw -= recipe.raw;
          plotState.batch = { active: true, progress: overflow, reservedRaw: recipe.raw };
        } else {
          plotState.batch = { active: false, progress: 0, reservedRaw: 0 };
        }
      }
    } else {
      for (const worker of processWorkers) {
        if (worker.status !== "slacking" && worker.status !== "exhausted") worker.status = "waiting";
      }
    }
  }

  return { ...state, inventory, workers, processPlots, market, schedulerSeconds, canOpenerSeconds, canOpenerCooldown };
}

export function parseSavedState(value: string | null): GameState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Omit<Partial<GameState>, "version"> & {
      version?: number;
      recipe?: RecipeId;
      recipeProduced?: number;
      batch?: ProcessPlotState["batch"];
    };
    if (
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) ||
      !Number.isFinite(parsed.coins) ||
      !Array.isArray(parsed.workers) ||
      !parsed.inventory ||
      !parsed.market ||
      (parsed.version === 3 && !parsed.processPlots) ||
      (parsed.version !== 3 && !parsed.batch)
    ) return null;
    const rawPlots = Array.isArray(parsed.plots) && parsed.plots.length
      ? parsed.plots
      : INITIAL_PLOTS.map((plot) => ({ ...plot }));
    const plots = rawPlots.map((plot) => ({
      ...plot,
      purchasePrice: Number.isFinite(plot.purchasePrice) && plot.purchasePrice > 0
        ? plot.purchasePrice
        : plotPurchasePrice(plot.cols),
    }));
    const zoneTypes = new Map(plots.map((plot) => [plot.id, plot.type]));
    const firstProcessId = plots.find((plot) => plot.type === "process")?.id;
    const processPlots = Object.fromEntries(plots
      .filter((plot) => plot.type === "process")
      .map((plot) => {
        const saved = parsed.processPlots?.[plot.id];
        const migrated = plot.id === firstProcessId && parsed.version !== 3 ? {
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
    const schedulerBots = Number.isFinite(parsed.schedulerBots) ? Math.max(1, Math.floor(parsed.schedulerBots)) : 1;
    const schedulerRobots = Array.from({ length: schedulerBots }, (_, index) => {
      const saved = Array.isArray(parsed.schedulerRobots) ? parsed.schedulerRobots[index] : null;
      return {
        efficiency: saved && Number.isFinite(saved.efficiency) ? Math.max(1, saved.efficiency) : 1,
        intervalSeconds: saved && Number.isFinite(saved.intervalSeconds) ? clamp(saved.intervalSeconds, .1, 3) : 3,
        duties: {
          rest: saved?.duties?.rest ?? true,
          work: saved?.duties?.work ?? true,
          wake: saved?.duties?.wake ?? true,
        },
      };
    });
    return {
      ...(parsed as GameState),
      version: 3,
      plots,
      processPlots,
      schedulerSeconds: Number.isFinite(parsed.schedulerSeconds) ? parsed.schedulerSeconds : 0,
      schedulerBots,
      schedulerRobots,
      canOpenerSeconds: Number.isFinite(parsed.canOpenerSeconds) ? Math.max(0, parsed.canOpenerSeconds) : 0,
      canOpenerCooldown: Number.isFinite(parsed.canOpenerCooldown) ? Math.max(0, parsed.canOpenerCooldown) : 0,
      inventory: {
        ...parsed.inventory,
        potions: Number.isFinite(parsed.inventory.potions) ? parsed.inventory.potions : 0,
      },
      market: {
        ...parsed.market!,
        roughPrice: Math.round(parsed.market.roughPrice),
        refinedPrice: Math.round(parsed.market.refinedPrice),
      },
      workers: parsed.workers.map((worker) => {
        const { moving: _moving, motion: _motion, ...rest } = worker as WorkerState & { moving?: boolean; motion?: string };
        return {
          ...rest,
          lastWorkZoneId: worker.lastWorkZoneId ?? null,
          ...(worker.status === "dragging" ? {
            status: worker.zoneId && zoneTypes.get(worker.zoneId) === "living"
              ? (worker.mood >= 100 ? "ready" : "resting")
              : worker.mood <= 0
                ? "exhausted"
                : "idle",
          } : {}),
        };
      }),
    };
  } catch {
    return null;
  }
}
