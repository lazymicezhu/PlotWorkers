"use client";

/* eslint-disable @next/next/no-img-element -- Game art uses authored local bitmaps with fixed rendering behavior. */

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
  RESEARCH,
  SPECIAL_ITEM_NAMES,
  SYNTHESIS_RECIPES,
  SYNTHESIS_SELL_PRICES,
  ResearchId,
  SpecialItemId,
  SynthesisRecipeId,
  SchedulerDuty,
  SchedulerRobotState,
  STATUS_NAMES,
  WorkerState,
  ZoneId,
  ZoneType,
  buyAutoCanSupply,
  buyAutoSchedulerSupply,
  buyResearch,
  buyCans,
  buyPlot,
  buyScheduler,
  buySchedulerBot,
  buyWorker,
  changeRecipe,
  changeSynthesisRecipe,
  circleHitsPlot,
  chooseAutoDispatch,
  createInitialState,
  nextPlotPrice,
  orderCoinReward,
  parseSavedState,
  placeHolyLight,
  recyclePlot,
  schedulerBotPrice,
  sellProducts,
  submitOrder,
  togglePlotEnabled,
  toggleSchedulerDuty,
  upgradeSchedulerEfficiency,
  upgradeSchedulerInterval,
  useSpecialItem as consumeSpecialItem,
  workerPurchasePrice,
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
const PLOT_DRAG_Z = SCENE_DRAG_Z + 100_000;
const SAVE_KEY = "green-realm-save-v1";
const ZOOM_KEY = "green-realm-player-zoom";
const CAN_PURCHASE_AMOUNTS = [1, 10, 50, 200] as const;
const ZONE_META: Record<ZoneType, { name: string; subtitle: string }> = {
  gather: { name: "采集区", subtitle: "产出原料" },
  process: { name: "加工区", subtitle: "加工产品" },
  synthesis: { name: "合成区", subtitle: "合成商品" },
  living: { name: "生活区", subtitle: "恢复心情" },
};
type Panel = "process" | "synthesis" | "shop" | "sell" | "plotBuilder" | "inventory" | "orders" | "research" | null;
type PlotDraft = { plot: PlotState; valid: boolean; original: PlotState };
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
  const assetType = plot.type === "synthesis" ? "process" : plot.type;
  return <img className="plot-surface" src={`/plot-${assetType}-${plot.cols}.png`} alt="" draggable={false} />;
}, (previous, next) => previous.plot.id === next.plot.id && previous.plot.cols === next.plot.cols && previous.plot.rows === next.plot.rows && previous.plot.type === next.plot.type);

type WalkerSpriteProps = {
  worker: WorkerState;
  projected: { x: number; y: number };
  autoTransfer?: AutoTransfer;
  dragging: boolean;
  tracked: boolean;
  hovered: boolean;
  raised: boolean;
  onDown: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onEnter: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onLeave: () => void;
};

const WalkerSprite = memo(function WalkerSprite({ worker, projected, autoTransfer, dragging, tracked, hovered, raised, onDown, onEnter, onLeave }: WalkerSpriteProps) {
  const automated = Boolean(autoTransfer);
  const hasStatusBadge = worker.status === "exhausted" || worker.status === "ready" || worker.status === "slacking";
  return <div
    className={`walker ${dragging ? "is-dragging" : ""} ${automated ? "is-auto-dragging" : ""} ${autoTransfer?.action === "wake" ? "is-auto-waking" : ""} ${tracked || automated ? "is-tracked" : ""} ${hasStatusBadge ? "has-status-badge" : ""} ${hovered && !automated ? "is-paused" : ""} facing-${worker.facing}`}
    data-worker-id={worker.id}
    onPointerDown={(event) => onDown(event, worker.id)}
    onPointerEnter={(event) => onEnter(event, worker.id)}
    onPointerLeave={onLeave}
    style={{ "--worker-x": `${projected.x}px`, "--worker-y": `${projected.y}px`, zIndex: raised ? PLOT_DRAG_Z + 1 + Math.round(projected.y) : dragging || automated ? SCENE_DRAG_Z : sceneDepth(projected.y, hasStatusBadge ? 20_000 : 0), "--move-duration": `${automated ? autoTransfer!.durationMs : worker.duration}ms` } as CSSProperties}
    role="button"
    aria-label={`${worker.name}，${STATUS_NAMES[worker.status]}`}
  >
    {autoTransfer?.action === "wake" && <span className="wake-gripper" aria-hidden="true">🦾</span>}
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
  previous.hovered === next.hovered &&
  previous.raised === next.raised,
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
  const plotGrabOffset = useRef({ x: 0, y: 0 });
  const plotDraftRef = useRef<PlotDraft | null>(null);
  const placingPlotRef = useRef<{ plot: PlotState; valid: boolean } | null>(null);
  const recycleBinRef = useRef<HTMLDivElement | null>(null);
  const autoTransfersRef = useRef<AutoTransfer[]>([]);
  const autoCooldownRef = useRef<number[]>([]);
  const autoFinishTimersRef = useRef<Map<string, number>>(new Map());
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
  const [activeManager, setActiveManager] = useState<"workers" | "robots" | "plots" | null>("workers");
  const [panning, setPanning] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedProcessPlotId, setSelectedProcessPlotId] = useState<ZoneId>("process");
  const [selectedSynthesisPlotId, setSelectedSynthesisPlotId] = useState<ZoneId>("");
  const [placingHoly, setPlacingHoly] = useState(false);
  const [holyPreview, setHolyPreview] = useState<{ x: number; y: number } | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [builderType, setBuilderType] = useState<ZoneType>("gather");
  const [builderSize, setBuilderSize] = useState<4 | 8>(4);
  const [placingPlot, setPlacingPlot] = useState<{ plot: PlotState; valid: boolean } | null>(null);
  const [plotDraft, setPlotDraft] = useState<PlotDraft | null>(null);
  const [overRecycle, setOverRecycle] = useState(false);
  const [autoTransfers, setAutoTransfers] = useState<AutoTransfer[]>([]);
  const [canPurchaseIndex, setCanPurchaseIndex] = useState(1);

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
  const selectedPlotPrice = nextPlotPrice(game, builderType, builderSize);
  const selectedProcessPlot = game.plots.find((plot) => plot.id === selectedProcessPlotId && plot.type === "process");
  const selectedProcessState = selectedProcessPlot ? game.processPlots[selectedProcessPlot.id] : null;
  const selectedSynthesisPlot = game.plots.find((plot) => plot.id === selectedSynthesisPlotId && plot.type === "synthesis");
  const selectedSynthesisState = selectedSynthesisPlot ? game.synthesisPlots[selectedSynthesisPlot.id] : null;
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
      // Restore browser-only state after hydration; synchronous restoration is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGame(saved);
      setSelectedId(saved.workers[0]?.id ?? null);
    }
    const savedZoom = Number(localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(savedZoom) && savedZoom >= .28 && savedZoom <= 1.5) setZoom(savedZoom);
    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  }, [zoom]);

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
    const autoFinishTimers = autoFinishTimersRef.current;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        for (let botIndex = 0; botIndex < gameRef.current.schedulerBots; botIndex += 1) startAutoDispatch(botIndex);
      }
    }, 400);
    return () => {
      window.clearInterval(timer);
      autoFinishTimers.forEach((finishTimer) => window.clearTimeout(finishTimer));
      autoFinishTimers.clear();
    };
    // Dispatch reads current game state from refs; rerunning this timer on each render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Camera tracking is derived from the latest animated worker position.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    if (draggingIdRef.current || placingPlotRef.current || plotDraftRef.current) return;
    const worker = gameRef.current.workers.find((item) => item.id === id);
    const interruptedTransfer = autoTransfersRef.current.find((transfer) => transfer.workerId === id);
    if (!worker || (worker.status === "dragging" && !interruptedTransfer)) return;
    if (interruptedTransfer) {
      const finishTimer = autoFinishTimersRef.current.get(id);
      if (finishTimer !== undefined) window.clearTimeout(finishTimer);
      autoFinishTimersRef.current.delete(id);
      replaceAutoTransfers((transfers) => transfers.filter((transfer) => transfer.workerId !== id));
      autoCooldownRef.current[interruptedTransfer.botIndex] = 0;
    }
    const originPlot = gameRef.current.plots.find((plot) => plot.id === worker.zoneId) ?? null;
    dragOrigin.current = { ...worker, status: statusAfterDrop(worker, originPlot) };
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
    const disabled = Boolean(target && target.enabled === false);
    if (full) setNotice(`${target?.name}已达到${target ? plotCapacity(target) : 0}人上限`);
    else if (disabled) setNotice("该地块已停用，请先在地块管理中启用");
    setGame((current) => {
      const next: GameState = {
        ...current,
        workers: current.workers.map((worker) => {
          if (worker.id !== id) return worker;
          if (!moved || !origin || !target || full || disabled) return origin ? restoreWorker(origin, current.plots) : worker;
          const raw = unproject(target, point.x, point.y);
          const u = Math.max(.4, Math.min(target.cols - .4, raw.u));
          const v = Math.max(.4, Math.min(target.rows - .4, raw.v));
          const changedZone = worker.zoneId !== target.id;
          const source = current.plots.find((plot) => plot.id === origin.zoneId);
          const lastWorkZoneId = target.type === "living"
            ? (source && source.type !== "living" ? source.id : worker.lastWorkZoneId)
            : target.id;
          return { ...worker, zoneId: target.id, u, v, ...project(target, u, v), duration: 500, facing: point.x < origin.x ? "left" : "right", status: statusAfterDrop(origin, target), lastWorkZoneId, continuousWork: changedZone ? 0 : worker.continuousWork, slowStacks: changedZone ? 0 : worker.slowStacks, lazyElapsed: 0 };
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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = positionInWorld(event.clientX, event.clientY);
    plotGrabOffset.current = {
      x: point.x - (plot.x + plot.cols * TILE_W / 2),
      y: point.y - (plot.y + plot.rows * TILE_H / 2),
    };
    const draft = { plot: { ...plot }, valid: true, original: { ...plot } };
    plotDraftRef.current = draft;
    setPlotDraft(draft);
    setPanel(null);
    setNotice("拖动地块调整位置，松开完成摆放");
  }

  function pointerOverRecycle(clientX: number, clientY: number) {
    const rect = recycleBinRef.current?.getBoundingClientRect();
    return Boolean(rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
  }

  function onPlotMove(event: PointerEvent<HTMLDivElement>, plot: PlotState) {
    if (!plotDraftRef.current || plotDraftRef.current.plot.id !== plot.id) return;
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
      plotDraftRef.current ||
      placingPlotRef.current
    ) return;

    const decision = chooseAutoDispatch(
      current,
      [...autoTransfersRef.current.map((transfer) => transfer.workerId), ...(draggingIdRef.current ? [draggingIdRef.current] : [])],
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
    const durationMs = Math.max(450, Math.round((decision!.action === "wake" ? 1400 : 1800) / (robot.efficiency * (current.effects.smartLeader > 0 ? 2 : 1))));
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
      autoFinishTimersRef.current.delete(worker!.id);
    }, durationMs + 50);
    autoFinishTimersRef.current.set(worker.id, finishTimer);
  }

  function onWheel(event: WheelEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".plot, .walker, .hud, .floating-panel, .worker-manager, .confirm-panel")) return;
    event.preventDefault();
    setZoom((value) => Math.max(.28, Math.min(1.5, value * (event.deltaY > 0 ? .9 : 1.1))));
  }

  function onPanDown(event: PointerEvent<HTMLElement>) {
    if (placingHoly) {
      if ((event.target as HTMLElement).closest(".hud, .floating-panel, .worker-manager, .utility-dock, .confirm-panel")) return;
      event.preventDefault();
      event.stopPropagation();
      const point = positionInWorld(event.clientX, event.clientY);
      updateGame((current) => placeHolyLight(current, point.x, point.y));
      setPlacingHoly(false);
      setHolyPreview(null);
      setNotice("圣光洗礼已放置，持续60秒");
      return;
    }
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
    if (placingHoly) {
      setHolyPreview(positionInWorld(event.clientX, event.clientY));
      return;
    }
    if (placingPlotRef.current) return updatePlotPlacement(event.clientX, event.clientY);
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

  function toggleManager(section: "workers" | "robots" | "plots") {
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
      .filter((plot) => plot.type === "living" && plot.enabled !== false && (workerCountByPlot.get(plot.id) ?? 0) < plotCapacity(plot))
      .sort((a, b) => {
        const ratio = (workerCountByPlot.get(a.id) ?? 0) / plotCapacity(a) - (workerCountByPlot.get(b.id) ?? 0) / plotCapacity(b);
        return ratio || a.id.localeCompare(b.id);
      })[0];
    if (!living) return setNotice("生活区空间不足，请购买或腾出生活区地块");
    const u = .75 + Math.random() * Math.max(.5, living.cols - 1.5);
    const v = .75 + Math.random() * Math.max(.5, living.rows - 1.5);
    const point = project(living, u, v);
    const price = workerPurchasePrice(game.workers.length);
    spend(() => buyWorker(game, point.x, point.y, Math.random, { zoneId: living.id, u, v }), `新人物已到达${living.name}`, `金币不足，需要${price}金币`);
  }

  function activateSpecial(id: SpecialItemId) {
    if (game.inventory.specials[id] <= 0) return;
    if (id === "holyLight") {
      setPanel(null);
      setPlacingHoly(true);
      setHolyPreview(positionInWorld(viewportSize.width / 2, viewportSize.height / 2));
      setNotice("单击空白区域放置圣光洗礼");
      return;
    }
    updateGame((current) => consumeSpecialItem(current, id));
    setNotice(`${SPECIAL_ITEM_NAMES[id]}已生效120秒`);
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
    setPlacingHoly(false);
    setHolyPreview(null);
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
      className={`viewport ${panning ? "is-panning" : ""} ${placingPlot || placingHoly ? "is-placing" : ""}`}
      aria-label="2.5D 采集加工经营场景"
      onWheel={onWheel}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(1.5, value * 1.1)); if (event.key === "-") setZoom((value) => Math.max(.28, value * .9)); if (event.key === "Escape" && placingPlotRef.current) { cancelPurchasedPlot(); setNotice("已取消地块摆放"); } if (event.key === "Escape" && placingHoly) { setPlacingHoly(false); setHolyPreview(null); setNotice("已取消圣光放置"); } }}
      onPointerDown={onPanDown}
      onPointerDownCapture={placingHoly ? onPanDown : undefined}
      onPointerMove={placingHoly ? undefined : onPanMove}
      onPointerMoveCapture={placingHoly ? onPanMove : undefined}
      onPointerUp={() => setPanning(false)}
      onPointerCancel={() => setPanning(false)}
      tabIndex={0}
    >
      <header className="hud" onPointerDown={(event) => event.stopPropagation()}>
        <div className="brand-chip">Plot Workers</div>
        <Resource label="金币" value={game.coins} accent />
        <Resource label="原料" value={game.inventory.raw} warning={game.inventory.raw <= 0} />
        <Resource label="罐头" value={game.inventory.cans} warning={game.inventory.cans < 20} />
        <Resource label="粗制/精制" value={`${format(game.inventory.rough)}/${format(game.inventory.refined)}`} />
        <Resource label="螺丝/钢筋" value={`${format(game.inventory.screws)}/${format(game.inventory.rebar)}`} />
        {game.schedulerBots > 0 && <Resource label="机器人时间/数量" value={`${Math.ceil(game.schedulerSeconds)}s/${game.schedulerBots}台`} warning={game.schedulerSeconds < 60} />}
        <button className="reset-button" onClick={resetGame}>{resetArmed ? "再次点击确认" : "重新开始"}</button>
      </header>

      <div className={`world ${game.workers.length > 150 ? "is-large-population" : ""} ${game.workers.length > 300 ? "is-massive-population" : ""}`} ref={worldRef} style={{ "--zoom": zoom, "--camera-x": `${camera.x}px`, "--camera-y": `${camera.y}px` } as CSSProperties}>
        {game.effects.holyLight && <div className="ground-event holy-zone" style={{ left: game.effects.holyLight.x - 8 * 52, top: game.effects.holyLight.y - 8 * 27, width: 8 * 104, height: 8 * 54 } as CSSProperties}><span>圣光 · {Math.ceil(game.effects.holyLight.remaining)}s</span></div>}
        {placingHoly && holyPreview && <div className="ground-event holy-zone holy-preview" style={{ left: holyPreview.x - 8 * 52, top: holyPreview.y - 8 * 27, width: 8 * 104, height: 8 * 54 } as CSSProperties}><span>圣光覆盖范围 · 半径8格</span></div>}
        {visiblePlots.map((plot) => {
          const isPlacement = placingPlot?.plot.id === plot.id;
          const isMoving = plotDraft?.plot.id === plot.id;
          const valid = isPlacement ? placingPlot.valid : isMoving ? plotDraft.valid : true;
          const count = workerCountByPlot.get(plot.id) ?? 0;
          const operational = plot.enabled !== false;
          const holyBonus = operational && plot.type !== "living" && Boolean(game.effects.holyLight && circleHitsPlot(game.effects.holyLight.x, game.effects.holyLight.y, 8, plot));
          return <section
            className={`plot plot-${plot.type} ${plot.enabled === false ? "is-disabled" : ""} ${holyBonus ? "has-holy-bonus" : ""} ${hoveredPlot === plot.id ? "is-hovered" : ""} ${isPlacement ? "is-placement" : ""} ${isMoving ? "is-relocating" : ""} ${!valid ? "has-collision" : ""}`}
            key={plot.id}
            style={{ left: plot.x, top: plot.y, width: plot.cols * TILE_W, height: plot.rows * TILE_H + CUBE_DEPTH, zIndex: isMoving || isPlacement ? PLOT_DRAG_Z : undefined, "--cols": plot.cols, "--rows": plot.rows, "--plot-width": `${plot.cols * TILE_W}px`, "--plot-height": `${plot.rows * TILE_H}px` } as CSSProperties}
          >
            <div className="plot-shadow" />
            <div className="plot-base" aria-hidden="true"><span className="base-left" /><span className="base-right" /></div>
            <PlotSurface plot={plot} />
            {holyBonus && <div className="plot-bonus-effect" aria-label="当前地块加成"><div className="plot-bonus-ripples" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" /></svg><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" /></svg></div><div className="plot-bonus-labels"><span>圣光</span></div></div>}
            <div className="plot-volume-highlight" aria-hidden="true"><span className="highlight-left" /><span className="highlight-right" /><span className="highlight-top" /></div>
            {!isPlacement && <div className="plot-hit" role="button" aria-label={`${plot.name}，按住拖动地块`} onPointerEnter={() => !draggingId && setHoveredPlot(plot.id)} onPointerLeave={() => !draggingId && setHoveredPlot(null)} onPointerDown={(event) => onPlotDown(event, plot)} onPointerMove={(event) => onPlotMove(event, plot)} onPointerUp={(event) => onPlotUp(event, plot.id)} onPointerCancel={onPlotCancel} />}
            <div className="zone-sign"><strong>{plot.name}</strong><span>{plot.cols}×{plot.rows} · {count}/{plotCapacity(plot)}人{plot.enabled === false ? " · 已停用" : ""}</span></div>
            {!isPlacement && plot.type === "process" && <button className="scene-action recipe-action" onClick={() => { setSelectedProcessPlotId(plot.id); setPanel("process"); }}>配方</button>}
            {!isPlacement && plot.type === "synthesis" && <button className="scene-action recipe-action" onClick={() => { setSelectedSynthesisPlotId(plot.id); setPanel("synthesis"); }}>合成</button>}
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
          return <WalkerSprite key={worker.id} worker={worker} projected={projected} autoTransfer={autoTransfer} dragging={draggingId === worker.id} tracked={trackedId === worker.id} hovered={hoveredWorker === worker.id} raised={plotDraft?.plot.id === worker.zoneId} onDown={onWorkerDown} onEnter={pauseWorkerAtCursor} onLeave={() => { hoveredWorkerRef.current = null; setHoveredWorker(null); }} />;
        })}
        {autoTransfers.filter((transfer) => transfer.action !== "wake").map((transfer) => <div key={transfer.botIndex} className={`auto-gripper ${transfer.active ? "is-active" : ""}`} style={{ left: transfer.active ? transfer.to.x : transfer.from.x, top: (transfer.active ? transfer.to.y : transfer.from.y) - 115, zIndex: SCENE_DRAG_Z + transfer.botIndex + 1, "--robot-duration": `${transfer.durationMs}ms` } as CSSProperties}>🦾<span>{`调度机器人 ${transfer.botIndex + 1}`}</span></div>)}
      </div>

      <aside className="utility-dock" aria-label="订单与背包" onPointerDown={(event) => event.stopPropagation()}>
        <div className="dock-actions"><button onClick={() => setPanel("orders")} disabled={!game.plots.some((plot) => plot.type === "synthesis")}>订单 {game.orders.length}/2</button><button onClick={() => setPanel("inventory")}>背包 {Object.values(game.inventory.specials).reduce((sum, value) => sum + value, 0)}</button></div>
      </aside>

      <WorkerManager workers={game.workers} plots={game.plots} processPlots={game.processPlots} synthesisPlots={game.synthesisPlots} workerCounts={workerCountByPlot} selected={selectedWorker} trackedId={trackedId} activeSection={activeManager} coins={game.coins} robots={game.schedulerRobots} showRobots={game.schedulerServiceUnlocked} onSelect={trackWorker} onToggle={toggleManager} onTogglePlot={(plotId) => updateGame((current) => togglePlotEnabled(current, plotId))} onChangeProcessRecipe={(plotId, recipe) => updateGame((current) => changeRecipe(current, plotId, recipe))} onChangeSynthesisRecipe={(plotId, recipe) => updateGame((current) => changeSynthesisRecipe(current, plotId, recipe))} onToggleDuty={(index, duty) => updateGame((current) => toggleSchedulerDuty(current, index, duty))} onUpgradeEfficiency={(index) => updateGame((current) => upgradeSchedulerEfficiency(current, index))} onUpgradeInterval={(index) => updateGame((current) => upgradeSchedulerInterval(current, index))} />

      {panel && <aside className={`floating-panel ${panel === "shop" ? "shop-panel" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
        <button className="panel-close" onClick={() => { setPanel(null); cancelPurchasedPlot(); }} aria-label="关闭">×</button>
        {panel === "process" && selectedProcessPlot && selectedProcessState && <><h2>{selectedProcessPlot.name}配方</h2><p className="panel-note">这里只统计当前地块。切换配方会退回该地块批次原料，并重置该地块的生产数量。</p>{(["rough", "refined"] as const).map((recipeId) => { const recipe = RECIPES[recipeId]; return <button className={`panel-option ${selectedProcessState.recipe === recipeId ? "is-selected" : ""}`} key={recipeId} onClick={() => updateGame((current) => changeRecipe(current, selectedProcessPlot.id, recipeId))}><strong>{recipe.name}</strong><span>{recipe.raw} 原料 · {recipe.seconds}秒</span></button>; })}<div className="production-summary"><span>本地块生产的{RECIPES[selectedProcessState.recipe].name}产品</span><strong>{selectedProcessState.produced}件</strong></div></>}
        {panel === "synthesis" && selectedSynthesisPlot && selectedSynthesisState && <><h2>{selectedSynthesisPlot.name}配方</h2><p className="panel-note">人物共同贡献合成速度。切换配方会退回本批材料并重置本地块产量。</p>{(["cans", "screws", "rebar"] as SynthesisRecipeId[]).map((recipeId) => { const recipe = SYNTHESIS_RECIPES[recipeId]; const materials = Object.entries(recipe.inputs).map(([kind, amount]) => `${kind === "rough" ? "粗制" : kind === "refined" ? "精制" : "螺丝"}${amount}`).join(" + "); return <button className={`panel-option ${selectedSynthesisState.recipe === recipeId ? "is-selected" : ""}`} key={recipeId} onClick={() => updateGame((current) => changeSynthesisRecipe(current, selectedSynthesisPlot.id, recipeId))}><strong>{recipe.name} ×{recipe.output}</strong><span>{materials} · {recipe.seconds}秒</span></button>; })}<div className="production-summary"><span>本地块生产的{SYNTHESIS_RECIPES[selectedSynthesisState.recipe].name}</span><strong>{selectedSynthesisState.produced}件</strong></div></>}
        {panel === "shop" && <>
          <h2>生活商店</h2>
          <p className="panel-note">购买补给、人物和限时自动化服务。</p>
          {!game.autoCanSupply && <CanPurchaseRow selectedIndex={canPurchaseIndex} coins={game.coins} onChange={setCanPurchaseIndex} onBuy={(amount) => spend(() => buyCans(game, amount), `已购买${amount}个罐头`, "金币不足")} />}
          <AutoCanSupplyRow enabled={game.autoCanSupply} coins={game.coins} onBuy={() => spend(() => buyAutoCanSupply(game), "自动补给罐头已启用", "金币不足")} />
          <ShopRow title="随机小人" price={workerPurchasePrice(game.workers.length)} disabled={game.coins < workerPurchasePrice(game.workers.length)} onClick={buyNewWorker} />
          <ShopRow title={`自动调度服务 🦾 ×${game.schedulerBots}${game.schedulerSeconds > 0 ? ` · ${formatClock(game.schedulerSeconds)}` : ""}`} price={100} disabled={game.coins < 100} onClick={() => spend(() => buyScheduler(game), "自动调度已启用60秒", "金币不足")} />
          <AutoSchedulerSupplyRow enabled={game.autoSchedulerSupply} coins={game.coins} onBuy={() => spend(() => buyAutoSchedulerSupply(game), "自动补充调度时间已启用", "金币不足")} />
          <ShopRow title={`增加调度机器人 · 当前${game.schedulerBots}台`} price={schedulerBotPrice(game)} disabled={game.coins < schedulerBotPrice(game)} onClick={() => spend(() => buySchedulerBot(game), `已增加第${game.schedulerBots + 1}台调度机器人`, "金币不足")} />
          <ShopRow title="新地块（阶梯定价）" price={Math.min(...(["gather", "process", "synthesis", "living"] as ZoneType[]).map((type) => nextPlotPrice(game, type, 4)))} disabled={false} onClick={() => setPanel("plotBuilder")} />
          <button className="primary-action research-entry" onClick={() => setPanel("research")}>永久研究</button>
        </>}
        {panel === "plotBuilder" && <><h2>购买新地块</h2><p className="panel-note">同类型地块每购买一块，后续价格提高35%。</p><div className="builder-options">{(["gather", "process", "synthesis", "living"] as ZoneType[]).map((type) => <button key={type} className={builderType === type ? "is-selected" : ""} onClick={() => setBuilderType(type)}>{ZONE_META[type].name}</button>)}</div><div className="builder-options size-options">{([4, 8] as const).map((size) => <button key={size} className={builderSize === size ? "is-selected" : ""} onClick={() => setBuilderSize(size)}>{size}×{size}<small>{nextPlotPrice(game, builderType, size)}金币 · 容纳{size * size / 4}人</small></button>)}</div><button className="primary-action" disabled={game.coins < selectedPlotPrice} onClick={beginPlotPlacement}>购买并选择位置 · {selectedPlotPrice}金币</button>{placingPlot && <button className="cancel-placement" onClick={cancelPurchasedPlot}>取消摆放</button>}</>}
        {panel === "sell" && <><h2>出售产品</h2><div className="market-strip"><span>粗制 {game.market.roughPrice} <b className={game.market.roughPrice >= 10 ? "up" : "down"}>{Math.round((game.market.roughPrice / 10 - 1) * 100)}%</b></span><span>精制 {game.market.refinedPrice} <b className={game.market.refinedPrice >= 30 ? "up" : "down"}>{Math.round((game.market.refinedPrice / 30 - 1) * 100)}%</b></span><strong>{formatClock(marketRemaining)}</strong></div><ShopRow title={`粗加工 ×${game.inventory.rough}`} price={game.inventory.rough * game.market.roughPrice} disabled={!game.inventory.rough} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "rough"))} /><ShopRow title={`精加工 ×${game.inventory.refined}`} price={game.inventory.refined * game.market.refinedPrice} disabled={!game.inventory.refined} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "refined"))} /><ShopRow title={`螺丝 ×${game.inventory.screws}`} price={game.inventory.screws * SYNTHESIS_SELL_PRICES.screws} disabled={!game.inventory.screws} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "screws"))} /><ShopRow title={`钢筋 ×${game.inventory.rebar}`} price={game.inventory.rebar * SYNTHESIS_SELL_PRICES.rebar} disabled={!game.inventory.rebar} verb="出售" onClick={() => updateGame((current) => sellProducts(current, "rebar"))} /><button className="sell-all" disabled={!game.inventory.rough && !game.inventory.refined && !game.inventory.screws && !game.inventory.rebar} onClick={() => updateGame((current) => sellProducts(current, "all"))}>全部出售</button></>}
        {panel === "inventory" && <><h2>特殊物品背包</h2><p className="panel-note">完成订单有机会获得特殊物品。使用时机由你决定。</p>{(["canOpener", "smartLeader", "holyLight"] as SpecialItemId[]).map((id) => <div className="special-row" key={id}><span><strong>{SPECIAL_ITEM_NAMES[id]} ×{game.inventory.specials[id]}</strong><small>{id === "canOpener" ? "生活区恢复+50% · 120秒" : id === "smartLeader" ? "机器人搬运速度+100% · 120秒" : "放置半径8格圣圈，圈内采集/加工/合成效率+100%，人物不消耗心情 · 60秒"}</small></span><button disabled={game.inventory.specials[id] <= 0} onClick={() => activateSpecial(id)}>使用</button></div>)}<div className="effect-summary">生效中：罐头起子 {Math.ceil(game.effects.canOpener)}s · 智械领袖 {Math.ceil(game.effects.smartLeader)}s · 圣光 {Math.ceil(game.effects.holyLight?.remaining ?? 0)}s</div></>}
        {panel === "orders" && <><h2>工厂订单</h2><p className="panel-note">每180秒固定派发一张订单，最多同时保留2张，库存满足后由你主动交付。</p><div className="order-dispatch">{game.orders.length >= 2 ? "订单已满 · 交付一张后立即派发" : `下次订单派发还有 ${Math.ceil(180 - game.orderElapsed)} 秒`}</div>{game.orders.length ? game.orders.map((order) => { const ready = game.inventory[order.processed.kind] >= order.processed.amount && game.inventory[order.synthesized.kind] >= order.synthesized.amount; return <div className="order-card" key={order.id}><div><strong>{order.processed.kind === "rough" ? "粗制" : "精制"}×{order.processed.amount} + {order.synthesized.kind === "screws" ? "螺丝" : "钢筋"}×{order.synthesized.amount}</strong><span>{Math.ceil(order.remaining)}s · 奖励：{order.reward === "coins" ? `${format(orderCoinReward(game, order))}金币` : "随机特殊物品 ×1"}</span></div><button disabled={!ready} onClick={() => updateGame((current) => submitOrder(current, order.id))}>交付</button></div>; }) : <div className="empty-state">暂无订单</div>}</>}
        {panel === "research" && <><h2>永久研究</h2><p className="panel-note">高阶研究用于消耗后期资金，并永久保存在当前存档。</p>{(Object.keys(RESEARCH) as ResearchId[]).map((id) => { const info = RESEARCH[id]; const level = game.research[id]; const cost = info.costs[level]; return <div className="research-row" key={id}><span><strong>{info.name} · Lv.{level}/{info.costs.length}</strong><small>{id === "synthesis" ? "提高合成速度" : "提高金币订单奖励"}</small></span><button disabled={cost === undefined || game.coins < cost} onClick={() => spend(() => buyResearch(game, id), `${info.name}已升级`, "金币不足或已满级")}>{cost === undefined ? "已满级" : `${format(cost)}金币`}</button></div>; })}</>}
      </aside>}

      {placingPlot && <div className={`placement-tip ${placingPlot.valid ? "is-valid" : "is-invalid"}`}>{placingPlot.valid ? "单击放置地块 · Esc取消" : "地块发生碰撞 · Esc取消"}</div>}
      {placingHoly && <div className="placement-tip is-valid">单击空白区域放置圣光 · Esc取消</div>}
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

function WorkerManager({ workers, plots, processPlots, synthesisPlots, workerCounts, selected, trackedId, activeSection, coins, robots, showRobots, onSelect, onToggle, onTogglePlot, onChangeProcessRecipe, onChangeSynthesisRecipe, onToggleDuty, onUpgradeEfficiency, onUpgradeInterval }: {
  workers: WorkerState[];
  plots: PlotState[];
  processPlots: GameState["processPlots"];
  synthesisPlots: GameState["synthesisPlots"];
  workerCounts: Map<string, number>;
  selected: WorkerState | null;
  trackedId: string | null;
  activeSection: "workers" | "robots" | "plots" | null;
  coins: number;
  robots: SchedulerRobotState[];
  showRobots: boolean;
  onSelect: (worker: WorkerState) => void;
  onToggle: (section: "workers" | "robots" | "plots") => void;
  onTogglePlot: (plotId: ZoneId) => void;
  onChangeProcessRecipe: (plotId: ZoneId, recipe: "rough" | "refined") => void;
  onChangeSynthesisRecipe: (plotId: ZoneId, recipe: SynthesisRecipeId) => void;
  onToggleDuty: (index: number, duty: SchedulerDuty) => void;
  onUpgradeEfficiency: (index: number) => void;
  onUpgradeInterval: (index: number) => void;
}) {
  const workersOpen = activeSection === "workers";
  const robotsOpen = activeSection === "robots";
  const plotsOpen = activeSection === "plots";
  return <aside className="worker-manager" onPointerDown={(event) => event.stopPropagation()}>
    <section className={`manager-section ${workersOpen ? "is-open" : ""}`}>
    <div className="manager-head"><strong>人物管理</strong><span>{workers.length}人</span><button className="manager-toggle" onClick={() => onToggle("workers")} aria-label={workersOpen ? "缩小人物管理" : "展开人物管理"}>{workersOpen ? "缩小" : "展开"}</button></div>
    {workersOpen && <><VirtualWorkerList workers={workers} selectedId={selected?.id} trackedId={trackedId} onSelect={onSelect} />
    {selected && <div className="manager-detail"><div><strong>{selected.name}</strong><span>{PERSONALITY_NAMES[selected.personality]}</span></div><p>心情 <b>{Math.round(selected.mood)}</b></p><div className="manager-stats"><span>体力<b>{selected.stamina}</b></span><span>效率<b>{selected.efficiency}</b></span><span>精力<b>{selected.spirit}</b></span></div><small>点击人物列表可追踪其当前位置</small></div>}</>}
    </section>
    {showRobots && <section className={`manager-section robot-section ${robotsOpen ? "is-open" : ""}`}>
      <div className="manager-head"><strong>机器人管理</strong><span>{robots.length}台</span><button className="manager-toggle" onClick={() => onToggle("robots")} aria-label={robotsOpen ? "缩小机器人管理" : "展开机器人管理"}>{robotsOpen ? "缩小" : "展开"}</button></div>
      {robotsOpen && <div className="robot-management">{robots.map((robot, index) => <div className="robot-upgrade" key={index}><div><strong>机器人 {index + 1}</strong><span>效率 {Math.round(robot.efficiency * 100)}% · 间隔 {robot.intervalSeconds.toFixed(1)}s</span></div><fieldset className="robot-duties"><legend>分配职责</legend>{([['rest','送去休息'],['work','送去工作'],['wake','唤醒摸鱼']] as [SchedulerDuty,string][]).map(([duty, label]) => <label key={duty}><input type="checkbox" checked={robot.duties[duty]} onChange={() => onToggleDuty(index, duty)} /><span>{label}</span></label>)}</fieldset><button disabled={coins < 100} onClick={() => onUpgradeEfficiency(index)}>效率 +1%<small>100金币</small></button><button disabled={coins < 100 || robot.intervalSeconds <= .1} onClick={() => onUpgradeInterval(index)}>间隔 −0.1s<small>100金币</small></button></div>)}</div>}
    </section>}
    <section className={`manager-section plot-manager-section ${plotsOpen ? "is-open" : ""}`}>
      <div className="manager-head"><strong>地块管理</strong><span>{plots.length}块</span><button className="manager-toggle" onClick={() => onToggle("plots")} aria-label={plotsOpen ? "缩小地块管理" : "展开地块管理"}>{plotsOpen ? "缩小" : "展开"}</button></div>
      {plotsOpen && <div className="plot-management"><p>停用后暂停工作与机器人分配，进行中的批次会保留。</p>{(["gather", "process", "synthesis", "living"] as ZoneType[]).map((type) => { const grouped = plots.filter((plot) => plot.type === type); return <section className="plot-management-group" key={type}><h3>{ZONE_META[type].name}<span>{grouped.length}块</span></h3>{grouped.map((plot, index) => <div className={`plot-management-row ${plot.enabled === false ? "is-disabled" : ""}`} key={plot.id}><div><strong>{ZONE_META[type].name} {index + 1}</strong><small>{plot.cols}×{plot.rows} · {workerCounts.get(plot.id) ?? 0}/{plotCapacity(plot)}人</small></div>{type === "process" && <select aria-label={`${plot.name}配方`} value={processPlots[plot.id]?.recipe ?? "rough"} onChange={(event) => onChangeProcessRecipe(plot.id, event.target.value as "rough" | "refined")}><option value="rough">粗加工</option><option value="refined">精加工</option></select>}{type === "synthesis" && <select aria-label={`${plot.name}配方`} value={synthesisPlots[plot.id]?.recipe ?? "cans"} onChange={(event) => onChangeSynthesisRecipe(plot.id, event.target.value as SynthesisRecipeId)}><option value="cans">罐头</option><option value="screws">螺丝</option><option value="rebar">钢筋</option></select>}<label className="plot-enabled-toggle"><input type="checkbox" checked={plot.enabled !== false} onChange={() => onTogglePlot(plot.id)} /><span>{plot.enabled === false ? "未启用" : "已启用"}</span></label></div>)}</section>; })}</div>}
    </section>
  </aside>;
}

function ShopRow({ title, price, disabled, onClick, verb = "购买" }: { title: string; price: number; disabled: boolean; onClick: () => void; verb?: string }) {
  return <div className="shop-row"><span title={title}>{title}</span><button disabled={disabled} onClick={onClick}>{verb} · {format(price)} 金币</button></div>;
}

function CanPurchaseRow({ selectedIndex, coins, onChange, onBuy }: { selectedIndex: number; coins: number; onChange: (index: number) => void; onBuy: (amount: number) => void }) {
  const amount = CAN_PURCHASE_AMOUNTS[selectedIndex];
  const price = amount * 2;
  return <div className="can-purchase"><div className="can-purchase-control"><div className="can-purchase-head"><strong>罐头 ×{amount}</strong><span>选择数量</span></div><input aria-label="罐头购买数量" type="range" min="0" max="3" step="1" value={selectedIndex} onChange={(event) => onChange(Number(event.target.value))} /><div className="can-purchase-marks">{CAN_PURCHASE_AMOUNTS.map((value, index) => <button type="button" key={value} aria-pressed={index === selectedIndex} className={index === selectedIndex ? "is-selected" : ""} onClick={() => onChange(index)}>{value}</button>)}</div></div><button className="can-purchase-button" disabled={coins < price} onClick={() => onBuy(amount)}>购买 · {format(price)} 金币</button></div>;
}

function AutoCanSupplyRow({ enabled, coins, onBuy }: { enabled: boolean; coins: number; onBuy: () => void }) {
  const title = enabled ? "自动补给罐头 · 已启用" : "自动补给罐头 · 库存低于200";
  return <div className="shop-row auto-can-row"><span title="低于200时自动购买200个，每次花费400金币">{title}</span><button disabled={enabled || coins < 5000} onClick={onBuy}>{enabled ? "已启用" : "购买 · 5,000 金币"}</button></div>;
}

function AutoSchedulerSupplyRow({ enabled, coins, onBuy }: { enabled: boolean; coins: number; onBuy: () => void }) {
  const title = enabled ? "自动补充调度 · 已启用" : "自动补充调度 · 时间低于180s";
  return <div className="shop-row"><span title="低于180秒时自动购买180秒，每次花费300金币">{title}</span><button disabled={enabled || coins < 5000} onClick={onBuy}>{enabled ? "已启用" : "购买 · 5,000 金币"}</button></div>;
}
