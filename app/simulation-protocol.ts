import { stepGame } from "./game-engine.ts";
import type { GameState } from "./game-engine.ts";
import { createResourceActivity, recordResourceChange } from "./resource-activity.ts";
import type { ResourceActivity, ResourceKind } from "./resource-activity.ts";

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
  activity: ResourceActivity;
  seconds: number;
  simulationMs?: number;
};

export type SimulationResult = { state: GameState; activity: ResourceActivity };

export function simulateElapsed(
  state: GameState,
  seconds: number,
  random = Math.random,
  onResourceChange?: (kind: ResourceKind, delta: number) => void,
) {
  let next = state;
  let remaining = Math.max(0, Math.min(5, seconds));
  while (remaining > 0) {
    const dt = Math.min(1, remaining);
    next = stepGame(next, dt, random, onResourceChange);
    remaining -= dt;
  }
  return next;
}

export function simulateElapsedWithActivity(
  state: GameState,
  seconds: number,
  random = Math.random,
): SimulationResult {
  const activity = createResourceActivity();
  const next = simulateElapsed(state, seconds, random, (kind, delta) => recordResourceChange(activity, kind, delta));
  return { state: next, activity };
}

function onlyVisualChanges(base: GameState, current: GameState) {
  return sameFieldsExcept(base, current, WORKERS_FIELD)
    && base.workers.length === current.workers.length
    && base.workers.every((worker, index) => sameFieldsExcept(worker, current.workers[index], VISUAL_WORKER_FIELDS));
}

function preserveWorkerMovement(current: GameState, result: GameState): GameState {
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

export function reconcileSimulation(
  base: GameState,
  current: GameState,
  result: GameState,
  seconds: number,
  random = Math.random,
): GameState {
  if (current === base) return result;
  if (!onlyVisualChanges(base, current)) {
    // A purchase, recipe change or worker transfer invalidates the old result.
    // Recompute immediately instead of leaving production idle until the next tick.
    return simulateElapsed(current, seconds, random);
  }
  return preserveWorkerMovement(current, result);
}

export function reconcileSimulationWithActivity(
  base: GameState,
  current: GameState,
  result: SimulationResult,
  seconds: number,
  random = Math.random,
): SimulationResult {
  if (current === base) return result;
  if (!onlyVisualChanges(base, current)) {
    // Discard the stale receipts along with the stale state. Only the recomputed
    // simulation's actual resource changes belong to the committed result.
    return simulateElapsedWithActivity(current, seconds, random);
  }
  return { state: preserveWorkerMovement(current, result.state), activity: result.activity };
}
