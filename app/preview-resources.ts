import type { GameState } from "./game-engine.ts";

type PreviewLocation = Pick<Location, "protocol" | "hostname" | "port">;

export const PREVIEW_RESOURCE_FLOOR = 1_000_000_000_000;
export const PREVIEW_SCHEDULER_SECONDS = 1_000_000_000;

const materialKinds = ["raw", "cans", "rough", "refined", "screws", "rebar"] as const;
const specialKinds = ["canOpener", "smartLeader", "holyLight"] as const;

function browserLocation(): PreviewLocation | null {
  return typeof window === "undefined" ? null : window.location;
}

/** This local preview address alone gets the resource sandbox. */
export function isInfiniteResourcePreview(location: PreviewLocation | null = browserLocation()): boolean {
  return location?.protocol === "http:" && location.hostname === "127.0.0.1" && location.port === "49224";
}

/** Keep the preview's progress and backups separate from normal game saves. */
export function previewStorageKey(key: string, location: PreviewLocation | null = browserLocation()): string {
  return isInfiniteResourcePreview(location) ? `${key}-infinite-preview` : key;
}

/** Finite reserves remain JSON-safe and are replenished after every preview change. */
export function replenishPreviewResources(state: GameState): GameState {
  const needsMaterials = materialKinds.some((kind) => state.inventory[kind] < PREVIEW_RESOURCE_FLOOR);
  const needsSpecials = specialKinds.some((kind) => state.inventory.specials[kind] < PREVIEW_RESOURCE_FLOOR);
  const needsCoins = state.coins < PREVIEW_RESOURCE_FLOOR;
  const needsScheduler = state.schedulerSeconds < PREVIEW_SCHEDULER_SECONDS || !state.schedulerServiceUnlocked;
  if (!needsMaterials && !needsSpecials && !needsCoins && !needsScheduler) return state;

  let inventory = state.inventory;
  if (needsMaterials || needsSpecials) {
    inventory = { ...inventory };
    for (const kind of materialKinds) inventory[kind] = Math.max(inventory[kind], PREVIEW_RESOURCE_FLOOR);
    if (needsSpecials) {
      inventory.specials = { ...inventory.specials };
      for (const kind of specialKinds) inventory.specials[kind] = Math.max(inventory.specials[kind], PREVIEW_RESOURCE_FLOOR);
    }
  }

  return {
    ...state,
    coins: Math.max(state.coins, PREVIEW_RESOURCE_FLOOR),
    inventory,
    schedulerSeconds: Math.max(state.schedulerSeconds, PREVIEW_SCHEDULER_SECONDS),
    schedulerServiceUnlocked: true,
  };
}
