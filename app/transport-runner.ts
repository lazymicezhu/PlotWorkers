import { createTransportMotion, retargetTransportMotion, sampleTransportMotion } from "./transport-motion.ts";
import type { Point, TransportMotion, TransportSample } from "./transport-motion.ts";

export type TransportClock = {
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

export type TransportOptions = {
  from: Point;
  getTarget: () => Point;
  getSpeed: () => { efficiency: number; buff: number };
  onUpdate: (sample: TransportSample) => void;
  onComplete: () => void;
  /** Keep the worker attached to the robot until a dragged plot is committed. */
  canComplete?: () => boolean;
};

type Job = {
  id: string;
  options: TransportOptions;
  stagedFrames: number;
  motion: TransportMotion | null;
  heldAtArrival: boolean;
};

/**
 * Animate every robot with one shared frame callback and one completion timer.
 * Callbacks can paint DOM positions directly; no React render is needed per frame.
 * The timer lets an already staged trip finish even when background frames stop.
 */
export function createTransportRunner(clock: TransportClock) {
  const jobs = new Map<string, Job>();
  let frame: { id: number; token: number } | null = null;
  let timer: { id: number; token: number; at: number } | null = null;
  let nextToken = 0;
  let updating = false;
  let disposed = false;

  const clearFrame = () => {
    const previous = frame;
    frame = null;
    if (previous) clock.cancelFrame(previous.id);
  };
  const clearTimer = () => {
    const previous = timer;
    timer = null;
    if (previous) clock.clearTimer(previous.id);
  };

  const schedule = () => {
    if (updating || disposed) return;
    if (jobs.size === 0) {
      clearFrame();
      clearTimer();
      return;
    }
    if (!frame) {
      const token = ++nextToken;
      frame = {
        token,
        id: clock.requestFrame(() => {
          if (frame?.token !== token || disposed) return;
          frame = null;
          update(true);
        }),
      };
    }
    const now = clock.now();
    let nextDeadline = Infinity;
    for (const job of jobs.values()) {
      // An overdue job can be held while its plot is dragged. Wait for a frame
      // or explicit refresh instead of continuously firing zero-delay timers.
      if (job.motion && !job.heldAtArrival) nextDeadline = Math.min(nextDeadline, job.motion.completeAtMs);
    }
    if (timer?.at === nextDeadline) return;
    clearTimer();
    if (Number.isFinite(nextDeadline)) {
      const token = ++nextToken;
      timer = {
        token,
        at: nextDeadline,
        id: clock.setTimer(() => {
          if (timer?.token !== token || disposed) return;
          timer = null;
          update(false);
        }, Math.max(0, Math.ceil(nextDeadline - now))),
      };
    }
  };

  const update = (advanceStaging: boolean) => {
    if (updating || disposed) return;
    updating = true;
    try {
      const now = clock.now();
      for (const job of [...jobs.values()]) {
        if (jobs.get(job.id) !== job) continue;
        const target = job.options.getTarget();
        const speed = job.options.getSpeed();
        if (!job.motion) {
          if (advanceStaging) job.stagedFrames += 1;
          const staged = createTransportMotion(job.options.from, target, now, speed.efficiency, speed.buff);
          // Two frame boundaries allow the pickup sprite to mount and paint
          // before its real clock starts, matching the existing transfer UI.
          if (job.stagedFrames < 2) {
            job.options.onUpdate(sampleTransportMotion(staged, now));
            continue;
          }
          job.motion = staged;
        } else {
          // Retarget before sampling completion, including a late timer. A
          // destination moved after the old arrival must never teleport a worker.
          job.motion = retargetTransportMotion(job.motion, target, now, speed.efficiency, speed.buff, true);
        }
        const sample = sampleTransportMotion(job.motion, now);
        const complete = sample.phase === "complete" && (job.options.canComplete?.() ?? true);
        job.heldAtArrival = sample.phase === "complete" && !complete;
        job.options.onUpdate(job.heldAtArrival ? { ...sample, phase: "landing" } : sample);
        // onUpdate can cause manual takeover or reset. Never finish stale work.
        if (complete && jobs.get(job.id) === job) {
          jobs.delete(job.id);
          job.options.onComplete();
        }
      }
    } finally {
      updating = false;
      schedule();
    }
  };

  return {
    start(id: string, options: TransportOptions) {
      if (disposed) return { cancel() {} };
      const job: Job = { id, options: { ...options, from: { ...options.from } }, stagedFrames: 0, motion: null, heldAtArrival: false };
      jobs.set(id, job);
      update(false);
      return {
        cancel() {
          if (jobs.get(id) !== job) return;
          jobs.delete(id);
          schedule();
        },
      };
    },
    /** Refresh immediately after committed plot moves, upgrades, or buff expiry. */
    refresh() { update(false); },
    cancelAll() {
      jobs.clear();
      clearFrame();
      clearTimer();
    },
    dispose() {
      disposed = true;
      jobs.clear();
      clearFrame();
      clearTimer();
    },
  };
}
