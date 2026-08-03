import { stepGame } from "./game-engine.ts";
import type { GameState } from "./game-engine.ts";

export type SimulationStepRequest = {
  type: "step";
  id: number;
  state: GameState;
  seconds: number;
};

export type SimulationStepResponse = {
  type: "stepped";
  id: number;
  state: GameState;
  seconds: number;
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
