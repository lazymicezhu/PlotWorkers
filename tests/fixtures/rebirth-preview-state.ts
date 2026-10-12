import { type GameState } from "../../app/game-engine.ts";
import { createForemanPreviewState } from "./foreman-preview-state.ts";
import { completeFirstRebirth } from "../../app/rebirth.ts";
import { saveValuation } from "../../app/save-valuation.ts";

export { FIRST_REBIRTH_ASSET_REQUIREMENT, canFirstRebirth } from "../../app/rebirth.ts";

/** A supplied, in-memory workshop for trying the first-rebirth flow. */
export function createRebirthPreviewState(): GameState {
  const state = createForemanPreviewState();
  state.workers = state.workers.filter((worker) => worker.role !== "foreman");
  state.rebirthCount = 0;
  state.coins += 5_200_000 - saveValuation(state).total;
  return state;
}

/** The preview uses the same reset and reward rules as the formal game. */
export function createRebornPreviewState(): GameState {
  return completeFirstRebirth(createRebirthPreviewState())!;
}
