import type { GameState } from "./game-engine.ts";

export const resourceKinds = ["coins", "raw", "cans", "rough", "refined", "screws", "rebar"] as const;
export type ResourceKind = typeof resourceKinds[number];
export type ResourceActivity = Record<ResourceKind, { gained: number; spent: number }>;

export function createResourceActivity(): ResourceActivity {
  return Object.fromEntries(resourceKinds.map((kind) => [kind, { gained: 0, spent: 0 }])) as ResourceActivity;
}

export function recordResourceChange(activity: ResourceActivity, kind: ResourceKind, delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;
  activity[kind][delta > 0 ? "gained" : "spent"] += Math.abs(delta);
}

export function addResourceActivity(a: ResourceActivity, b: ResourceActivity): ResourceActivity {
  const next = createResourceActivity();
  for (const kind of resourceKinds) {
    next[kind].gained = a[kind].gained + b[kind].gained;
    next[kind].spent = a[kind].spent + b[kind].spent;
  }
  return next;
}

/** Used for discrete player actions; simulation records its individual transactions. */
export function resourceActivityBetween(before: GameState, after: GameState): ResourceActivity {
  const activity = createResourceActivity();
  for (const kind of resourceKinds) {
    const delta = kind === "coins" ? after.coins - before.coins : after.inventory[kind] - before.inventory[kind];
    recordResourceChange(activity, kind, delta);
  }
  return activity;
}

/** Activity stays outside the saved game, and advances atomically with its balances. */
export type GameView = { game: GameState; activity: ResourceActivity };
export function createGameView(game: GameState): GameView {
  return { game, activity: createResourceActivity() };
}
export function updateGameView(view: GameView, game: GameState, activity = resourceActivityBetween(view.game, game)): GameView {
  if (view.game === game) return view;
  return { game, activity: addResourceActivity(view.activity, activity) };
}
