import assert from "node:assert/strict";
import test from "node:test";
import { buyCans, createInitialState } from "../app/game-engine.ts";
import { exportGameSave, parseGameSave } from "../app/save-file.ts";
import {
  addResourceActivity, createGameView, createResourceActivity,
  resourceActivityBetween, resourceKinds, updateGameView,
} from "../app/resource-activity.ts";

const fresh = () => createInitialState(100, 200);

test("buying cans records both paid coins and received cans without changing the old view", () => {
  const game = fresh();
  const view = createGameView(game);
  const original = structuredClone(view);
  const purchased = buyCans(game, 10);
  const activity = resourceActivityBetween(game, purchased);

  assert.deepEqual(activity.coins, { gained: 0, spent: 20 });
  assert.deepEqual(activity.cans, { gained: 10, spent: 0 });
  for (const kind of resourceKinds.filter((kind) => kind !== "coins" && kind !== "cans")) {
    assert.deepEqual(activity[kind], { gained: 0, spent: 0 });
  }

  const next = updateGameView(view, purchased);
  assert.equal(next.game, purchased);
  assert.equal(next.game.coins, 80);
  assert.equal(next.game.inventory.cans, 30);
  assert.deepEqual(next.activity, activity);
  assert.deepEqual(view, original);
  assert.equal(view.game, game);
});

test("successive player purchases accumulate activity while unsuccessful purchases preserve the view", () => {
  const start = createGameView(fresh());
  const first = updateGameView(start, buyCans(start.game, 10));
  const original = structuredClone(first);
  const second = updateGameView(first, buyCans(first.game, 5));

  assert.deepEqual(second.activity.coins, { gained: 0, spent: 30 });
  assert.deepEqual(second.activity.cans, { gained: 15, spent: 0 });
  assert.deepEqual(first, original);
  assert.equal(updateGameView(second, buyCans(second.game, 100)), second);
});

test("worker and plot movement update the game without inventing resource activity", () => {
  const initial = createGameView(fresh());
  const view = updateGameView(initial, buyCans(initial.game, 10));
  const original = structuredClone(view);
  const moved = {
    ...view.game,
    workers: view.game.workers.map((worker) => ({ ...worker, x: worker.x + 20, y: worker.y - 30 })),
    plots: view.game.plots.map((plot) => ({ ...plot, x: plot.x + 50, y: plot.y + 10 })),
  };

  assert.deepEqual(resourceActivityBetween(view.game, moved), createResourceActivity());
  const next = updateGameView(view, moved);
  assert.equal(next.game, moved);
  assert.deepEqual(next.activity, view.activity);
  assert.deepEqual(view, original);
});

test("explicit simulation activity retains gains and spending within the same tick", () => {
  const game = fresh();
  game.inventory.raw = 100;
  const initial = createGameView(game);
  const view = updateGameView(initial, buyCans(game, 10));
  const original = structuredClone(view);
  const simulated = {
    ...view.game,
    inventory: { ...view.game.inventory, raw: 110 },
  };
  const activity = createResourceActivity();
  activity.raw = { gained: 30, spent: 20 };
  activity.cans = { gained: 4, spent: 4 };
  const originalActivity = structuredClone(activity);

  const net = resourceActivityBetween(view.game, simulated);
  assert.deepEqual(net.raw, { gained: 10, spent: 0 });
  assert.deepEqual(net.cans, { gained: 0, spent: 0 });
  const next = updateGameView(view, simulated, activity);
  assert.deepEqual(next.activity.raw, { gained: 30, spent: 20 });
  assert.deepEqual(next.activity.cans, { gained: 14, spent: 4 });
  assert.deepEqual(next.activity.coins, { gained: 0, spent: 20 });
  assert.equal(next.game.inventory.raw, 110);
  assert.equal(next.game.inventory.cans, view.game.inventory.cans);
  assert.deepEqual(view, original);
  assert.deepEqual(activity, originalActivity);
});

test("adding activity preserves separate totals and owns independent resource records", () => {
  const first = createResourceActivity();
  const second = createResourceActivity();
  first.coins = { gained: 50, spent: 20 };
  second.coins = { gained: 10, spent: 40 };
  first.cans.spent = 0.25;
  second.cans.gained = 0.5;
  const originals = structuredClone([first, second]);

  const combined = addResourceActivity(first, second);
  assert.deepEqual(combined.coins, { gained: 60, spent: 60 });
  assert.deepEqual(combined.cans, { gained: 0.5, spent: 0.25 });
  for (const kind of resourceKinds) {
    assert.notEqual(combined[kind], first[kind]);
    assert.notEqual(combined[kind], second[kind]);
  }
  combined.raw.gained = 99;
  assert.deepEqual([first, second], originals);
});

test("import starts a fresh activity baseline and exported games contain no HUD activity", () => {
  const initial = createGameView(fresh());
  const view = updateGameView(initial, buyCans(initial.game, 10));
  assert.equal(view.activity.cans.gained, 10);

  const exported = exportGameSave(view.game, new Date("2026-10-13T00:00:00.000Z"));
  const saved = JSON.parse(exported);
  assert.equal(Object.hasOwn(view.game, "activity"), false);
  assert.equal(Object.hasOwn(saved, "activity"), false);
  assert.equal(Object.hasOwn(saved.state, "activity"), false);
  assert.doesNotMatch(exported, /"activity"|"gained"|"spent"/);

  const imported = parseGameSave(exported).state;
  const next = createGameView(imported);
  assert.equal(next.game, imported);
  assert.deepEqual(next.game, view.game);
  assert.deepEqual(next.activity, createResourceActivity());
  next.activity.coins.spent = 1;
  assert.equal(view.activity.coins.spent, 20);
  assert.deepEqual(createGameView(imported).activity, createResourceActivity());
});
