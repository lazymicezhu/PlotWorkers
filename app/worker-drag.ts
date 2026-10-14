import { plotCapacity, type PlotState, type WorkerState } from "./game-engine.ts";
import type { CanvasPoint } from "./worker-canvas-motion.ts";
import { createFishingProgress, fishingSeatPoint, nearestFishingSeat, pointInFishingPlot } from "./fishing.ts";

export function workerAtPoint(worker: WorkerState, point: CanvasPoint, plot?: PlotState): WorkerState {
  if (!plot) return { ...worker, ...point };
  const x = point.x - plot.x - plot.rows * 52;
  const y = point.y - plot.y;
  return { ...worker, ...point, u: y / 54 + x / 104, v: y / 54 - x / 104 };
}

export function resolveWorkerDrop(worker: WorkerState, origin: WorkerState, point: CanvasPoint, moved: boolean,
  plots: readonly PlotState[], workers: readonly WorkerState[], incoming: readonly { workerId: string; targetId: string; action: string }[],
): { worker: WorkerState; accepted: boolean; notice: string | null } {
  const restore = (notice: string | null = null) => ({ worker: { ...origin, duration: 500 }, accepted: false, notice });
  if (!moved) return restore();
  const target = plots.find((plot) => {
    if (plot.type === "fishing") return pointInFishingPlot(plot, point);
    const local = workerAtPoint(worker, point, plot);
    return local.u >= 0 && local.u <= plot.cols && local.v >= 0 && local.v <= plot.rows;
  });
  if (!target) return restore("已回到原位");
  if (target.enabled === false) return restore("该地块已停用，请先在地块管理中启用");
  const occupants = new Set(workers.filter((item) => item.id !== worker.id && item.zoneId === target.id).map((item) => item.id));
  for (const transfer of incoming) {
    if (transfer.workerId !== worker.id && transfer.targetId === target.id && transfer.action !== "wake") occupants.add(transfer.workerId);
  }
  const capacity = plotCapacity(target);
  if (occupants.size >= capacity) return restore(`${target.name}已达到${capacity}人上限（含正在搬入）`);
  if (target.type === "fishing") {
    const seat = nearestFishingSeat(target, point, workers, worker.id);
    if (!seat) return restore("摸鱼池的 3 个钓位已坐满");
    return {
      accepted: true, notice: null,
      worker: {
        ...worker, zoneId: target.id, ...fishingSeatPoint(target, seat),
        fishing: { ...(worker.fishing ?? createFishingProgress(seat)), seat },
        status: "fishing", duration: 500, facing: seat === "right" ? "left" : "right",
        continuousWork: 0, slowStacks: 0, lazyElapsed: 0, lazyCheckInterval: undefined,
      },
    };
  }
  const local = workerAtPoint(worker, point, target);
  const u = Math.max(.4, Math.min(target.cols - .4, local.u));
  const v = Math.max(.4, Math.min(target.rows - .4, local.v));
  const source = plots.find((plot) => plot.id === origin.zoneId);
  const changedZone = origin.zoneId !== target.id;
  return {
    accepted: true, notice: null,
    worker: {
      ...worker, zoneId: target.id, u, v,
      x: target.x + (u - v) * 52 + target.rows * 52,
      y: target.y + (u + v) * 27,
      duration: 500, facing: point.x < origin.x ? "left" : "right",
      status: target.type === "living" ? (worker.mood >= 100 ? "ready" : "resting") : worker.mood <= 0 ? "exhausted" : "idle",
      lastWorkZoneId: target.type === "living" ? (source && source.type !== "living" && source.type !== "fishing" ? source.id : worker.lastWorkZoneId) : target.id,
      continuousWork: changedZone ? 0 : worker.continuousWork,
      slowStacks: changedZone ? 0 : worker.slowStacks,
      lazyElapsed: 0, lazyCheckInterval: undefined,
    },
  };
}
