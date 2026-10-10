export type BatchSnapshot = {
  recipe: string;
  completed: number;
  progress: number;
  active: boolean;
};

export type BatchMotion = {
  recipe: string;
  position: number;
  cursor: number;
  target: number;
  value: number;
  phase: "idle" | "moving" | "full" | "reset";
  remainingMs: number;
};

const EPSILON = 1e-9;
// Keep a small reserve of already confirmed work between one-second samples.
// It absorbs normal delivery jitter without predicting future production.
const PLAYBACK_MS = 1150;

function snapshotPosition(snapshot: BatchSnapshot) {
  const completed = Math.max(0, Math.floor(snapshot.completed));
  return completed + (snapshot.active ? Math.max(0, Math.min(1, snapshot.progress)) : 0);
}

export function createBatchMotion(snapshot: BatchSnapshot): BatchMotion {
  const position = snapshotPosition(snapshot);
  return {
    recipe: snapshot.recipe,
    position,
    cursor: position,
    target: position,
    value: snapshot.active ? Math.max(0, Math.min(1, snapshot.progress)) : 0,
    phase: snapshot.active && snapshot.progress >= 1 ? "full" : "idle",
    remainingMs: 0,
  };
}

export function updateBatchMotion(motion: BatchMotion, snapshot: BatchSnapshot): BatchMotion {
  const target = snapshotPosition(snapshot);
  if (snapshot.recipe !== motion.recipe || target < motion.target - EPSILON) {
    return createBatchMotion(snapshot);
  }
  // Both views can publish the same snapshot; neither should restart the clock.
  if (Math.abs(target - motion.target) < EPSILON) return motion;
  return {
    ...motion,
    target,
    remainingMs: PLAYBACK_MS,
    phase: motion.phase === "idle" ? "moving" : motion.phase,
  };
}

export function advanceBatchMotion(motion: BatchMotion, deltaMs: number): BatchMotion {
  if (motion.phase === "idle") return motion;
  // A stalled frame must not skip several whole batches on the next paint.
  const elapsed = Math.max(0, Math.min(50, deltaMs));
  if (elapsed === 0) return motion;
  const remainingMs = Math.max(0, motion.remainingMs - elapsed);
  // The continuous cursor keeps moving while a full or empty frame is painted,
  // so crossing a batch boundary never throws away interpolation time. Both the
  // cursor and the visible position are bounded by the confirmed target.
  const fraction = motion.remainingMs > 0 ? Math.min(1, elapsed / motion.remainingMs) : 1;
  const cursor = Math.min(motion.target, motion.cursor + (motion.target - motion.cursor) * fraction);
  if (motion.phase === "full") {
    return { ...motion, cursor, remainingMs, phase: "reset", value: 0 };
  }
  if (motion.position >= motion.target - EPSILON) {
    return { ...motion, cursor, remainingMs, phase: "idle", value: 0 };
  }

  const boundary = Math.floor(motion.position + EPSILON) + 1;
  // Stop at EVERY boundary. Full and empty frames are painted separately before
  // advancing again, even if a single simulation tick completed several batches.
  if (boundary <= motion.target + EPSILON && cursor >= boundary - EPSILON) {
    return { ...motion, cursor, remainingMs, position: boundary, value: 1, phase: "full" };
  }
  const arrived = cursor >= motion.target - EPSILON;
  const next = arrived ? motion.target : cursor;
  return { ...motion, cursor, remainingMs, position: next, value: next % 1, phase: arrived ? "idle" : "moving" };
}
