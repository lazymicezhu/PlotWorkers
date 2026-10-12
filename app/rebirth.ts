import {
  INITIAL_PLOTS,
  createInitialState,
  createInitialWorker,
  isForeman,
  type GameState,
  type PlotState,
} from "./game-engine.ts";
import { saveValuation } from "./save-valuation.ts";

export const FIRST_REBIRTH_ASSET_REQUIREMENT = 5_000_000;

function project(plot: PlotState, u: number, v: number) {
  return {
    x: plot.x + (u - v) * 52 + plot.rows * 52,
    y: plot.y + (u + v) * 27,
  };
}

/** Total owned assets unlock the first rebirth, whose reward can be granted once. */
export function canFirstRebirth(state: GameState): boolean {
  return state.rebirthCount === 0
    && !state.workers.some(isForeman)
    && saveValuation(state).total >= FIRST_REBIRTH_ASSET_REQUIREMENT;
}

/** Commit only after the player accepts the reward; never mutate the old game. */
export function completeFirstRebirth(state: GameState): GameState | null {
  if (!canFirstRebirth(state)) return null;
  const living = INITIAL_PLOTS.find((plot) => plot.id === "living")!;
  const initialPoint = project(living, 2, 2);
  const fresh = createInitialState(initialPoint.x, initialPoint.y);
  const gather = fresh.plots.find((plot) => plot.id === "gather")!;
  const u = 5.2;
  const v = 3.8;
  const point = project(gather, u, v);
  fresh.rebirthCount = 1;
  fresh.workers.push({
    ...createInitialWorker(point.x, point.y),
    id: "foreman-1",
    name: "包工头",
    role: "foreman",
    personality: "leader",
    zoneId: gather.id,
    status: "gathering",
    u,
    v,
    lastWorkZoneId: gather.id,
  });
  return fresh;
}
