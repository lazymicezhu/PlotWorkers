export type AfterPaintSaveScheduler = {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
};

function browserScheduler(): AfterPaintSaveScheduler | null {
  if (typeof window === "undefined") return null;
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frame) => window.cancelAnimationFrame(frame),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timer) => window.clearTimeout(timer),
  };
}

/**
 * Coalesce saves into a task after the next animation frame. The save callback
 * reads the latest state when invoked; this queue never captures game snapshots.
 */
export function createAfterPaintSave(
  save: () => void,
  onError?: (error: unknown) => void,
  injectedScheduler?: AfterPaintSaveScheduler,
) {
  let scheduler = injectedScheduler ?? null;
  let frame: number | null = null;
  let timer: number | null = null;
  let generation = 0;
  let requestedVersion = 0;
  let dirty = false;

  function markDirty() {
    dirty = true;
    requestedVersion += 1;
  }

  function cancelScheduled() {
    // Guard callbacks already queued by a host before their cancellation.
    generation += 1;
    if (frame !== null) scheduler?.cancelFrame(frame);
    if (timer !== null) scheduler?.clearTimer(timer);
    frame = timer = null;
  }

  function saveLatest() {
    if (!dirty) return;
    const version = requestedVersion;
    try {
      save();
      // A request made by the callback still needs its own later save.
      if (version === requestedVersion) dirty = false;
    } catch (error) {
      // Keep dirty so the next request or leave flush can retry. A persistence
      // failure must not turn an already committed purchase into a failed trade.
      try { onError?.(error); } catch { /* Error reporting cannot undo a trade. */ }
    }
  }

  function request() {
    markDirty();
    if (frame !== null || timer !== null) return;
    // Lazy resolution also makes construction during SSR safe.
    scheduler ??= browserScheduler();
    if (!scheduler) return;
    const host = scheduler;
    const token = generation;
    frame = host.requestFrame(() => {
      if (token !== generation) return;
      frame = null;
      timer = host.setTimer(() => {
        if (token !== generation) return;
        timer = null;
        saveLatest();
      }, 0);
    });
  }

  function flush() {
    cancelScheduled();
    // Leaving must save current simulation progress even without a queued trade.
    markDirty();
    saveLatest();
  }

  function cancel() {
    cancelScheduled();
    dirty = false;
    requestedVersion += 1;
  }

  return { request, flush, cancel };
}
