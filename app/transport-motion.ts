/** World-space points, before applying the camera's translation or zoom. */
export type Point = { x: number; y: number };

export type TransportPhase = "pickup" | "accelerating" | "cruising" | "decelerating" | "landing" | "complete";

type FlightSegment = {
  startsAtSeconds: number;
  durationSeconds: number;
  startsAtDistance: number;
  initialSpeed: number;
  acceleration: number;
  phase: "accelerating" | "cruising" | "decelerating";
};

export type TransportMotion = {
  from: Point;
  to: Point;
  startedAtMs: number;
  plannedAtMs: number;
  pickupUntilMs: number;
  flightStartsAtMs: number;
  flightEndsAtMs: number;
  completeAtMs: number;
  distance: number;
  efficiency: number;
  buff: number;
  segments: readonly FlightSegment[];
};

export type TransportSample = {
  point: Point;
  /** Scalar speed in map grid units per second. */
  speed: number;
  phase: TransportPhase;
  remainingMs: number;
  /** Distance fraction along the current flight plan; 0 in pickup, 1 on arrival. */
  progress: number;
};

const PICKUP_MS = 140;
const LANDING_MS = 160;
export const BASE_GRID_SPEED = 12;
export const TRANSPORT_ACCELERATION_FRACTION = .15;
export const TRANSPORT_BRAKING_FRACTION = .25;
export const TRANSPORT_CRUISE_MULTIPLIER = 1 / (1 - (TRANSPORT_ACCELERATION_FRACTION + TRANSPORT_BRAKING_FRACTION) / 2);
const EPSILON = 1e-9;

const positiveOrOne = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const copyPoint = (point: Point): Point => ({ x: finiteOr(point.x, 0), y: finiteOr(point.y, 0) });
const averageSpeed = (efficiency: number, buff: number) => BASE_GRID_SPEED * positiveOrOne(efficiency) * positiveOrOne(buff);

/** Invert x = 52(u - v), y = 27(u + v), then measure the actual grid route. */
export function gridDistance(from: Point, to: Point): number {
  const dx = (finiteOr(to.x, 0) - finiteOr(from.x, 0)) / 52;
  const dy = (finiteOr(to.y, 0) - finiteOr(from.y, 0)) / 27;
  return Math.hypot((dy + dx) / 2, (dy - dx) / 2);
}

export function transportDurationMs(from: Point, to: Point, efficiency = 1, buff = 1): number {
  return PICKUP_MS + LANDING_MS + gridDistance(from, to) / averageSpeed(efficiency, buff) * 1000;
}

/**
 * An uninterrupted trip spends 15% of flight time accelerating, 60% cruising,
 * and 25% braking. Normalize the area under this speed curve so faster startup
 * preserves both the promised average speed and the distance-based trip time.
 *
 * A redirected trip retains its current scalar speed. Rebuilding its remaining
 * trapezoid analytically avoids restarting the ramp on every drag frame.
 */
function planFlight(distance: number, initialSpeed: number, speed: number): { segments: FlightSegment[]; seconds: number } {
  if (distance <= EPSILON) return { segments: [], seconds: 0 };
  const peakSpeed = speed * TRANSPORT_CRUISE_MULTIPLIER;
  const acceleration = peakSpeed * speed / (TRANSPORT_ACCELERATION_FRACTION * distance);
  const braking = peakSpeed * speed / (TRANSPORT_BRAKING_FRACTION * distance);
  const segments: FlightSegment[] = [];
  let seconds = 0;
  let traveled = 0;
  let velocity = Math.max(0, initialSpeed);

  const append = (durationSeconds: number, nextSpeed: number) => {
    if (durationSeconds <= EPSILON) return;
    const rate = (nextSpeed - velocity) / durationSeconds;
    segments.push({
      startsAtSeconds: seconds,
      durationSeconds,
      startsAtDistance: traveled,
      initialSpeed: velocity,
      acceleration: rate,
      phase: rate > EPSILON ? "accelerating" : rate < -EPSILON ? "decelerating" : "cruising",
    });
    traveled += (velocity + nextSpeed) / 2 * durationSeconds;
    seconds += durationSeconds;
    velocity = nextSpeed;
  };

  const stoppingDistance = velocity * velocity / (2 * braking);
  if (stoppingDistance >= distance) {
    // A moved plot can be inside our old braking distance. Brake harder to meet
    // it exactly, preserving position and speed at the replan boundary.
    append(2 * distance / velocity, 0);
  } else {
    // A speed reduction may leave us above the new cruise speed; decelerate
    // smoothly first. Otherwise a short route can need a triangular profile.
    const cruiseSpeed = velocity > peakSpeed ? peakSpeed : Math.min(peakSpeed, Math.sqrt((2 * distance + velocity * velocity / acceleration) / (1 / acceleration + 1 / braking)));
    append(Math.abs(cruiseSpeed - velocity) / (velocity > cruiseSpeed ? braking : acceleration), cruiseSpeed);
    const brakingDistance = cruiseSpeed * cruiseSpeed / (2 * braking);
    append(Math.max(0, distance - traveled - brakingDistance) / cruiseSpeed, cruiseSpeed);
    append(cruiseSpeed / braking, 0);
  }
  return { segments, seconds };
}

function buildMotion(
  from: Point, to: Point, nowMs: number, startedAtMs: number, pickupUntilMs: number,
  initialSpeed: number, efficiency: number, buff: number,
): TransportMotion {
  const distance = gridDistance(from, to);
  const flightStartsAtMs = Math.max(nowMs, pickupUntilMs);
  const flight = planFlight(distance, initialSpeed, averageSpeed(efficiency, buff));
  const flightEndsAtMs = flightStartsAtMs + flight.seconds * 1000;
  return {
    from: copyPoint(from), to: copyPoint(to), startedAtMs, plannedAtMs: nowMs, pickupUntilMs,
    flightStartsAtMs, flightEndsAtMs, completeAtMs: flightEndsAtMs + LANDING_MS,
    distance, efficiency: positiveOrOne(efficiency), buff: positiveOrOne(buff), segments: flight.segments,
  };
}

export function createTransportMotion(from: Point, to: Point, nowMs: number, efficiency = 1, buff = 1): TransportMotion {
  const now = finiteOr(nowMs, 0);
  return buildMotion(from, to, now, now, now + PICKUP_MS, 0, efficiency, buff);
}

export function sampleTransportMotion(motion: TransportMotion, nowMs: number): TransportSample {
  const now = Math.max(motion.plannedAtMs, finiteOr(nowMs, motion.plannedAtMs));
  const remainingMs = Math.max(0, motion.completeAtMs - now);
  if (now < motion.pickupUntilMs) return { point: copyPoint(motion.from), speed: 0, phase: "pickup", remainingMs, progress: 0 };
  if (now >= motion.flightEndsAtMs) return {
    point: copyPoint(motion.to), speed: 0,
    phase: now >= motion.completeAtMs ? "complete" : "landing", remainingMs, progress: 1,
  };

  const elapsed = Math.max(0, (now - motion.flightStartsAtMs) / 1000);
  const segment = motion.segments.find((part) => elapsed < part.startsAtSeconds + part.durationSeconds) ?? motion.segments[motion.segments.length - 1];
  const localSeconds = Math.max(0, Math.min(segment.durationSeconds, elapsed - segment.startsAtSeconds));
  const traveled = segment.startsAtDistance + segment.initialSpeed * localSeconds + .5 * segment.acceleration * localSeconds * localSeconds;
  const progress = Math.max(0, Math.min(1, traveled / motion.distance));
  return {
    point: {
      x: motion.from.x + (motion.to.x - motion.from.x) * progress,
      y: motion.from.y + (motion.to.y - motion.from.y) * progress,
    },
    speed: Math.max(0, segment.initialSpeed + segment.acceleration * localSeconds),
    phase: segment.phase, remainingMs, progress,
  };
}

export function retargetTransportMotion(motion: TransportMotion, to: Point, nowMs: number, efficiency = 1, buff = 1, allowCompletedRetarget = false): TransportMotion {
  const target = copyPoint(to);
  const nextEfficiency = positiveOrOne(efficiency);
  const nextBuff = positiveOrOne(buff);
  const sameTarget = target.x === motion.to.x && target.y === motion.to.y;
  if (sameTarget && nextEfficiency === motion.efficiency && nextBuff === motion.buff) return motion;
  const now = Math.max(motion.plannedAtMs, finiteOr(nowMs, motion.plannedAtMs));
  const current = sampleTransportMotion(motion, now);
  // A runner may still own an arrived worker while its destination is being
  // dragged, or while a background timer is late. Check its latest destination
  // before releasing that worker; standalone completed plans stay immutable.
  if (current.phase === "complete" && !allowCompletedRetarget) return motion;
  // Upgrades cannot extend or shorten the fixed grab/drop handling time.
  if (sameTarget && (current.phase === "landing" || current.phase === "complete")) return { ...motion, efficiency: nextEfficiency, buff: nextBuff };
  return buildMotion(current.point, target, now, motion.startedAtMs, motion.pickupUntilMs, current.speed, nextEfficiency, nextBuff);
}
