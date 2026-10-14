import {
  createInitialState,
  createInitialWorker,
  type GameState,
  type PlotState,
  type WorkerState,
} from "../../app/game-engine.ts";

const PREVIEW_PLOTS: PlotState[] = [
  { id: "gather", type: "gather", name: "采集区", x: 792, y: 264, cols: 4, rows: 4, purchasePrice: 300, enabled: true },
  { id: "process", type: "process", name: "加工区", x: 1042, y: 414, cols: 4, rows: 4, purchasePrice: 300, enabled: true },
  { id: "synthesis", type: "synthesis", name: "合成区", x: 792, y: 564, cols: 4, rows: 4, purchasePrice: 300, enabled: true },
  { id: "living", type: "living", name: "生活区", x: 542, y: 414, cols: 4, rows: 4, purchasePrice: 300, enabled: true },
];

function previewWorker(
  id: string,
  name: string,
  plot: PlotState,
  u: number,
  v: number,
  overrides: Partial<WorkerState> = {},
): WorkerState {
  const x = plot.x + (u - v) * 52 + plot.rows * 52;
  const y = plot.y + (u + v) * 27;
  return {
    ...createInitialWorker(x, y),
    id,
    name,
    zoneId: plot.id,
    u,
    v,
    status: plot.type === "gather"
      ? "gathering"
      : plot.type === "process"
        ? "processing"
        : plot.type === "synthesis"
          ? "synthesizing"
          : "resting",
    lastWorkZoneId: plot.type === "living" ? null : plot.id,
    ...overrides,
  };
}

/** An isolated, supplied workshop for the appearance preview; never saved as the player's game. */
export function createForemanPreviewState(): GameState {
  const plots = PREVIEW_PLOTS.map((plot) => ({ ...plot }));
  const [gather, process, synthesis, living] = plots;
  const state = createInitialState(1000, 540);

  return {
    ...state,
    rebirthCount: 1,
    coins: 360,
    inventory: {
      ...state.inventory,
      raw: 24_000,
      rough: 320,
      refined: 160,
      screws: 80,
      rebar: 20,
      cans: 600,
    },
    plots,
    workers: [
      previewWorker("foreman-1", "包工头", process, 3.1, 2.7, { role: "foreman", personality: "leader" }),
      previewWorker("preview-worker-1", "小人 1", gather, 1.1, 1.3),
      previewWorker("preview-worker-2", "小人 2", gather, 2.9, 2.4, { facing: "left", personality: "leader", mood: 84 }),
      previewWorker("preview-worker-3", "小人 3", process, 1, 1.1, { mood: 90 }),
      previewWorker("preview-worker-4", "小人 4", process, 3.1, 1.3, { facing: "left", mood: 78 }),
      previewWorker("preview-worker-5", "小人 5", synthesis, 1.2, 1.4, { mood: 89 }),
      previewWorker("preview-worker-6", "小人 6", synthesis, 2.7, 2.5, { facing: "left", mood: 71 }),
      previewWorker("preview-worker-7", "小人 7", living, 1.1, 1.6, { mood: 35 }),
    ],
    processPlots: {
      process: { recipe: "rough", produced: 0, batch: { active: true, progress: 0.3, reservedRaw: 75 } },
    },
    synthesisPlots: {
      synthesis: { recipe: "cans", produced: 0, batch: { active: true, progress: 0.2, reserved: { rough: 1, refined: 1 } } },
    },
    schedulerSeconds: 3600,
    schedulerBots: 2,
    schedulerRobots: [
      { efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } },
      { efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } },
    ],
    schedulerServiceUnlocked: true,
    research: { ...state.research, synthesis: 1, orders: 0 },
  };
}
