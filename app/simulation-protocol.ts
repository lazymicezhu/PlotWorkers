import { stepGame } from "./game-engine.ts";
import type { GameState } from "./game-engine.ts";

const VISUAL_WORKER_FIELDS = new Set(["u", "v", "x", "y", "duration", "facing"]);
const WORKERS_FIELD = new Set(["workers"]);

function sameFieldsExcept<T extends object>(base: T, current: T, ignored: ReadonlySet<string>) {
  if (base === current) return true;
  const keys = Object.keys(base) as (keyof T & string)[];
  return keys.length === Object.keys(current).length && keys.every((key) =>
    ignored.has(key) || (Object.hasOwn(current, key) && Object.is(base[key], current[key]))
  );
}

export type SimulationStepRequest = {
  type: "step";
  id: number;
  state: GameState;
  seconds: number;
  measurePerformance?: boolean;
};

export type SimulationStepResponse = {
  type: "stepped";
  id: number;
  state: GameState;
  seconds: number;
  simulationMs?: number;
};

export function simulateElapsed(
  state: GameState,
  seconds: number,
  random = Math.random,
) {
  let next = state;
  let remaining = Math.max(0, Math.min(5, seconds));
  while (remaining > 0) {
    const dt = Math.min(1, remaining);
    next = stepGame(next, dt, random);
    remaining -= dt;
  }
  return next;
}

export function reconcileSimulation(
  base: GameState,
  current: GameState,
  result: GameState,
  seconds: number,
  random = Math.random,
): GameState {
  if (current === base) return result;
  const onlyVisualChanges = sameFieldsExcept(base, current, WORKERS_FIELD)
    && base.workers.length === current.workers.length
    && base.workers.every((worker, index) => sameFieldsExcept(worker, current.workers[index], VISUAL_WORKER_FIELDS));
  if (!onlyVisualChanges) {
    // A purchase, recipe change or worker transfer invalidates the old result.
    // Recompute immediately instead of leaving production idle until the next tick.
    return simulateElapsed(current, seconds, random);
  }
  // Walking does not affect production. Preserve its latest destination while
  // keeping every economic and worker-status change computed in the background.
  const currentWorkers = new Map(current.workers.map((worker) => [worker.id, worker]));
  return {
    ...result,
    workers: result.workers.map((worker) => {
      const latest = currentWorkers.get(worker.id);
      return latest ? {
        ...worker,
        u: latest.u,
        v: latest.v,
        x: latest.x,
        y: latest.y,
        duration: latest.duration,
        facing: latest.facing,
      } : worker;
    }),
  };
}
