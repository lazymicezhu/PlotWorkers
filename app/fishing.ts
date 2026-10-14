import type { PlotState, WorkerState } from "./game-engine.ts";

export const FISHING_CYCLE_SECONDS = 60;
export const CYCLE_DURATION = FISHING_CYCLE_SECONDS;
export const FISHING_SEATS = ["left", "back", "right"] as const;
export type FishingSeat = typeof FISHING_SEATS[number];
export type FishingSeatId = FishingSeat;
export const PHASES = [
  { id: "cast", start: 0, end: 2.4 },
  { id: "idle", start: 2.4, end: 53 },
  { id: "tug", start: 53, end: 55 },
  { id: "catch", start: 55, end: 58 },
  { id: "recover", start: 58, end: 60 },
] as const;
export type FishingPhase = typeof PHASES[number]["id"];
export const LOOT_ITEMS = [
  { id: "rough", name: "粗加工", kind: "product", probability: .094 },
  { id: "refined", name: "精加工", kind: "product", probability: .094 },
  { id: "screws", name: "螺丝", kind: "product", probability: .094 },
  { id: "rebar", name: "钢筋", kind: "product", probability: .094 },
  { id: "cans", name: "罐头", kind: "product", probability: .094 },
  { id: "canOpener", name: "罐头起子", kind: "special", probability: .005 },
  { id: "smartLeader", name: "智械领袖", kind: "special", probability: .005 },
  { id: "holyLight", name: "圣光洗礼", kind: "special", probability: .005 },
  { id: "orderRefresh", name: "订单刷新券", kind: "special", probability: .005 },
  { id: "goldenOrder", name: "黄金卷", kind: "gold", probability: .01 },
] as const;
export type FishingItemId = typeof LOOT_ITEMS[number]["id"];
export type FishingOutcome = { itemId: FishingItemId | null; kind: "empty" | "product" | "special" | "gold"; quantity: 0 | 1 };
export type FishingProgress = { seat: FishingSeat; elapsed: number; cycle: number; seed: number; outcome: FishingOutcome };
export type FishingHistoryEntry = FishingOutcome & { id: number; caughtAt: number };
export type FishingPlotState = { history: FishingHistoryEntry[]; nextCatchId: number };
export const FISHING_SPRITE_LAYOUT = {
  left: { hip: [278, 444], scale: .80, float: [438, 445], order: 2 },
  back: { hip: [737, 232], scale: .76, float: [873, 356], order: 1 },
  right: { hip: [1304, 397], scale: .80, float: [1160, 467], order: 3 },
} as const;

/** Match the photographed top's four corners to the ordinary plot diamond. */
export function fishingSurfaceLayout(plot: Pick<PlotState, "cols" | "rows">) {
  const width = plot.cols * 104;
  const height = plot.rows * 54;
  const a = width / 1460;
  const upperY = height / 2 / 427;
  const lowerY = height / 2 / 428;
  // The source's front corner is ten pixels left of its back corner. Splitting
  // at the left/right corners corrects that small skew without moving the rim.
  const shear = 10 * a / 428;
  return {
    width,
    height,
    upper: [a, 0, 0, upperY, -38 * a, -26 * upperY] as const,
    lower: [a, 0, shear, lowerY, -38 * a - 453 * shear, height / 2 - 453 * lowerY] as const,
  };
}

/** Seat anchors are on the back half, sharing the top surface's transform. */
export function fishingImageLayout(plot: Pick<PlotState, "x" | "y" | "cols" | "rows">) {
  const scaleX = (plot.cols + plot.rows) * 52 / 1460;
  const scaleY = (plot.cols + plot.rows) * 27 / 854;
  return { left: plot.x - 38 * scaleX, top: plot.y - 26 * scaleY, width: 1536 * scaleX, height: 1024 * scaleY, scaleX, scaleY };
}

export function fishingSeatPoint(plot: Pick<PlotState, "x" | "y" | "cols" | "rows">, seat: FishingSeat) {
  const image = fishingImageLayout(plot);
  const hip = FISHING_SPRITE_LAYOUT[seat].hip;
  const x = image.left + hip[0] * image.scaleX;
  const y = image.top + hip[1] * image.scaleY;
  const localX = x - plot.x - plot.rows * 52;
  const localY = y - plot.y;
  return { x, y, u: localY / 54 + localX / 104, v: localY / 54 - localX / 104 };
}

/** Include the front sidewall, while leaving neighbouring ground droppable. */
export function pointInFishingPlot(plot: PlotState, point: { x: number; y: number }) {
  const halfWidth = (plot.cols + plot.rows) * 26;
  const halfHeight = (plot.cols + plot.rows) * 13.5;
  const dx = Math.abs(point.x - (plot.x + halfWidth)) / halfWidth;
  const dy = point.y - (plot.y + halfHeight);
  return dx <= 1 && (dy < 0 ? dx - dy / halfHeight <= 1 : dx + Math.max(0, dy - 38) / halfHeight <= 1);
}
export const isPointInFishingPlot = pointInFishingPlot;

export function nearestFishingSeat(plot: PlotState, point: { x: number; y: number }, workers: readonly WorkerState[], workerId: string): FishingSeat | null {
  const occupied = new Set(workers.filter((worker) => worker.id !== workerId && worker.zoneId === plot.id).map((worker) => worker.fishing?.seat));
  return FISHING_SEATS.filter((seat) => !occupied.has(seat)).sort((a, b) => {
    const pa = fishingSeatPoint(plot, a), pb = fishingSeatPoint(plot, b);
    return Math.hypot(point.x - pa.x, point.y - pa.y) - Math.hypot(point.x - pb.x, point.y - pb.y);
  })[0] ?? null;
}

export function fishingPhase(elapsed: number) {
  const phase = PHASES.find((entry) => elapsed < entry.end) ?? PHASES[PHASES.length - 1];
  return { phase: phase.id, progress: Math.max(0, Math.min(1, (elapsed - phase.start) / (phase.end - phase.start))) };
}

export function rollFishingOutcome(roll: number): FishingOutcome {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("Fishing roll must be in [0, 1)");
  const thresholds = [.094, .188, .282, .376, .47, .97, .975, .98, .985, .99, 1];
  const index = thresholds.findIndex((threshold) => roll < threshold);
  if (index === 5) return { itemId: null, kind: "empty", quantity: 0 };
  const item = LOOT_ITEMS[index < 5 ? index : index - 1];
  return { itemId: item.id, kind: item.kind, quantity: 1 };
}

function mix32(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

export function fishingOutcomeAt(seed: number, cycle: number) {
  return rollFishingOutcome(mix32(seed ^ Math.imul(cycle >>> 0, 0x9e3779b9) ^ Math.imul(Math.floor(cycle / 0x1_0000_0000), 0x85ebca6b)) / 0x1_0000_0000);
}

export function createFishingProgress(seat: FishingSeat, random = Math.random): FishingProgress {
  const seed = Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) * 0x1_0000_0000) >>> 0;
  return { seat, elapsed: 0, cycle: 0, seed, outcome: fishingOutcomeAt(seed, 0) };
}

export function createFishingPlotState(): FishingPlotState { return { history: [], nextCatchId: 1 }; }

export function isValidFishingOutcome(value: unknown): value is FishingOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const outcome = value as FishingOutcome;
  if (outcome.kind === "empty") return outcome.itemId === null && outcome.quantity === 0;
  const item = LOOT_ITEMS.find((entry) => entry.id === outcome.itemId);
  return Boolean(item && item.kind === outcome.kind && outcome.quantity === 1);
}

export function isValidFishingProgress(value: unknown): value is FishingProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as FishingProgress;
  if (!(FISHING_SEATS.includes(progress.seat) && Number.isFinite(progress.elapsed) && progress.elapsed >= 0 && progress.elapsed < 60
    && Number.isSafeInteger(progress.cycle) && progress.cycle >= 0 && progress.cycle < Number.MAX_SAFE_INTEGER
    && Number.isSafeInteger(progress.seed) && progress.seed >= 0 && progress.seed <= 0xffff_ffff && isValidFishingOutcome(progress.outcome))) return false;
  const expected = fishingOutcomeAt(progress.seed, progress.cycle);
  return expected.itemId === progress.outcome.itemId && expected.kind === progress.outcome.kind && expected.quantity === progress.outcome.quantity;
}

export function isValidFishingPlotState(value: unknown): value is FishingPlotState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plot = value as FishingPlotState;
  if (!Array.isArray(plot.history) || plot.history.length > 20 || !Number.isSafeInteger(plot.nextCatchId) || plot.nextCatchId < 1) return false;
  let previousId = 0;
  for (const entry of plot.history) {
    if (!isValidFishingOutcome(entry) || !Number.isSafeInteger(entry.id) || entry.id <= previousId || entry.id >= plot.nextCatchId
      || !Number.isFinite(entry.caughtAt) || entry.caughtAt < 0 || entry.caughtAt > 8.64e15) return false;
    previousId = entry.id;
  }
  return true;
}
