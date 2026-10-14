import { SPECIAL_ITEM_IDS, type GameState } from "./game-engine.ts";

type PreviewLocation = Pick<Location, "protocol" | "hostname" | "port" | "search">;

export const PREVIEW_RESOURCE_FLOOR = 1_000_000_000_000;
export const PREVIEW_SCHEDULER_SECONDS = 1_000_000_000;

const materialKinds = ["raw", "cans", "rough", "refined", "screws", "rebar"] as const;

function browserLocation(): PreviewLocation | null {
  return typeof window === "undefined" ? null : window.location;
}

/** Resource test modes are available only at this isolated local preview address. */
export function isLocalResourcePreview(location: PreviewLocation | null = browserLocation()): boolean {
  return location?.protocol === "http:" && location.hostname === "127.0.0.1" && location.port === "49224";
}

/** Finite resources are the default; replenishment requires an explicit URL option. */
export function isInfiniteResourcePreview(location: PreviewLocation | null = browserLocation()): boolean {
  return isLocalResourcePreview(location) && new URLSearchParams(location!.search).get("resources") === "infinite";
}

/** Keep both local test modes and their backups separate from normal game saves. */
export function previewStorageKey(key: string, location: PreviewLocation | null = browserLocation()): string {
  if (!isLocalResourcePreview(location)) return key;
  return `${key}-${isInfiniteResourcePreview(location) ? "infinite" : "finite"}-preview`;
}

/** Issue this test pack once, without changing the workshop or its finite supplies. */
export function grantPreviewTestItems(
  state: GameState,
  storage: Pick<Storage, "getItem" | "setItem">,
  saveKey: string,
  location: PreviewLocation | null = browserLocation(),
): GameState {
  if (!isLocalResourcePreview(location) || isInfiniteResourcePreview(location)) return state;
  const grantKey = `${saveKey}-special-items-20-20261014`;
  if (storage.getItem(grantKey) !== null) return state;

  const specials = { ...state.inventory.specials };
  for (const kind of SPECIAL_ITEM_IDS) specials[kind] += 20;
  const granted = { ...state, inventory: { ...state.inventory, specials } };
  const originalSave = storage.getItem(saveKey) ?? JSON.stringify(state);
  storage.setItem(saveKey, JSON.stringify(granted));
  try {
    storage.setItem(grantKey, "1");
  } catch (error) {
    try {
      storage.setItem(saveKey, originalSave);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Unable to record or roll back preview test items");
    }
    throw error;
  }
  return granted;
}

/** One-time conversion: keep the workshop, but let goods and supplies run normally. */
export function createFinitePreviewState(state: GameState): GameState {
  const specials = { ...state.inventory.specials };
  for (const kind of SPECIAL_ITEM_IDS) {
    if (specials[kind] >= PREVIEW_RESOURCE_FLOOR) specials[kind] = 0;
  }
  return {
    ...state,
    coins: Math.min(state.coins, 100_000),
    schedulerSeconds: Math.min(state.schedulerSeconds, 1_800),
    inventory: {
      ...state.inventory,
      raw: Math.min(state.inventory.raw, 10_000),
      cans: Math.min(state.inventory.cans, 1_000),
      rough: 0,
      refined: 0,
      screws: 0,
      rebar: 0,
      specials,
    },
  };
}

/** Finite reserves remain JSON-safe and are replenished after every preview change. */
export function replenishPreviewResources(state: GameState): GameState {
  const needsMaterials = materialKinds.some((kind) => state.inventory[kind] < PREVIEW_RESOURCE_FLOOR);
  const needsSpecials = SPECIAL_ITEM_IDS.some((kind) => state.inventory.specials[kind] < PREVIEW_RESOURCE_FLOOR);
  const needsCoins = state.coins < PREVIEW_RESOURCE_FLOOR;
  const needsScheduler = state.schedulerSeconds < PREVIEW_SCHEDULER_SECONDS || !state.schedulerServiceUnlocked;
  if (!needsMaterials && !needsSpecials && !needsCoins && !needsScheduler) return state;

  let inventory = state.inventory;
  if (needsMaterials || needsSpecials) {
    inventory = { ...inventory };
    for (const kind of materialKinds) inventory[kind] = Math.max(inventory[kind], PREVIEW_RESOURCE_FLOOR);
    if (needsSpecials) {
      inventory.specials = { ...inventory.specials };
      for (const kind of SPECIAL_ITEM_IDS) inventory.specials[kind] = Math.max(inventory.specials[kind], PREVIEW_RESOURCE_FLOOR);
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
