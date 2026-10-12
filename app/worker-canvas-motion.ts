export type CanvasPoint = { x: number; y: number };
export type CanvasWorkerMotion = {
  from: CanvasPoint;
  to: CanvasPoint;
  startedAt: number;
  duration: number;
};

/** Same linear interpolation as .walker's individual translate transition. */
export function canvasWorkerPosition(motion: CanvasWorkerMotion, now: number): CanvasPoint {
  const progress = motion.duration > 0 ? Math.max(0, Math.min(1, (now - motion.startedAt) / motion.duration)) : 1;
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * progress,
    y: motion.from.y + (motion.to.y - motion.from.y) * progress,
  };
}

/** A changing destination starts at the currently visible point, not the old target. */
export function retargetCanvasWorker(motion: CanvasWorkerMotion | undefined, destination: CanvasPoint, duration: number, now: number, paused = false, handoff?: CanvasPoint): CanvasWorkerMotion {
  if (handoff) {
    return {
      from: { ...handoff },
      to: { ...destination },
      startedAt: now,
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    };
  }
  if (!motion || paused) return { from: destination, to: destination, startedAt: now, duration: 0 };
  if (motion.to.x === destination.x && motion.to.y === destination.y) return motion;
  return {
    from: canvasWorkerPosition(motion, now),
    to: destination,
    startedAt: now,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
  };
}

/** The original 64 × 106 DOM walker has a translate(-50%, -92%) anchor. */
export function canvasWorkerContains(position: CanvasPoint, point: CanvasPoint) {
  return point.x >= position.x - 32 && point.x <= position.x + 32 &&
    point.y >= position.y - 97.52 && point.y <= position.y + 8.48;
}

export type CanvasView = {
  left: number;
  top: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
};

/** Backing pixels depend on the viewport/DPR, never on the full map extent. */
export function canvasViewport(rect: { left: number; top: number }, scale: number, width: number, height: number, dpr: number, padding = 64): CanvasView {
  return {
    left: (-rect.left - padding) / scale,
    top: (-rect.top - padding) / scale,
    width: (width + padding * 2) / scale,
    height: (height + padding * 2) / scale,
    pixelWidth: Math.ceil((width + padding * 2) * dpr),
    pixelHeight: Math.ceil((height + padding * 2) * dpr),
  };
}

/** One-use DOM/Canvas boundary positions; weak world keys need no cleanup timer. */
export function createCanvasWorkerHandoffs<World extends object>(lifetimeMs = 2_000) {
  const worlds = new WeakMap<World, Map<string, { point: CanvasPoint; expiresAt: number }>>();

  function prune(entries: Map<string, { point: CanvasPoint; expiresAt: number }>, now: number) {
    for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
  }

  return {
    set(world: World, id: string, point: CanvasPoint, now: number) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      let entries = worlds.get(world);
      if (!entries) { entries = new Map(); worlds.set(world, entries); }
      prune(entries, now);
      entries.set(id, { point: { ...point }, expiresAt: now + lifetimeMs });
    },
    consume(world: World, id: string, now: number): CanvasPoint | undefined {
      const entries = worlds.get(world);
      if (!entries) return undefined;
      prune(entries, now);
      const entry = entries.get(id);
      entries.delete(id);
      if (!entries.size) worlds.delete(world);
      return entry?.point;
    },
    clear(world: World) { worlds.delete(world); },
  };
}

/** One boundary per distinct DOM depth; equal-depth workers stay behind the DOM sprite. */
export function canvasOcclusionDepths(depths: readonly number[]): number[] {
  return [...new Set(depths.filter(Number.isFinite))].sort((a, b) => a - b);
}

/** An ordered worker pass can reuse the preceding layer index without rescanning. */
export function canvasWorkerLayer(depth: number, boundaries: readonly number[], start = 0): number {
  let layer = start;
  while (layer < boundaries.length && depth > boundaries[layer]) layer += 1;
  return layer;
}

/** Ground stays below every worker layer; dragged sprites use a higher scene depth. */
export function canvasLayerZIndex(layer: number, boundaries: readonly number[]): number {
  return layer === 0 ? 999 : boundaries[layer - 1] + 1;
}
