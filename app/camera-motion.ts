export type CameraPoint = { x: number; y: number };
export type CameraMotion = { position: CameraPoint; velocity: CameraPoint };

// A critically damped spring reaches 95% of a new resting target in ~340ms.
// Its exact solution keeps motion consistent across display refresh rates.
const RESPONSE_FREQUENCY = 14;
const MAX_FRAME_SECONDS = 0.05;
const POSITION_EPSILON = 0.01;
const VELOCITY_EPSILON = 0.05;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function createCameraMotion(position: CameraPoint): CameraMotion {
  return {
    position: { x: finite(position.x), y: finite(position.y) },
    velocity: { x: 0, y: 0 },
  };
}

function advanceAxis(position: number, velocity: number, target: number, seconds: number): [number, number] {
  const displacement = position - target;
  const decay = Math.exp(-RESPONSE_FREQUENCY * seconds);
  const springVelocity = velocity + RESPONSE_FREQUENCY * displacement;
  const nextPosition = target + (displacement + springVelocity * seconds) * decay;
  const nextVelocity = (velocity - RESPONSE_FREQUENCY * springVelocity * seconds) * decay;

  // Invalid geometry must never propagate NaN into the scene transform.
  if (!Number.isFinite(nextPosition) || !Number.isFinite(nextVelocity)) return [position, 0];

  // An abruptly closer target can otherwise be crossed by existing momentum.
  if (displacement === 0 || (displacement < 0 ? nextPosition >= target : nextPosition <= target)) {
    return [target, 0];
  }
  if (Math.abs(nextPosition - target) < POSITION_EPSILON && Math.abs(nextVelocity) < VELOCITY_EPSILON) {
    return [target, 0];
  }
  return [nextPosition, nextVelocity];
}

/** Advance in seconds, preserving momentum when the follow target changes. */
export function advanceCameraMotion(motion: CameraMotion, target: CameraPoint, elapsedSeconds: number): CameraMotion {
  const position = {
    x: finite(motion.position.x, finite(target.x)),
    y: finite(motion.position.y, finite(target.y)),
  };
  const velocity = { x: finite(motion.velocity.x), y: finite(motion.velocity.y) };
  const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, finite(elapsedSeconds)));
  if (seconds === 0) {
    if (position.x === motion.position.x && position.y === motion.position.y
      && velocity.x === motion.velocity.x && velocity.y === motion.velocity.y) return motion;
    return { position, velocity };
  }

  const [x, vx] = advanceAxis(position.x, velocity.x, finite(target.x, position.x), seconds);
  const [y, vy] = advanceAxis(position.y, velocity.y, finite(target.y, position.y), seconds);
  return { position: { x, y }, velocity: { x: vx, y: vy } };
}


/** The scene already renders this many world units outside each viewport edge. */
export const CAMERA_CULL_MARGIN_WORLD = 240;

export function cameraNeedsCullingRefresh(position: CameraPoint, snapshot: CameraPoint, zoom: number, thresholdWorld = CAMERA_CULL_MARGIN_WORLD / 2): boolean {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.abs(position.x - snapshot.x) > thresholdWorld * scale
    || Math.abs(position.y - snapshot.y) > thresholdWorld * scale;
}

/** Coalesce pointer input without allowing a cancelled old frame to restore stale coordinates. */
export function createCameraFrameQueue({ requestFrame, cancelFrame, commit }: {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  commit: (position: CameraPoint, forceSnapshot: boolean) => void;
}) {
  let frame: number | null = null;
  let pending: CameraPoint | null = null;
  let generation = 0;
  const cancel = () => {
    generation += 1;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pending = null;
  };
  return {
    queue(position: CameraPoint) {
      pending = position;
      if (frame !== null) return;
      const epoch = generation;
      frame = requestFrame(() => {
        if (epoch !== generation) return;
        frame = null;
        const next = pending;
        pending = null;
        if (next) commit(next, false);
      });
    },
    flush(position?: CameraPoint) {
      const next = position ?? pending;
      cancel();
      if (next) commit(next, true);
    },
    cancel,
  };
}
