"use client";

import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GameState,
  INITIAL_PLOTS,
  PERSONALITY_NAMES,
  PlotState,
  RECIPES,
  SchedulerDuty,
  SchedulerRobotState,
  STATUS_NAMES,
  WorkerState,
  ZoneId,
  ZoneType,
  applyRebirth,
  buyCanOpener,
  buyCans,
  buyPlot,
  buyRebirthPotion,
  buyScheduler,
  buySchedulerBot,
  buyWorker,
  changeRecipe,
  chooseAutoDispatch,
  createInitialState,
  parseSavedState,
  plotPurchasePrice,
  recyclePlot,
  sellProducts,
  toggleSchedulerDuty,
  upgradeSchedulerEfficiency,
  upgradeSchedulerInterval,
} from "./game-engine";
import { simulateElapsed } from "./simulation-protocol";
import type { SimulationStepRequest, SimulationStepResponse } from "./simulation-protocol";
import SimulationWorker from "./simulation.worker?worker";
import { SCENE_DRAG_Z, sceneDepth } from "./scene-depth";

const TILE_W = 104;
const TILE_H = 54;
const CUBE_DEPTH = 38;
const WORLD_W = 2000;
const WORLD_H = 1080;
const SAVE_KEY = "green-realm-save-v1";
const ZONE_META: Record<ZoneType, { name: string; subtitle: string }> = {
  gather: { name: "采集区", subtitle: "产出原料" },
  process: { name: "加工区", subtitle: "加工产品" },
  living: { name: "生活区", subtitle: "恢复心情" },
};
type Panel = "process" | "shop" | "sell" | "plotBuilder" | null;
type PlotDraft = { plot: PlotState; valid: boolean; original: PlotState };
type PotionPreview = {
  workerId: string;
  next: { stamina: number; efficiency: number; spirit: number };
};
type AutoTransfer = {
  botIndex: number;
  workerId: string;
  targetId: string;
  u: number;
  v: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  active: boolean;
  durationMs: number;
  action: "rest" | "work" | "wake";
};

type PendingSimulation = {
  id: number;
  base: GameState;
  seconds: number;
};

const PlotSurface = memo(function PlotSurface({ plot }: { plot: PlotState }) {
  return <img className="plot-surface" src={`/plot-${plot.type}-${plot.cols}.png`} alt="" draggable={false} />;
}, (previous, next) => previous.plot.id === next.plot.id && previous.plot.cols === next.plot.cols && previous.plot.rows === next.plot.rows && previous.plot.type === next.plot.type);

type WalkerSpriteProps = {
  worker: WorkerState;
  projected: { x: number; y: number };
  autoTransfer?: AutoTransfer;
  dragging: boolean;
  tracked: boolean;
  hovered: boolean;
  onDown: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onEnter: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onLeave: () => void;
};

const WalkerSprite = memo(function WalkerSprite({ worker, projected, autoTransfer, dragging, tracked, hovered, onDown, onEnter, onLeave }: WalkerSpriteProps) {
  const automated = Boolean(autoTransfer);
  const hasStatusBadge = worker.status === "exhausted" || worker.status === "ready" || worker.status === "slacking";
  return <div
    className={`walker ${dragging ? "is-dragging" : ""} ${automated ? "is-auto-dragging" : ""} ${autoTransfer?.action === "wake" ? "is-auto-waking" : ""} ${tracked || automated ? "is-tracked" : ""} ${hasStatusBadge ? "has-status-badge" : ""} ${hovered && !automated ? "is-paused" : ""} facing-${worker.facing}`}
    data-worker-id={worker.id}
    onPointerDown={(event) => onDown(event, worker.id)}
    onPointerEnter={(event) => onEnter(event, worker.id)}
    onPointerLeave={onLeave}
    style={{ "--worker-x": `${projected.x}px`, "--worker-y": `${projected.y}px`, zIndex: dragging || automated ? SCENE_DRAG_Z : sceneDepth(projected.y, hasStatusBadge ? 20_000 : 0), "--move-duration": `${automated ? autoTransfer!.durationMs : worker.duration}ms` } as CSSProperties}
    role="button"
    aria-label={`${worker.name}，${STATUS_NAMES[worker.status]}`}
  >
    {hasStatusBadge && <span className={`worker-badge badge-${worker.status}`}>{worker.status === "exhausted" ? "需要休息" : worker.status === "ready" ? "可以工作" : "摸鱼中"}</span>}
    <span className="walker-shadow" />
    <img className="worker-image" src="/worker.png" alt="" draggable={false} />
  </div>;
}, (previous, next) =>
  previous.worker.id === next.worker.id &&
  previous.worker.name === next.worker.name &&
  previous.worker.status === next.worker.status &&
  previous.worker.duration === next.worker.duration &&
  previous.worker.facing === next.worker.facing &&
  previous.projected.x === next.projected.x &&
  previous.projected.y === next.projected.y &&
  previous.autoTransfer?.action === next.autoTransfer?.action &&
  previous.autoTransfer?.durationMs === next.autoTransfer?.durationMs &&
  previous.dragging === next.dragging &&
  previous.tracked === next.tracked &&
  previous.hovered === next.hovered,
);

function project(plot: PlotState, u: number, v: number) {
  return {
    x: plot.x + (u - v) * TILE_W / 2 + plot.rows * TILE_W / 2,
    y: plot.y + (u + v) * TILE_H / 2,
  };
}

function unproject(plot: PlotState, x: number, y: number) {
  const localX = x - plot.x - plot.rows * TILE_W / 2;
  const localY = y - plot.y;
  return { u: localY / TILE_H + localX / TILE_W, v: localY / TILE_H - localX / TILE_W };
}

function findPlot(plots: PlotState[], x: number, y: number) {
  return plots.find((plot) => {
    const point = unproject(plot, x, y);
    return point.u >= 0 && point.u <= plot.cols && point.v >= 0 && point.v <= plot.rows;
  }) ?? null;
}

function format(value: number) {
  return value >= 1000
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatClock(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function plotCapacity(plot: PlotState) {
  return Math.floor(plot.cols * plot.rows / 4);
}

function diamond(plot: PlotState, padding = 0) {
  const cx = plot.x + plot.cols * TILE_W / 2;
  const cy = plot.y + plot.rows * TILE_H / 2;
  const hw = plot.cols * TILE_W / 2 + padding;
  const hh = plot.rows * TILE_H / 2 + padding / 2;
  return [{ x: cx, y: cy - hh }, { x: cx + hw, y: cy }, { x: cx, y: cy + hh }, { x: cx - hw, y: cy }];
}

function polygonsOverlap(a: ReturnType<typeof diamond>, b: ReturnType<typeof diamond>) {
  const polygons = [a, b];
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const next = (index + 1) % polygon.length;
      const axis = { x: -(polygon[next].y - polygon[index].y), y: polygon[next].x - polygon[index].x };
      const projection = (points: typeof polygon) => points.map((point) => point.x * axis.x + point.y * axis.y);
      const pa = projection(a);
      const pb = projection(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function validPlotPosition(candidate: PlotState, plots: PlotState[], excludeId?: string) {
  return !plots.some((plot) => plot.id !== excludeId && polygonsOverlap(diamond(candidate), diamond(plot)));
}

function statusAfterDrop(worker: WorkerState, plot: PlotState | null) {
  if (!plot) return "idle" as const;
  if (plot.type === "living") return worker.mood >= 100 ? "ready" as const : "resting" as const;
  return worker.mood <= 0 ? "exhausted" as const : "idle" as const;
}

function restoreWorker(worker: WorkerState, plots: PlotState[]): WorkerState {
  const plot = plots.find((item) => item.id === worker.zoneId) ?? null;
  return { ...worker, status: worker.status === "dragging" ? statusAfterDrop(worker, plot) : worker.status };
}

const initialLiving = INITIAL_PLOTS.find((plot) => plot.id === "living")!;
const initialPoint = project(initialLiving, 2, 2);

export default function Home() {
  const worldRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<WorkerState | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragElementRef = useRef<HTMLDivElement | null>(null);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });
  const plotHoldTimer = useRef<number | null>(null);
  const plotHoldStart = useRef({ x: 0, y: 0 });
  const plotGrabOffset = useRef({ x: 0, y: 0 });
  const plotDraftRef = useRef<PlotDraft | null>(null);
  const placingPlotRef = useRef<{ plot: PlotState; valid: boolean } | null>(null);
  const recycleBinRef = useRef<HTMLDivElement | null>(null);
  const autoTransfersRef = useRef<AutoTransfer[]>([]);
  const autoCooldownRef = useRef<number[]>([]);
  const autoFinishTimersRef = useRef<number[]>([]);
  const movementCursorRef = useRef(0);
  const simulationWorkerRef = useRef<Worker | null>(null);
  const pendingSimulationRef = useRef<PendingSimulation | null>(null);
  const simulationRequestIdRef = useRef(0);
  const unsimulatedSecondsRef = useRef(0);
  const [game, setGame] = useState<GameState>(() => createInitialState(initialPoint.x, initialPoint.y));
  const gameRef = useRef(game);
  const [zoom, setZoom] = useState(.62);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 1440, height: 900 });
  const [hoveredPlot, setHoveredPlot] = useState<ZoneId | null>(null);
  const [hoveredWorker, setHoveredWorker] = useState<string | null>(null);
  const hoveredWorkerRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>("worker-1");
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [activeManager, setActiveManager] = useState<"workers" | "robots" | null>("workers");
  const [panning, setPanning] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedProcessPlotId, setSelectedProcessPlotId] = useState<ZoneId>("process");
  const [resetArmed, setResetArmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [builderType, setBuilderType] = useState<ZoneType>("gather");
  const [builderSize, setBuilderSize] = useState<4 | 8>(4);
  const [placingPlot, setPlacingPlot] = useState<{ plot: PlotState; valid: boolean } | null>(null);
  const [plotDraft, setPlotDraft] = useState<PlotDraft | null>(null);
  const [overRecycle, setOverRecycle] = useState(false);
  const [autoTransfers, setAutoTransfers] = useState<AutoTransfer[]>([]);
  const [potionDrag, setPotionDrag] = useState<{ x: number; y: number } | null>(null);
  const [potionPreview, setPotionPreview] = useState<PotionPreview | null>(null);

  const selectedWorker = useMemo(() => game.workers.find((worker) => worker.id === selectedId) ?? null, [game.workers, selectedId]);
  const displayPlots = useMemo(() => game.plots.map((plot) => plotDraft?.plot.id === plot.id ? plotDraft.plot : plot), [game.plots, plotDraft]);
  const displayPlotById = useMemo(() => new Map(displayPlots.map((plot) => [plot.id, plot])), [displayPlots]);
  const workerCountByPlot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const worker of game.workers) if (worker.zoneId) counts.set(worker.zoneId, (counts.get(worker.zoneId) ?? 0) + 1);
    return counts;
  }, [game.workers]);
  const autoTransferByWorker = useMemo(() => new Map(autoTransfers.map((transfer) => [transfer.workerId, transfer])), [autoTransfers]);
  const marketRemaining = 300 - game.market.elapsed;
  const selectedPlotPrice = plotPurchasePrice(builderSize);
  const selectedProcessPlot = game.plots.find((plot) => plot.id === selectedProcessPlotId && plot.type === "process");
  const selectedProcessState = selectedProcessPlot ? game.processPlots[selectedProcessPlot.id] : null;
  const visibleBounds = useMemo(() => {
    const margin = 240;
    const centerX = WORLD_W / 2 - camera.x / zoom;
    const centerY = WORLD_H / 2 - camera.y / zoom;
    return {
      left: centerX - viewportSize.width / (2 * zoom) - margin,
      right: centerX + viewportSize.width / (2 * zoom) + margin,
      top: centerY - viewportSize.height / (2 * zoom) - margin,
      bottom: centerY + viewportSize.height / (2 * zoom) + margin,
    };
  }, [camera, viewportSize, zoom]);

  useEffect(() => { gameRef.current = game; }, [game]);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker;
    try {
      worker = new SimulationWorker();
    } catch {
      return;
    }
    simulationWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SimulationStepResponse>) => {
      const pending = pendingSimulationRef.current;
      if (event.data.type !== "stepped" || !pending || event.data.id !== pending.id) return;
      startTransition(() => {
        setGame((current) => {
          pendingSimulationRef.current = null;
          if (current !== pending.base) return current;
          unsimulatedSecondsRef.current = Math.max(0, unsimulatedSecondsRef.current - pending.seconds);
          return event.data.state;
        });
      });
    };
    worker.onerror = () => {
      worker.terminate();
      if (simulationWorkerRef.current === worker) simulationWorkerRef.current = null;
      pendingSimulationRef.current = null;
    };
    return () => {
      worker.terminate();
      if (simulationWorkerRef.current === worker) simulationWorkerRef.current = null;
      pendingSimulationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const saved = parseSavedState(localStorage.getItem(SAVE_KEY));
    if (saved) {
      setGame(saved);
      setSelectedId(saved.workers[0]?.id ?? null);
    }
    const fit = Math.min(.78, (window.innerWidth - 30) / WORLD_W, (window.innerHeight - 90) / WORLD_H);
    setZoom(Math.max(.32, fit));
    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") {
        const elapsed = Math.min(5, (now - last) / 1000);
        unsimulatedSecondsRef.current = Math.min(5, unsimulatedSecondsRef.current + elapsed);
        const worker = simulationWorkerRef.current;
        if (worker && !pendingSimulationRef.current) {
          const id = ++simulationRequestIdRef.current;
          const request: SimulationStepRequest = {
            type: "step",
            id,
            state: gameRef.current,
            seconds: unsimulatedSecondsRef.current,
          };
          pendingSimulationRef.current = { id, base: gameRef.current, seconds: request.seconds };
          worker.postMessage(request);
        } else if (!worker) {
          const seconds = unsimulatedSecondsRef.current;
          startTransition(() => {
            setGame((current) => {
              unsimulatedSecondsRef.current = Math.max(0, unsimulatedSecondsRef.current - seconds);
              return simulateElapsed(current, seconds);
            });
          });
        }
      }
      last = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setGame((current) => {
        const plotsById = new Map(current.plots.map((plot) => [plot.id, plot]));
        const eligible = current.workers.filter((worker) =>
          worker.id !== draggingIdRef.current &&
          worker.id !== hoveredWorkerRef.current &&
          Boolean(worker.zoneId) &&
          worker.status !== "dragging" &&
          worker.status !== "exhausted"
        );
        if (!eligible.length) return current;
        const batchSize = current.workers.length > 300 ? 12 : current.workers.length > 150 ? 10 : 8;
        const start = movementCursorRef.current % eligible.length;
        const movingIds = new Set<string>();
        for (let index = 0; index < Math.min(batchSize, eligible.length); index += 1) {
          movingIds.add(eligible[(start + index) % eligible.length].id);
        }
        movementCursorRef.current = (start + batchSize) % eligible.length;
        return {
          ...current,
          workers: current.workers.map((worker) => {
          if (!movingIds.has(worker.id) || !worker.zoneId) return worker;
          const plot = plotsById.get(worker.zoneId);
          if (!plot) return worker;
          const u = .55 + Math.random() * (plot.cols - 1.1);
          const v = .55 + Math.random() * (plot.rows - 1.1);
          const next = project(plot, u, v);
          const speed = Math.random();
          const duration = speed < .2 ? 2400 : speed < .72 ? 5200 : 3600;
          return { ...worker, u, v, ...next, duration, facing: next.x < worker.x ? "left" : "right" };
          }),
        };
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!draggingIdRef.current && !plotDraftRef.current) localStorage.setItem(SAVE_KEY, JSON.stringify(gameRef.current));
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        for (let botIndex = 0; botIndex < gameRef.current.schedulerBots; botIndex += 1) startAutoDispatch(botIndex);
      }
    }, 400);
    return () => {
      window.clearInterval(timer);
      autoFinishTimersRef.current.forEach((finishTimer) => window.clearTimeout(finishTimer));
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!trackedId || draggingId || panning) return;
    const worker = game.workers.find((item) => item.id === trackedId);
    const plot = worker ? displayPlots.find((item) => item.id === worker.zoneId) : null;
    if (!worker) return;
    const position = plot ? project(plot, worker.u, worker.v) : { x: worker.x, y: worker.y };
    const next = { x: (WORLD_W / 2 - position.x) * zoom, y: (WORLD_H / 2 - position.y) * zoom };
    setCamera((current) => current.x === next.x && current.y === next.y ? current : next);
  }, [trackedId, draggingId, panning, game.workers, displayPlots, zoom]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    const cancelPlacement = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && placingPlotRef.current) {
        cancelPurchasedPlot();
        setNotice("已取消地块摆放");
      }
    };
    window.addEventListener("keydown", cancelPlacement);
    return () => window.removeEventListener("keydown", cancelPlacement);
  }, []);

  function updateGame(updater: (current: GameState) => GameState) {
    setGame((current) => {
      const next = updater(current);
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function positionInWorld(clientX: number, clientY: number) {
    const rect = worldRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * WORLD_W, y: (clientY - rect.top) / rect.height * WORLD_H };
  }

  function onWorkerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    event.stopPropagation();
    if (draggingIdRef.current || placingPlotRef.current || plotDraftRef.current || autoTransfersRef.current.some((transfer) => transfer.workerId === id)) return;
    const worker = gameRef.current.workers.find((item) => item.id === id);
    if (!worker || worker.status === "dragging") return;
    dragOrigin.current = { ...worker };
    dragElementRef.current = event.currentTarget;
    dragPositionRef.current = { x: worker.x, y: worker.y };
    dragStart.current = { x: event.clientX, y: event.clientY };
    draggingIdRef.current = id;
    setSelectedId(id);
    setDraggingId(id);
    setGame((current) => ({ ...current, workers: current.workers.map((item) => item.id === id ? { ...item, status: "dragging" } : item) }));
    const move = (nativeEvent: globalThis.PointerEvent) => moveWorkerDrag(nativeEvent.clientX, nativeEvent.clientY, id);
    const finishPointer = (nativeEvent: globalThis.PointerEvent) => finishWorkerDrag(nativeEvent.clientX, nativeEvent.clientY, id);
    const finishMouse = (nativeEvent: MouseEvent) => finishWorkerDrag(nativeEvent.clientX, nativeEvent.clientY, id);
    const cancel = () => onWorkerCancel(id);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("mouseup", finishMouse, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("mouseup", finishMouse, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }

  function moveWorkerDrag(clientX: number, clientY: number, id: string) {
    if (draggingIdRef.current !== id) return;
    const point = positionInWorld(clientX, clientY);
    const target = findPlot(gameRef.current.plots, point.x, point.y);
    setHoveredPlot(target?.id ?? null);
    dragPositionRef.current = point;
    const element = dragElementRef.current;
    if (element) {
      element.style.setProperty("--worker-x", `${point.x}px`);
      element.style.setProperty("--worker-y", `${point.y}px`);
      const facingLeft = point.x < (dragOrigin.current?.x ?? point.x);
      element.classList.toggle("facing-left", facingLeft);
      element.classList.toggle("facing-right", !facingLeft);
    }
  }

  function pauseWorkerAtCursor(event: PointerEvent<HTMLDivElement>, id: string) {
    if (draggingIdRef.current === id) return;
    if (gameRef.current.workers.find((worker) => worker.id === id)?.status === "dragging") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const currentPosition = positionInWorld(rect.left + rect.width / 2, rect.top + rect.height * .92);
    hoveredWorkerRef.current = id;
    setHoveredWorker(id);
    setGame((current) => ({
      ...current,
      workers: current.workers.map((worker) => {
        if (worker.id !== id) return worker;
        const plot = current.plots.find((item) => item.id === worker.zoneId);
        if (!plot) return { ...worker, ...currentPosition };
        const raw = unproject(plot, currentPosition.x, currentPosition.y);
        const u = Math.max(.4, Math.min(plot.cols - .4, raw.u));
        const v = Math.max(.4, Math.min(plot.rows - .4, raw.v));
        return { ...worker, u, v, ...project(plot, u, v) };
      }),
    }));
  }

  function finishWorkerDrag(clientX: number, clientY: number, id: string) {
    if (draggingIdRef.current !== id) return;
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    const point = positionInWorld(clientX, clientY);
    const target = findPlot(gameRef.current.plots, point.x, point.y);
    const origin = dragOrigin.current;
    const moved = Math.hypot(clientX - dragStart.current.x, clientY - dragStart.current.y) > 5;
    const full = target ? gameRef.current.workers.filter((worker) => worker.id !== id && worker.zoneId === target.id).length >= plotCapacity(target) : false;
    if (full) setNotice(`${target?.name}已达到${target ? plotCapacity(target) : 0}人上限`);
    setGame((current) => {
      const next: GameState = {
        ...current,
        workers: current.workers.map((worker) => {
          if (worker.id !== id) return worker;
          if (!moved || !origin || !target || full) return origin ? restoreWorker(origin, current.plots) : worker;
          const raw = unproject(target, point.x, point.y);
          const u = Math.max(.4, Math.min(target.cols - .4, raw.u));
          const v = Math.max(.4, Math.min(target.rows - .4, raw.v));
          const changedZone = worker.zoneId !== target.id;
          const source = current.plots.find((plot) => plot.id === origin.zoneId);
          const lastWorkZoneId = target.type === "living"
            ? (source && source.type !== "living" ? source.id : worker.lastWorkZoneId)
            : target.id;
          return { ...worker, zoneId: target.id, u, v, ...project(target, u, v), duration: 500, facing: point.x < origin.x ? "left" : "right", status: statusAfterDrop(worker, target), lastWorkZoneId, continuousWork: changedZone ? 0 : worker.continuousWork, slowStacks: changedZone ? 0 : worker.slowStacks, lazyElapsed: 0 };
        }),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      return next;
    });
    dragOrigin.current = null;
    dragElementRef.current = null;
    dragPositionRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    setHoveredPlot(null);
  }

  function onWorkerCancel(id: string) {
    if (draggingIdRef.current !== id) return;
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    const origin = dragOrigin.current;
    setGame((current) => ({ ...current, workers: current.workers.map((worker) => worker.id === id && origin ? restoreWorker(origin, current.plots) : worker) }));
    dragOrigin.current = null;
    dragElementRef.current = null;
    dragPositionRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    setHoveredPlot(null);
  }

  function onPlotDown(event: PointerEvent<HTMLDivElement>, plot: PlotState) {
    event.stopPropagation();
    if (draggingId || placingPlot) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    plotHoldStart.current = { x: event.clientX, y: event.clientY };
    plotHoldTimer.current = window.setTimeout(() => {
      const point = positionInWorld(plotHoldStart.current.x, plotHoldStart.current.y);
      plotGrabOffset.current = {
        x: point.x - (plot.x + plot.cols * TILE_W / 2),
        y: point.y - (plot.y + plot.rows * TILE_H / 2),
      };
      const draft = { plot: { ...plot }, valid: true, original: { ...plot } };
      plotDraftRef.current = draft;
      setPlotDraft(draft);
      setPanel(null);
      setNotice("拖动地块调整位置，松开完成摆放");
    }, 520);
  }

  function pointerOverRecycle(clientX: number, clientY: number) {
    const rect = recycleBinRef.current?.getBoundingClientRect();
    return Boolean(rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
  }

  function onPlotMove(event: PointerEvent<HTMLDivElement>, plot: PlotState) {
    if (!plotDraftRef.current || plotDraftRef.current.plot.id !== plot.id) {
      if (plotHoldTimer.current && Math.hypot(event.clientX - plotHoldStart.current.x, event.clientY - plotHoldStart.current.y) > 8) {
        window.clearTimeout(plotHoldTimer.current);
        plotHoldTimer.current = null;
      }
      return;
    }
    setOverRecycle(pointerOverRecycle(event.clientX, event.clientY));
    const point = positionInWorld(event.clientX, event.clientY);
    const candidate = {
      ...plot,
      x: point.x - plot.cols * TILE_W / 2 - plotGrabOffset.current.x,
      y: point.y - plot.rows * TILE_H / 2 - plotGrabOffset.current.y,
    };
    const draft = { ...plotDraftRef.current, plot: candidate, valid: validPlotPosition(candidate, gameRef.current.plots, plot.id) };
    plotDraftRef.current = draft;
    setPlotDraft(draft);
  }

  function onPlotUp(event: PointerEvent<HTMLDivElement>, plotId: string) {
    if (plotHoldTimer.current) window.clearTimeout(plotHoldTimer.current);
    plotHoldTimer.current = null;
    let draft = plotDraftRef.current;
    if (!draft || draft.plot.id !== plotId) return;
    if (pointerOverRecycle(event.clientX, event.clientY)) {
      const original = gameRef.current.plots.find((plot) => plot.id === plotId);
      if (original && gameRef.current.plots.filter((plot) => plot.type === original.type).length <= 1) {
        setNotice(`至少需要保留一个${original.name}`);
      } else if (gameRef.current.workers.some((worker) => worker.zoneId === plotId)) {
        setNotice("请先将地块上的人物移走再回收");
      } else if (original) {
        const refund = Math.floor(original.purchasePrice * .7);
        updateGame((current) => recyclePlot(current, plotId));
        setNotice(`地块已回收，返还${refund}金币`);
      }
      plotDraftRef.current = null;
      setPlotDraft(null);
      setOverRecycle(false);
      return;
    }
    const point = positionInWorld(event.clientX, event.clientY);
    const finalPlot = {
      ...draft.plot,
      x: point.x - draft.plot.cols * TILE_W / 2 - plotGrabOffset.current.x,
      y: point.y - draft.plot.rows * TILE_H / 2 - plotGrabOffset.current.y,
    };
    draft = { ...draft, plot: finalPlot, valid: validPlotPosition(finalPlot, gameRef.current.plots, plotId) };
    if (draft.valid) {
      updateGame((current) => ({
        ...current,
        plots: current.plots.map((plot) => plot.id === plotId ? draft.plot : plot),
        workers: current.workers.map((worker) => worker.zoneId === plotId ? { ...worker, ...project(draft.plot, worker.u, worker.v) } : worker),
      }));
      setNotice("地块位置已更新");
    } else setNotice("地块顶面不能与其他地块重叠");
    plotDraftRef.current = null;
    setPlotDraft(null);
    setOverRecycle(false);
  }

  function onPlotCancel() {
    if (plotHoldTimer.current) window.clearTimeout(plotHoldTimer.current);
    plotHoldTimer.current = null;
    plotDraftRef.current = null;
    setPlotDraft(null);
    setOverRecycle(false);
  }

  function beginPlotPlacement() {
    if (game.coins < selectedPlotPrice) return setNotice(`需要${selectedPlotPrice}金币`);
    const meta = ZONE_META[builderType];
    const plot: PlotState = { id: `zone-${Date.now()}`, type: builderType, name: meta.name, x: WORLD_W / 2 - builderSize * TILE_W / 2, y: WORLD_H / 2 - builderSize * TILE_H / 2, cols: builderSize, rows: builderSize, purchasePrice: selectedPlotPrice };
    const placement = { plot, valid: validPlotPosition(plot, game.plots) };
    placingPlotRef.current = placement;
    setPlacingPlot(placement);
    setPanel(null);
    setNotice("移动鼠标选择位置，单击空白处完成购买");
  }

  function updatePlotPlacement(clientX: number, clientY: number) {
    const placement = placingPlotRef.current;
    if (!placement) return;
    const point = positionInWorld(clientX, clientY);
    const plot = { ...placement.plot, x: point.x - placement.plot.cols * TILE_W / 2, y: point.y - placement.plot.rows * TILE_H / 2 };
    const next = { plot, valid: validPlotPosition(plot, gameRef.current.plots) };
    placingPlotRef.current = next;
    setPlacingPlot(next);
  }

  function placePurchasedPlot(clientX: number, clientY: number) {
    const placement = placingPlotRef.current;
    if (!placement) return;
    const point = positionInWorld(clientX, clientY);
    const plot = { ...placement.plot, x: point.x - placement.plot.cols * TILE_W / 2, y: point.y - placement.plot.rows * TILE_H / 2 };
    const valid = validPlotPosition(plot, gameRef.current.plots);
    if (!valid) {
      const invalid = { plot, valid: false };
      placingPlotRef.current = invalid;
      setPlacingPlot(invalid);
      return setNotice("这里与其他地块的顶面重叠，请换一个位置");
    }
    updateGame((current) => buyPlot(current, plot));
    placingPlotRef.current = null;
    setPlacingPlot(null);
    setPanel(null);
    setNotice("新地块购买并摆放完成");
  }

  function cancelPurchasedPlot() {
    placingPlotRef.current = null;
    setPlacingPlot(null);
  }

  function onPotionDown(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!game.inventory.potions) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPotionDrag({ x: event.clientX, y: event.clientY });
  }

  function finishPotionDrag(clientX: number, clientY: number) {
    if (!potionDrag) return;
    const workerElement = Array.from(document.querySelectorAll<HTMLElement>("[data-worker-id]")).find((element) => {
      const rect = element.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    const workerId = workerElement?.dataset.workerId;
    if (workerId) {
      setPotionPreview({ workerId, next: { stamina: 1 + Math.floor(Math.random() * 10), efficiency: 1 + Math.floor(Math.random() * 10), spirit: 1 + Math.floor(Math.random() * 10) } });
      setSelectedId(workerId);
    } else setNotice("请把药水拖到一个小人身上");
    setPotionDrag(null);
  }

  function confirmRebirth() {
    if (!potionPreview) return;
    const worker = game.workers.find((item) => item.id === potionPreview.workerId);
    if (!worker) return;
    updateGame((current) => applyRebirth(current, worker.id, potionPreview.next));
    setNotice(`属性变化：体力 ${worker.stamina}→${potionPreview.next.stamina}，效率 ${worker.efficiency}→${potionPreview.next.efficiency}，精力 ${worker.spirit}→${potionPreview.next.spirit}`);
    setPotionPreview(null);
  }

  function replaceAutoTransfers(updater: (current: AutoTransfer[]) => AutoTransfer[]) {
    const next = updater(autoTransfersRef.current);
    autoTransfersRef.current = next;
    setAutoTransfers(next);
  }

  function startAutoDispatch(botIndex: number) {
    const current = gameRef.current;
    if (
      current.schedulerSeconds <= 0 ||
      autoTransfersRef.current.some((transfer) => transfer.botIndex === botIndex) ||
      Date.now() < (autoCooldownRef.current[botIndex] ?? 0) ||
      draggingIdRef.current ||
      plotDraftRef.current ||
      placingPlotRef.current
    ) return;

    const decision = chooseAutoDispatch(
      current,
      autoTransfersRef.current.map((transfer) => transfer.workerId),
      autoTransfersRef.current.filter((transfer) => transfer.action !== "wake").map((transfer) => transfer.targetId),
      current.schedulerRobots[botIndex]?.duties,
    );
    const worker = decision ? current.workers.find((item) => item.id === decision.workerId) : undefined;
    const target = decision ? current.plots.find((plot) => plot.id === decision.targetId) : undefined;

    if (!worker || !target) {
      autoCooldownRef.current[botIndex] = Date.now() + 800;
      return;
    }
    const sourcePlot = current.plots.find((plot) => plot.id === worker.zoneId);
    const from = sourcePlot ? project(sourcePlot, worker.u, worker.v) : { x: worker.x, y: worker.y };
    const u = decision!.action === "wake" ? worker.u : .75 + Math.random() * Math.max(.5, target.cols - 1.5);
    const v = decision!.action === "wake" ? worker.v : .75 + Math.random() * Math.max(.5, target.rows - 1.5);
    const to = project(target, u, v);
    const robot = current.schedulerRobots[botIndex] ?? { efficiency: 1, intervalSeconds: 3, duties: { rest: true, work: true, wake: true } };
    const durationMs = Math.max(450, Math.round((decision!.action === "wake" ? 1400 : 1800) / robot.efficiency));
    const transfer: AutoTransfer = { botIndex, workerId: worker.id, targetId: target.id, u, v, from, to, active: false, durationMs, action: decision!.action };
    setGame((state) => ({ ...state, workers: state.workers.map((item) => item.id === worker!.id ? { ...item, status: "dragging" } : item) }));
    replaceAutoTransfers((transfers) => [...transfers, transfer]);
    window.requestAnimationFrame(() => replaceAutoTransfers((transfers) => transfers.map((value) => value.workerId === worker!.id ? { ...value, active: true } : value)));
    const finishTimer = window.setTimeout(() => {
      setGame((state) => {
        const destination = state.plots.find((plot) => plot.id === target!.id);
        const source = state.plots.find((plot) => plot.id === worker!.zoneId);
        if (!destination) return state;
        const next: GameState = {
          ...state,
          workers: state.workers.map((item) => item.id === worker!.id ? {
            ...item,
            zoneId: destination.id,
            u,
            v,
            ...project(destination, u, v),
            status: statusAfterDrop(item, destination),
            duration: 500,
            lastWorkZoneId: destination.type === "living"
              ? (source && source.type !== "living" ? source.id : item.lastWorkZoneId)
              : destination.id,
            continuousWork: 0,
            slowStacks: 0,
            lazyElapsed: 0,
          } : item),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(next));
        return next;
      });
      replaceAutoTransfers((transfers) => transfers.filter((value) => value.workerId !== worker!.id));
      autoCooldownRef.current[botIndex] = Date.now() + robot.intervalSeconds * 1000;
      autoFinishTimersRef.current = autoFinishTimersRef.current.filter((value) => value !== finishTimer);
    }, durationMs + 50);
    autoFinishTimersRef.current.push(finishTimer);
  }

  function onWheel(event: WheelEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".plot, .walker, .hud, .floating-panel, .worker-manager, .confirm-panel")) return;
    event.preventDefault();
    setZoom((value) => Math.max(.28, Math.min(1.5, value * (event.deltaY > 0 ? .9 : 1.1))));
  }

  function onPanDown(event: PointerEvent<HTMLElement>) {
    if (placingPlotRef.current) {
      event.preventDefault();
      placePurchasedPlot(event.clientX, event.clientY);
      return;
    }
    if (event.button !== 0 || (event.target as HTMLElement).closest(".plot, .walker, .hud, .floating-panel, .worker-manager, .confirm-panel")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panOrigin.current = { clientX: event.clientX, clientY: event.clientY, ...camera };
    setTrackedId(null);
    setPanning(true);
  }

  function onPanMove(event: PointerEvent<HTMLElement>) {
    if (placingPlotRef.current) return updatePlotPlacement(event.clientX, event.clientY);
    if (potionDrag) return setPotionDrag({ x: event.clientX, y: event.clientY });
    if (!panning) return;
    setCamera({ x: panOrigin.current.x + event.clientX - panOrigin.current.clientX, y: panOrigin.current.y + event.clientY - panOrigin.current.clientY });
  }

  function trackWorker(worker: WorkerState) {
    setSelectedId(worker.id);
    setTrackedId(worker.id);
    const plot = displayPlots.find((item) => item.id === worker.zoneId);
    const position = plot ? project(plot, worker.u, worker.v) : { x: worker.x, y: worker.y };
    setCamera({ x: (WORLD_W / 2 - position.x) * zoom, y: (WORLD_H / 2 - position.y) * zoom });
  }

  function toggleManager(section: "workers" | "robots") {
    if (section === "robots" || activeManager === "workers") setTrackedId(null);
    setActiveManager((current) => current === section ? null : section);
  }

  function spend(action: () => GameState, success: string, failure: string) {
    const next = action();
    if (next === game) setNotice(failure);
    else { updateGame(() => next); setNotice(success); }
  }

  function buyNewWorker() {
    const living = [...game.plots]
      .filter((plot) => plot.type === "living" && (workerCountByPlot.get(plot.id) ?? 0) < plotCapacity(plot))
      .sort((a, b) => {
        const ratio = (workerCountByPlot.get(a.id) ?? 0) / plotCapacity(a) - (workerCountByPlot.get(b.id) ?? 0) / plotCapacity(b);
        return ratio || a.id.localeCompare(b.id);
      })[0];
    if (!living) return setNotice("生活区空间不足，请购买或腾出生活区地块");
    const u = .75 + Math.random() * Math.max(.5, living.cols - 1.5);
    const v = .75 + Math.random() * Math.max(.5, living.rows - 1.5);
    const point = project(living, u, v);
    spend(() => buyWorker(game, point.x, point.y, Math.random, { zoneId: living.id, u, v }), `新人物已到达${living.name}`, "金币不足");
  }

  function resetGame() {
    if (!resetArmed) {
      setResetArmed(true);
      window.setTimeout(() => setResetArmed(false), 3000);
      return;
    }
    const fresh = createInitialState(initialPoint.x, initialPoint.y);
    localStorage.setItem(SAVE_KEY, JSON.stringify(fresh));
    setGame(fresh);
    setSelectedId("worker-1");
    setPanel(null);
    setResetArmed(false);
  }

  const renderedPlots = placingPlot ? [...displayPlots, placingPlot.plot] : displayPlots;
  const visiblePlots = renderedPlots.filter((plot) => {
    if (plot.id === placingPlot?.plot.id || plot.id === plotDraft?.plot.id) return true;
    const plotWidth = plot.cols * TILE_W;
    const plotHeight = plot.rows * TILE_H + CUBE_DEPTH;
    return plot.x + plotWidth >= visibleBounds.left && plot.x <= visibleBounds.right && plot.y + plotHeight >= visibleBounds.top && plot.y <= visibleBounds.bottom;
  });
  const visibleWorkers = game.workers.filter((worker) => {
    if (worker.id === draggingId || worker.id === trackedId || worker.id === hoveredWorker || autoTransferByWorker.has(worker.id)) return true;
    const plot = worker.zoneId ? displayPlotById.get(worker.zoneId) : undefined;
    const point = plot ? project(plot, worker.u, worker.v) : { x: worker.x, y: worker.y };
    return point.x >= visibleBounds.left && point.x <= visibleBounds.right && point.y >= visibleBounds.top && point.y <= visibleBounds.bottom;
  });

  return (
    <main
      className={`viewport ${panning ? "is-panning" : ""} ${placingPlot ? "is-placing" : ""}`}
      aria-label="2.5D 采集加工经营场景"
      onWheel={onWheel}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(1.5, value * 1.1)); if (event.key === "-") setZoom((value) => Math.max(.28, value * .9)); if (event.key === "Escape" && placingPlotRef.current) { cancelPurchasedPlot(); setNotice("已取消地块摆放"); } }}
      onPointerDown={onPanDown}
      onPointerMove={onPanMove}
      onPointerUp={(event) => { setPanning(false); if (potionDrag) finishPotionDrag(event.clientX, event.clientY); }}
      onPointerCancel={() => { setPanning(false); setPotionDrag(null); }}
      tabIndex={0}
    >
      <header className="hud" onPointerDown={(event) => event.stopPropagation()}>
        <div className="brand-chip">绿野工坊</div>
        <Resource label="金币" value={game.coins} accent />
        <Resource label="原料" value={game.inventory.raw} warning={game.inventory.raw < 500} />
        <Resource label="罐头" value={game.inventory.cans} warning={game.inventory.cans < 20} />
        <Resource label="粗制/精制" value={`${format(game.inventory.rough)}/${format(game.inventory.refined)}`} />
        <Resource label="机器人时间/数量" value={`${Math.ceil(game.schedulerSeconds)}s/${game.schedulerBots}台`} warning={game.schedulerSeconds < 60} />
        <button className="reset-button" onClick={resetGame}>{resetArmed ? "再次点击确认" : "重新开始"}</button>
      </header>

      <div className={`world ${game.workers.length > 150 ? "is-large-population" : ""} ${game.workers.length > 300 ? "is-massive-population" : ""}`} ref={worldRef} style={{ "--zoom": zoom, "--camera-x": `${camera.x}px`, "--camera-y": `${camera.y}px` } as CSSProperties}>
        {visiblePlots.map((plot) => {
          const isPlacement = placingPlot?.plot.id === plot.id;
          const isMoving = plotDraft?.plot.id === plot.id;
          const valid = isPlacement ? placingPlot.valid : isMoving ? plotDraft.valid : true;
          const count = workerCountByPlot.get(plot.id) ?? 0;
          return <section
            className={`plot plot-${plot.type} ${hoveredPlot === plot.id ? "is-hovered" : ""} ${isPlacement ? "is-placement" : ""} ${isMoving ? "is-relocating" : ""} ${!valid ? "has-collision" : ""}`}
            key={plot.id}
            style={{ left: plot.x, top: plot.y, width: plot.cols * TILE_W, height: plot.rows * TILE_H + CUBE_DEPTH, "--cols": plot.cols, "--rows": plot.rows, "--plot-width": `${plot.cols * TILE_W}px`, "--plot-height": `${plot.rows * TILE_H}px` } as CSSProperties}
          >
            <div className="plot-shadow" />
            <div className="plot-base" aria-hidden="true"><span className="base-left" /><span className="base-right" /></div>
            <PlotSurface plot={plot} />
            <div className="plot-volume-highlight" aria-hidden="true"><span className="highlight-left" /><span className="highlight-right" /><span className="highlight-top" /></div>
            {!isPlacement && <div className="plot-hit" role="button" aria-label={`${plot.name}，长按移动地块`} onPointerEnter={() => !draggingId && setHoveredPlot(plot.id)} onPointerLeave={() => !draggingId && setHoveredPlot(null)} onPointerDown={(event) => onPlotDown(event, plot)} onPointerMove={(event) => onPlotMove(event, plot)} onPointerUp={(event) => onPlotUp(event, plot.id)} onPointerCancel={onPlotCancel} />}
            <div className="zone-sign"><strong>{plot.name}</strong><span>{plot.cols}×{plot.rows} · {count}/{plotCapacity(plot)}人</span></div>
            {!isPlacement && plot.type === "process" && <button className="scene-action recipe-action" onClick={() => { setSelectedProcessPlotId(plot.id); setPanel("process"); }}>配方</button>}
            {!isPlacement && plot.type === "living" && <><button className="scene-action shop-action" onClick={() => setPanel("shop")}>商店</button><button className="scene-action sell-action" onClick={() => setPanel("sell")}>出售</button></>}
          </section>;
        })}

        {visibleWorkers.map((worker) => {
          const plot = worker.zoneId ? displayPlotById.get(worker.zoneId) : undefined;
          const autoTransfer = autoTransferByWorker.get(worker.id);
          const automated = Boolean(autoTransfer);
          const projected = automated
            ? (autoTransfer!.active ? autoTransfer!.to : autoTransfer!.from)
            : draggingId === worker.id
            ? (dragPositionRef.current ?? { x: worker.x, y: worker.y })
            : !plot
              ? { x: worker.x, y: worker.y }
              : project(plot, worker.u, worker.v);
          return <WalkerSprite key={worker.id} worker={worker} projected={projected} autoTransfer={autoTransfer} dragging={draggingId === worker.id} tracked={trackedId === worker.id} hovered={hoveredWorker === worker.id} onDown={onWorkerDown} onEnter={pauseWorkerAtCursor} onLeave={() => { hoveredWorkerRef.current = null; setHoveredWorker(null); }} />;
        })}
        {autoTransfers.map((transfer) => <div key={transfer.botIndex} className={`auto-gripper ${transfer.active ? "is-active" : ""} ${transfer.action === "wake" ? "is-waking" : ""}`} style={{ left: transfer.active ? transfer.to.x : transfer.from.x, top: transfer.active ? transfer.to.y - 115 : transfer.from.y - 115, zIndex: SCENE_DRAG_Z + transfer.botIndex + 1, "--robot-duration": `${transfer.durationMs}ms` } as CSSProperties}>🦾<span>{transfer.action === "wake" ? "唤醒摸鱼" : `调度机器人 ${transfer.botIndex + 1}`}</span></div>)}
      </div>

      <WorkerManager workers={game.workers} selected={selectedWorker} trackedId={trackedId} activeSection={activeManager} potions={game.inventory.potions} coins={game.coins} robots={game.schedulerRobots} onSelect={trackWorker} onToggle={toggleManager} onToggleDuty={(index, duty) => updateGame((current) => toggleSchedulerDuty(current, index, duty))} onUpgradeEfficiency={(index) => updateGame((current) => upgradeSchedulerEfficiency(current, index))} onUpgradeInterval={(index) => updateGame((current) => upgradeSchedulerInterval(current, index))} onPotionDown={onPotionDown} />

      {panel && <aside className={`floating-panel ${panel === "shop" ? "shop-panel" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
        <button className="panel-close" onClick={() => { setPanel(null); cancelPurchasedPlot(); }} aria-label="关闭">×</button>
        {panel === "process" && selectedProcessPlot && selectedProcessState && <><h2>{selectedProcessPlot.name}配方</h2><p className="panel-note">这里只统计当前地块。切换配方会退回该地块批次原料，并重置该地块的生产数量。</p>{(["rough", "refined"] as const).map((recipeId) => { const recipe = RECIPES[recipeId]; return <button className={`panel-option ${selectedProcessState.recipe === recipeId ? "is-selected" : ""}`} key={recipeId} onClick={() => updateGame((current) => changeRecipe(current, selectedProcessPlot.id, recipeId))}><strong>{recipe.name}</strong><span>{recipe.raw} 原料 · {recipe.seconds}秒</span></button>; })}<div className="production-summary"><span>本地块生产的{RECIPES[selectedProcessState.recipe].name}产品</span><strong>{selectedProcessState.produced}件</strong></div></>}
        {panel === "shop" && <><h2>生活商店</h2><p className="panel-note">购买补给、人物和限时自动化服务。</p><ShopRow title="罐头 ×1" price={2} disabled={game.coins < 2} onClick={() => spend(() => buyCans(game, 1), "已购买罐头", "金币不足")} /><ShopRow title="罐头 ×10" price={20} disabled={game.coins < 20} onClick={() => spend(() => buyCans(game, 10), "已购买10个罐头", "金币不足")} /><ShopRow title={`罐头起子 🥫${game.canOpenerSeconds > 0 ? ` · 生效${Math.ceil(game.canOpenerSeconds)}s` : game.canOpenerCooldown > 0 ? ` · 冷却${Math.ceil(game.canOpenerCooldown)}s` : ""}`} price={300} disabled={game.coins < 300 || game.canOpenerCooldown > 0} onClick={() => spend(() => buyCanOpener(game), "生活区心情恢复速度提升50%，持续60秒", game.canOpenerCooldown > 0 ? "罐头起子仍在五分钟冷却中" : "金币不足")} /><ShopRow title="随机小人" price={100} disabled={game.coins < 100} onClick={buyNewWorker} /><ShopRow title="重生药水 🧪" price={200} disabled={game.coins < 200} onClick={() => spend(() => buyRebirthPotion(game), "药水已放入人物管理栏", "金币不足")} /><ShopRow title={`自动调度服务 🦾 ×${game.schedulerBots}${game.schedulerSeconds > 0 ? ` · ${formatClock(game.schedulerSeconds)}` : ""}`} price={100} disabled={game.coins < 100} onClick={() => spend(() => buyScheduler(game), "自动调度已启用60秒", "金币不足")} /><ShopRow title={`增加调度机器人 · 当前${game.schedulerBots}台`} price={1000} disabled={game.coins < 1000} onClick={() => spend(() => buySchedulerBot(game), `已增加第${game.schedulerBots + 1}台调度机器人`, "金币不足")} /><ShopRow title="新地块（起）" price={300} disabled={game.coins < 300} onClick={() => setPanel("plotBuilder")} /></>}
        {panel === "plotBuilder" && <><h2>购买新地块</h2><p className="panel-note">4×4为300金币，8×8为1200金币。</p><div className="builder-options">{(["gather", "process", "living"] as ZoneType[]).map((type) => <button key={type} className={builderType === type ? "is-selected" : ""} onClick={() => setBuilderType(type)}>{ZONE_META[type].name}</button>)}</div><div className="builder-options size-options">{([4, 8] as const).map((size) => <button key={size} className={builderSize === size ? "is-selected" : ""} onClick={() => setBuilderSize(size)}>{size}×{size}<small>{plotPurchasePrice(size)}金币 · 容纳{size * size / 4}人</small></button>)}</div><button className="primary-action" disabled={game.coins < selectedPlotPrice} onClick={beginPlotPlacement}>购买并选择位置 · {selectedPlotPrice}金币</button>{placingPlot && <button className="cancel-placement" onClick={cancelPurchasedPlot}>取消摆放</button>}</>}
        {panel === "sell" && <><h2>出售产品</h2><div className="market-strip"><span>粗制 {game.market.roughPrice} <b className={game.market.roughPrice >= 10 ? "up" : "down"}>{Math.round((game.market.roughPrice / 10 - 1) * 100)}%</b></span><span>精制 {game.market.refinedPrice} <b className={game.market.refinedPrice >= 30 ? "up" : "down"}>{Math.round((game.market.refinedPrice / 30 - 1) * 100)}%</b></span><strong>{formatClock(marketRemaining)}</strong></div><p className="panel-note">价格涨幅与下次刷新倒计时</p><ShopRow title={`粗加工 ×${game.inventory.rough}`} price={game.inventory.rough * game.market.roughPrice} disabled={!game.inventory.rough} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "rough"))} /><ShopRow title={`精加工 ×${game.inventory.refined}`} price={game.inventory.refined * game.market.refinedPrice} disabled={!game.inventory.refined} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "refined"))} /><button className="sell-all" disabled={!game.inventory.rough && !game.inventory.refined} onClick={() => updateGame((current) => sellProducts(current, "all"))}>全部出售</button></>}
      </aside>}

      {potionDrag && <div className="potion-drag" style={{ left: potionDrag.x, top: potionDrag.y }}>🧪</div>}
      {potionPreview && <RebirthConfirm worker={game.workers.find((worker) => worker.id === potionPreview.workerId)!} next={potionPreview.next} onCancel={() => setPotionPreview(null)} onConfirm={confirmRebirth} />}
      {placingPlot && <div className={`placement-tip ${placingPlot.valid ? "is-valid" : "is-invalid"}`}>{placingPlot.valid ? "单击放置地块 · Esc取消" : "地块发生碰撞 · Esc取消"}</div>}
      {plotDraft && <div ref={recycleBinRef} className={`recycle-bin ${overRecycle ? "is-over" : ""}`}><span>♻️</span><strong>拖到这里回收</strong><small>返还购买价70%</small></div>}
      {notice && <div className={`notice ${plotDraft ? "is-above-recycle" : ""}`}>{notice}</div>}
    </main>
  );
}

function Resource({ label, value, accent = false, warning = false }: { label: string; value: number | string; accent?: boolean; warning?: boolean }) {
  return <div className={`resource ${accent ? "is-accent" : ""} ${warning ? "is-warning" : ""}`}><span>{label}</span><strong>{typeof value === "number" ? format(value) : value}</strong></div>;
}

const WORKER_ROW_HEIGHT = 52;

function VirtualWorkerList({ workers, selectedId, trackedId, onSelect }: { workers: WorkerState[]; selectedId?: string; trackedId: string | null; onSelect: (worker: WorkerState) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / WORKER_ROW_HEIGHT) - 3);
  const end = Math.min(workers.length, start + 13);
  return <div className="worker-list" style={{ height: Math.min(290, workers.length * WORKER_ROW_HEIGHT + 12) }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="worker-list-inner" style={{ height: workers.length * WORKER_ROW_HEIGHT }}>
      {workers.slice(start, end).map((worker, offset) => <button key={worker.id} style={{ top: (start + offset) * WORKER_ROW_HEIGHT, "--mood": `${worker.mood}%` } as CSSProperties} className={selectedId === worker.id ? "is-selected" : ""} onClick={() => onSelect(worker)}><i /><span><strong>{worker.name}{trackedId === worker.id ? " · 追踪中" : ""}</strong><small>{STATUS_NAMES[worker.status]}</small></span><b>{Math.round(worker.mood)}</b></button>)}
    </div>
  </div>;
}

function WorkerManager({ workers, selected, trackedId, activeSection, potions, coins, robots, onSelect, onToggle, onToggleDuty, onUpgradeEfficiency, onUpgradeInterval, onPotionDown }: { workers: WorkerState[]; selected: WorkerState | null; trackedId: string | null; activeSection: "workers" | "robots" | null; potions: number; coins: number; robots: SchedulerRobotState[]; onSelect: (worker: WorkerState) => void; onToggle: (section: "workers" | "robots") => void; onToggleDuty: (index: number, duty: SchedulerDuty) => void; onUpgradeEfficiency: (index: number) => void; onUpgradeInterval: (index: number) => void; onPotionDown: (event: PointerEvent<HTMLButtonElement>) => void }) {
  const workersOpen = activeSection === "workers";
  const robotsOpen = activeSection === "robots";
  return <aside className="worker-manager" onPointerDown={(event) => event.stopPropagation()}>
    <section className={`manager-section ${workersOpen ? "is-open" : ""}`}>
    <div className="manager-head"><strong>人物管理</strong><span>{workers.length}人</span><button className="manager-toggle" onClick={() => onToggle("workers")} aria-label={workersOpen ? "缩小人物管理" : "展开人物管理"}>{workersOpen ? "缩小" : "展开"}</button></div>
    {workersOpen && <>{potions > 0 && <button className="potion-token" onPointerDown={onPotionDown} aria-label="拖动重生药水到人物">🧪<span>×{potions} 拖到人物</span></button>}
    <VirtualWorkerList workers={workers} selectedId={selected?.id} trackedId={trackedId} onSelect={onSelect} />
    {selected && <div className="manager-detail"><div><strong>{selected.name}</strong><span>{PERSONALITY_NAMES[selected.personality]}</span></div><p>心情 <b>{Math.round(selected.mood)}</b></p><div className="manager-stats"><span>体力<b>{selected.stamina}</b></span><span>效率<b>{selected.efficiency}</b></span><span>精力<b>{selected.spirit}</b></span></div><small>点击人物列表可追踪其当前位置</small></div>}</>}
    </section>
    <section className={`manager-section robot-section ${robotsOpen ? "is-open" : ""}`}>
      <div className="manager-head"><strong>机器人管理</strong><span>{robots.length}台</span><button className="manager-toggle" onClick={() => onToggle("robots")} aria-label={robotsOpen ? "缩小机器人管理" : "展开机器人管理"}>{robotsOpen ? "缩小" : "展开"}</button></div>
      {robotsOpen && <div className="robot-management">{robots.map((robot, index) => <div className="robot-upgrade" key={index}><div><strong>机器人 {index + 1}</strong><span>效率 {Math.round(robot.efficiency * 100)}% · 间隔 {robot.intervalSeconds.toFixed(1)}s</span></div><fieldset className="robot-duties"><legend>分配职责</legend>{([['rest','送去休息'],['work','送去工作'],['wake','唤醒摸鱼']] as [SchedulerDuty,string][]).map(([duty, label]) => <label key={duty}><input type="checkbox" checked={robot.duties[duty]} onChange={() => onToggleDuty(index, duty)} /><span>{label}</span></label>)}</fieldset><button disabled={coins < 100} onClick={() => onUpgradeEfficiency(index)}>效率 +1%<small>100金币</small></button><button disabled={coins < 100 || robot.intervalSeconds <= .1} onClick={() => onUpgradeInterval(index)}>间隔 −0.1s<small>100金币</small></button></div>)}</div>}
    </section>
  </aside>;
}

function RebirthConfirm({ worker, next, onCancel, onConfirm }: { worker: WorkerState; next: { stamina: number; efficiency: number; spirit: number }; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-backdrop" onPointerDown={(event) => event.stopPropagation()}><section className="confirm-panel"><div className="potion-large">🧪</div><h2>确认让 {worker.name} 重生？</h2><p>性格、心情和工作归属保持不变。</p><div className="attribute-compare"><span>体力 <b>{worker.stamina}</b> → <strong>{next.stamina}</strong></span><span>效率 <b>{worker.efficiency}</b> → <strong>{next.efficiency}</strong></span><span>精力 <b>{worker.spirit}</b> → <strong>{next.spirit}</strong></span></div><div className="confirm-actions"><button onClick={onCancel}>取消</button><button className="confirm" onClick={onConfirm}>确定使用</button></div></section></div>;
}

function ShopRow({ title, price, disabled, onClick, verb = "购买" }: { title: string; price: number; disabled: boolean; onClick: () => void; verb?: string }) {
  return <div className="shop-row"><span title={title}>{title}</span><button disabled={disabled} onClick={onClick}>{verb} · {format(price)} 金币</button></div>;
}
