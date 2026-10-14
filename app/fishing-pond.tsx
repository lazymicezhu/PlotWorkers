"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { PlotState, WorkerState } from "./game-engine";
import { fishingImageLayout, fishingPhase, fishingSeatPoint, fishingSurfaceLayout } from "./fishing";
import type { FishingHistoryEntry } from "./fishing";
import { createPondAnimator, FISHING_ITEM_ART, interpolateFishingElapsed } from "./fishing-animator";
import type { FishingAnimationSeat } from "./fishing-animator";
import styles from "./fishing-pond.module.css";

type FishingPondProps = {
  plot: PlotState;
  workers: readonly WorkerState[];
  paused?: boolean;
  draggingWorkerId?: string | null;
  onWorkerPointerDown?: (event: PointerEvent<HTMLElement>, workerId: string) => void;
};
type WorkerClock = {
  sourceElapsed: number;
  cycle: number;
  seat: string;
  elapsed: number;
  receivedAt: number;
  wasPaused: boolean;
};

/** The painted seat anchors and engine drop targets share one coordinate map. */
export function FishingPond({ plot, workers, paused = false, draggingWorkerId = null, onWorkerPointerDown }: FishingPondProps) {
  const surfaceId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animatorRef = useRef<ReturnType<typeof createPondAnimator> | null>(null);
  const latestRef = useRef({ plot, workers, paused, draggingWorkerId });
  const clocksRef = useRef(new Map<string, WorkerClock>());
  const image = fishingImageLayout(plot);
  const surface = fishingSurfaceLayout(plot);
  const seated = workers.filter(worker => worker.zoneId === plot.id && worker.fishing && worker.id !== draggingWorkerId && worker.status !== "dragging");

  useLayoutEffect(() => {
    latestRef.current = { plot, workers, paused, draggingWorkerId };
  }, [plot, workers, paused, draggingWorkerId]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const animator = createPondAnimator(canvas);
    animatorRef.current = animator;
    const clocks = clocksRef.current;
    let alive = true;
    void animator.ready.catch(error => {
      if (alive) canvas.dataset.animationError = error instanceof Error ? error.message : "垂钓动画加载失败";
    });
    let frame = 0;
    let previousPaint = -Infinity;
    function render(now: number) {
      if (!alive) return;
      frame = requestAnimationFrame(render);
      // Poses are authored at a lower cadence; 30 fps preserves smooth lines
      // and water without adding three full-resolution canvases to the world.
      if (now - previousPaint < 1000 / 30) return;
      previousPaint = now;
      const current = latestRef.current;
      const stopped = current.paused || current.plot.enabled === false || document.hidden;
      const active = current.workers.filter(worker => worker.zoneId === current.plot.id && worker.fishing && worker.id !== current.draggingWorkerId && worker.status !== "dragging");
      const retained = new Set(active.map(worker => worker.id));
      for (const id of clocks.keys()) if (!retained.has(id)) clocks.delete(id);
      const seats: FishingAnimationSeat[] = active.map(worker => {
        const fishing = worker.fishing!;
        let clock = clocks.get(worker.id);
        if (!clock || clock.sourceElapsed !== fishing.elapsed || clock.cycle !== fishing.cycle || clock.seat !== fishing.seat) {
          clock = { sourceElapsed: fishing.elapsed, cycle: fishing.cycle, seat: fishing.seat, elapsed: fishing.elapsed, receivedAt: now, wasPaused: stopped };
          clocks.set(worker.id, clock);
        }
        const speed = worker.personality === "lazy" ? 2 : 1;
        if (stopped !== clock.wasPaused) {
          clock.elapsed = interpolateFishingElapsed(clock.elapsed, (now - clock.receivedAt) / 1000, speed, clock.wasPaused);
          clock.receivedAt = now;
          clock.wasPaused = stopped;
        }
        const elapsed = interpolateFishingElapsed(clock.elapsed, (now - clock.receivedAt) / 1000, speed, stopped);
        return { id: fishing.seat, workerId: worker.id, elapsed, ...fishingPhase(elapsed), outcome: fishing.outcome };
      });
      animator.render(seats);
    }
    const onVisibility = () => {
      // A hidden page cannot cause interpolation to jump into a later catch.
      const now = performance.now();
      for (const clock of clocks.values()) clock.receivedAt = now;
      previousPaint = -Infinity;
    };
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(render);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      animator.destroy();
      animatorRef.current = null;
      clocks.clear();
    };
  }, []);

  useLayoutEffect(() => {
    // The game can zoom above 1x, so retain enough texture resolution for it.
    const ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    animatorRef.current?.resize(Math.ceil(image.width * ratio), Math.ceil(image.height * ratio));
  }, [image.width, image.height]);

  const artStyle = { left: image.left - plot.x, top: image.top - plot.y, width: image.width, height: image.height };
  return <>
    <div className="plot-shadow" />
    <div className="plot-base" aria-hidden="true"><span className="base-left" /><span className="base-right" /></div>
    <svg className={styles.pond} width={surface.width} height={surface.height} viewBox={`0 0 ${surface.width} ${surface.height}`} aria-hidden="true">
      <defs>
        <clipPath id={`${surfaceId}-upper`} clipPathUnits="userSpaceOnUse">
          {/* One source pixel of overlap prevents a translucent seam between the two affine slices. */}
          <polygon points="768,26 38,453 40,454 1496,454 1498,453" />
          {/* Keep the authored rear planters above the edge, without their surrounding baked glow. */}
          <path d="M 465,240 L 465,211 L 476,202 L 461,189 Q 452,178 465,178 L 479,180 L 485,177 L 485,168 Q 481,160 488,160 L 493,164 L 496,161 L 496,156 Q 497,149 502,154 L 508,166 L 511,151 L 511,147 Q 506,138 510,126 Q 515,115 522,125 Q 526,136 522,146 L 520,153 L 520,166 L 525,170 L 529,158 Q 533,149 540,149 L 542,153 L 546,146 L 550,136 Q 554,126 561,132 Q 567,137 562,148 L 557,157 L 552,166 L 552,174 L 560,170 Q 573,167 568,176 L 559,190 L 568,198 L 568,221 L 498,251 Z" />
          <path d="M 994,230 L 994,206 L 1004,202 L 1001,192 L 995,184 Q 990,173 1000,175 L 1017,186 L 1023,180 L 1027,163 Q 1023,153 1027,142 Q 1032,133 1037,142 Q 1042,154 1037,165 L 1035,174 L 1039,184 L 1046,183 L 1050,176 Q 1056,170 1062,175 L 1065,170 Q 1065,158 1072,157 Q 1081,158 1078,172 L 1074,181 L 1069,184 L 1065,201 L 1075,196 Q 1083,191 1092,193 Q 1098,197 1090,204 L 1080,215 L 1093,226 L 1093,248 L 1052,263 L 996,240 Z" />
        </clipPath>
        <clipPath id={`${surfaceId}-lower`} clipPathUnits="userSpaceOnUse">
          <polygon points="38,453 1498,453 758,881" />
        </clipPath>
      </defs>
      <g transform={`matrix(${surface.upper.join(" ")})`}>
        <image href="/fishing/pond-base.png" width="1536" height="1024" clipPath={`url(#${surfaceId}-upper)`} />
      </g>
      <g transform={`matrix(${surface.lower.join(" ")})`}>
        <image href="/fishing/pond-base.png" width="1536" height="1024" clipPath={`url(#${surfaceId}-lower)`} />
      </g>
    </svg>
    <canvas ref={canvasRef} className={styles.animation} style={artStyle} aria-hidden="true" />
    {seated.map(worker => {
      const point = fishingSeatPoint(plot, worker.fishing!.seat);
      return <div
        key={worker.id}
        className={styles.workerHit}
        data-worker-id={worker.id}
        data-fishing-worker="true"
        data-world-x={point.x}
        data-world-y={point.y}
        data-fishing-seat={worker.fishing!.seat}
        style={{ left: point.x - plot.x, top: point.y - plot.y }}
        role="button"
        aria-label={`${worker.name}，垂钓中${worker.personality === "lazy" ? "，垂钓速度加成100%" : ""}，拖动移出`}
        onPointerDown={event => onWorkerPointerDown?.(event, worker.id)}
      />;
    })}
  </>;
}

export function FishingHarvest({ history, onClose }: { history: readonly FishingHistoryEntry[]; onClose: () => void }) {
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return <aside
    className="floating-panel"
    data-fishing-harvest="true"
    aria-labelledby={titleId}
    onPointerDown={event => event.stopPropagation()}
  >
    <button type="button" className="panel-close" aria-label="关闭收获" onClick={onClose}>×</button>
    <h2 id={titleId}>收获</h2>
    <div className={styles.harvestScroll}>
      <ol className={styles.history}>
        {history.length ? history.slice(-20).reverse().map(record => {
          const item = record.itemId ? FISHING_ITEM_ART[record.itemId] : null;
          return <li key={record.id} className={`${styles.historyRow} ${record.kind === "gold" ? styles.gold : ""} ${record.kind === "empty" ? styles.empty : ""}`}>
            <span>{item ? `${item.label}+1` : "空杆"}</span>
            <time className={styles.age} dateTime={new Date(record.caughtAt).toISOString()}>{Math.max(0, Math.floor((now - record.caughtAt) / 1000))}s前</time>
          </li>;
        }) : <li className={styles.noHistory}>暂无收获记录</li>}
      </ol>
    </div>
  </aside>;
}
