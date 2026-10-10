export type BatchSnapshot = {
  recipe: string;
  completed: number;
  progress: number;
  active: boolean;
};

export type BatchMotion = {
  recipe: string;
  position: number;
  target: number;
  value: number;
  phase: "idle" | "moving" | "full" | "reset";
  holdMs: number;
  fullHoldMs: number;
  speed: number;
};

const EPSILON = 1e-9;
const SAMPLE_MS = 1000;
const FULL_HOLD_MS = 40;

function snapshotPosition(snapshot: BatchSnapshot) {
  const completed = Math.max(0, Math.floor(snapshot.completed));
  return completed + (snapshot.active ? Math.max(0, Math.min(1, snapshot.progress)) : 0);
}

export function createBatchMotion(snapshot: BatchSnapshot): BatchMotion {
  const position = snapshotPosition(snapshot);
  return {
    recipe: snapshot.recipe,
    position,
    target: position,
    value: snapshot.active ? Math.max(0, Math.min(1, snapshot.progress)) : 0,
    phase: snapshot.active && snapshot.progress >= 1 ? "full" : "idle",
    holdMs: 0,
    fullHoldMs: FULL_HOLD_MS,
    speed: 0,
  };
}

export function updateBatchMotion(motion: BatchMotion, snapshot: BatchSnapshot): BatchMotion {
  const target = snapshotPosition(snapshot);
  if (snapshot.recipe !== motion.recipe || target < motion.target - EPSILON) {
    return createBatchMotion(snapshot);
  }
  // Both views can publish the same snapshot; neither should restart the clock.
  if (Math.abs(target - motion.target) < EPSILON) return motion;
  const crossings = Math.max(0, Math.floor(target + EPSILON) - Math.floor(motion.position + EPSILON));
  // Fast factories still paint full and empty separately, but extra full-frame
  // dwell would otherwise build an ever-growing queue of completed batches.
  const fullHoldMs = target - motion.position > 4 ? 0 : FULL_HOLD_MS;
  // Budget an empty frame and the frame rounded up at each full boundary.
  const movementMs = Math.max(160, SAMPLE_MS - crossings * (fullHoldMs + 2 * 1000 / 60));
  return {
    ...motion,
    target,
    speed: (target - motion.position) / movementMs,
    fullHoldMs,
    phase: motion.phase === "idle" ? "moving" : motion.phase,
  };
}

export function advanceBatchMotion(motion: BatchMotion, deltaMs: number): BatchMotion {
  if (motion.phase === "idle") return motion;
  // A stalled frame must not skip several whole batches on the next paint.
  const elapsed = Math.max(0, Math.min(50, deltaMs));
  if (motion.phase === "full") {
    const holdMs = motion.holdMs + elapsed;
    return holdMs < motion.fullHoldMs
      ? { ...motion, holdMs }
      : { ...motion, phase: "reset", value: 0, holdMs: 0 };
  }
  if (motion.position >= motion.target - EPSILON) {
    return { ...motion, phase: "idle", value: 0 };
  }

  const position = Math.min(motion.target, motion.position + motion.speed * elapsed);
  const boundary = Math.floor(motion.position + EPSILON) + 1;
  // Stop at EVERY boundary. Full and empty frames are painted separately before
  // advancing again, even if a single simulation tick completed several batches.
  if (boundary <= motion.target + EPSILON && position >= boundary - EPSILON) {
    return { ...motion, position: boundary, value: 1, phase: "full", holdMs: 0 };
  }
  const arrived = position >= motion.target - EPSILON;
  const next = arrived ? motion.target : position;
  return { ...motion, position: next, value: next % 1, phase: arrived ? "idle" : "moving" };
}
