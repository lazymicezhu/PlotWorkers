import type { GameState } from "./game-engine.ts";
import { completeFirstRebirth } from "./rebirth.ts";

type RebirthPersistence = {
  backup: (previous: GameState) => void;
  save: (next: GameState) => void;
};

/** Return the replacement world only after both durable writes succeed. */
export function saveFirstRebirth(state: GameState, persistence: RebirthPersistence): GameState | null {
  const next = completeFirstRebirth(state);
  if (!next) return null;
  persistence.backup(state);
  persistence.save(next);
  return next;
}
