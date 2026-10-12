type Clock = {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

/** Give the pickup pose a painted frame, then time travel and landing from activation. */
export function startWorkerTransfer(clock: Clock, durationMs: number, callbacks: {
  activate: () => void;
  land: () => void;
  complete: () => void;
}, landingMs = 160) {
  let cancelled = false;
  let frame: number | null = null;
  let timer: number | null = null;
  frame = clock.requestFrame(() => {
    frame = null;
    if (cancelled) return;
    frame = clock.requestFrame(() => {
      frame = null;
      if (cancelled) return;
      callbacks.activate();
      if (cancelled) return;
      timer = clock.setTimer(() => {
        timer = null;
        if (cancelled) return;
        callbacks.land();
        if (cancelled) return;
        timer = clock.setTimer(() => {
          timer = null;
          if (!cancelled) callbacks.complete();
        }, landingMs);
      }, durationMs);
    });
  });
  return {
    cancel() {
      cancelled = true;
      if (frame !== null) clock.cancelFrame(frame);
      if (timer !== null) clock.clearTimer(timer);
      frame = null;
      timer = null;
    },
  };
}
