export type GameTaskKind = "dispatch" | "save" | "simulation";

export const PERFORMANCE_WINDOW_MS = 5000;
const MAX_SAMPLES = 4096;
const TASK_KINDS: GameTaskKind[] = ["dispatch", "save", "simulation"];
type Sample = { at: number; durationMs: number };

export type TaskPerformance = {
  count: number;
  averageMs: number | null;
  maxMs: number | null;
  totalMs: number;
};

export type GamePerformanceSnapshot = {
  fps: number | null;
  frameP95Ms: number | null;
  longFrameCount: number;
  frameCount: number;
  tasks: Record<GameTaskKind, TaskPerformance>;
};

// A ring keeps recording constant-time and memory bounded, even during a burst.
class RollingSamples {
  private samples: (Sample | undefined)[] = new Array(MAX_SAMPLES);
  private start = 0;
  private size = 0;

  add(at: number, durationMs: number) {
    if (!Number.isFinite(at) || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.samples[(this.start + this.size) % MAX_SAMPLES] = { at, durationMs };
    if (this.size < MAX_SAMPLES) this.size += 1;
    else this.start = (this.start + 1) % MAX_SAMPLES;
  }

  recent(now: number, windowMs = PERFORMANCE_WINDOW_MS): Sample[] {
    const result: Sample[] = [];
    for (let index = 0; index < this.size; index += 1) {
      const sample = this.samples[(this.start + index) % MAX_SAMPLES];
      if (sample && sample.at > now - windowMs && sample.at <= now) result.push(sample);
    }
    return result;
  }

  clear() {
    this.samples.fill(undefined);
    this.start = 0;
    this.size = 0;
  }
}

export function createPerformanceCollector() {
  const frames = new RollingSamples();
  const tasks = Object.fromEntries(TASK_KINDS.map((kind) => [kind, new RollingSamples()])) as Record<GameTaskKind, RollingSamples>;
  let previousFrame: number | null = null;

  return {
    reset() {
      previousFrame = null;
      frames.clear();
      for (const kind of TASK_KINDS) tasks[kind].clear();
    },
    recordFrame(at: number) {
      if (!Number.isFinite(at)) return;
      if (previousFrame !== null && at > previousFrame) frames.add(at, at - previousFrame);
      previousFrame = at;
    },
    recordTask(kind: GameTaskKind, durationMs: number, at: number) {
      tasks[kind].add(at, durationMs);
    },
    snapshot(now: number): GamePerformanceSnapshot {
      const frameSamples = frames.recent(now);
      const fpsSamples = frameSamples.filter((sample) => sample.at > now - 1000);
      const fpsDuration = fpsSamples.reduce((sum, sample) => sum + sample.durationMs, 0);
      const sortedDurations = frameSamples.map((sample) => sample.durationMs).sort((a, b) => a - b);
      const taskSnapshot = Object.fromEntries(TASK_KINDS.map((kind) => {
        const samples = tasks[kind].recent(now);
        const totalMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
        const maxMs = samples.length ? samples.reduce((max, sample) => Math.max(max, sample.durationMs), 0) : null;
        return [kind, {
          count: samples.length,
          averageMs: samples.length ? totalMs / samples.length : null,
          maxMs,
          totalMs,
        }];
      })) as Record<GameTaskKind, TaskPerformance>;
      return {
        fps: fpsDuration > 0 ? fpsSamples.length * 1000 / fpsDuration : null,
        frameP95Ms: sortedDurations.length ? sortedDurations[Math.ceil(sortedDurations.length * .95) - 1] : null,
        longFrameCount: frameSamples.filter((sample) => sample.durationMs > 50).length,
        frameCount: frameSamples.length,
        tasks: taskSnapshot,
      };
    },
  };
}

const collector = createPerformanceCollector();
let monitoringEnabled = false;

export function isPerformanceMonitoringEnabled() {
  return monitoringEnabled;
}

export function setPerformanceMonitoringEnabled(enabled: boolean) {
  monitoringEnabled = enabled;
  collector.reset();
}

export function recordPerformanceFrame(at: number) {
  if (monitoringEnabled) collector.recordFrame(at);
}

export function getPerformanceSnapshot(now: number) {
  return collector.snapshot(now);
}

export function recordGameTask(kind: GameTaskKind, durationMs: number) {
  if (monitoringEnabled) collector.recordTask(kind, durationMs, performance.now());
}

export function measureGameTask<T>(kind: GameTaskKind, action: () => T): T {
  if (!monitoringEnabled) return action();
  const startedAt = performance.now();
  try {
    return action();
  } finally {
    // Preserve both the result and exceptions from the measured game operation.
    recordGameTask(kind, performance.now() - startedAt);
  }
}
