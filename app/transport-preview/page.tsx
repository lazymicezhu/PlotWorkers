"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { TabletIcon } from "../tablet-icon";
import { BASE_GRID_SPEED, TRANSPORT_ACCELERATION_FRACTION, TRANSPORT_BRAKING_FRACTION, TRANSPORT_CRUISE_MULTIPLIER, createTransportMotion, gridDistance, retargetTransportMotion, sampleTransportMotion, transportDurationMs } from "../transport-motion";
import type { Point, TransportMotion } from "../transport-motion";
import styles from "./preview.module.css";

type PlotId = "work" | "rest";
type Plots = Record<PlotId, Point>;
type Trip = { motion: TransportMotion; target: PlotId; startedAt: number };
type View = { width: number; height: number };
type Drag = { pointer: number; id: PlotId; x: number; y: number; origin: Point; scale: number };
const GRID_HORIZONTAL = 52 * Math.SQRT2;
const START: Point = { x: 80, y: 250 };
const INITIAL: Plots = presetPlots(12);
const PHASES = { pickup: "抓起工人", accelerating: "线性加速", cruising: "匀速搬运", decelerating: "线性减速", landing: "放下工人", complete: "搬运完成" };
const SPEED_CHART_LINE = `M4 42 L${4 + 292 * TRANSPORT_ACCELERATION_FRACTION} 6 L${4 + 292 * (1 - TRANSPORT_BRAKING_FRACTION)} 6 L296 42`;
const pointOnPlot = (plots: Plots, id: PlotId): Point => ({ x: plots[id].x + (id === "work" ? 312 : 104), y: plots[id].y + 108 });
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
function presetPlots(distance: number): Plots {
  return { work: { ...START }, rest: { x: START.x + 208 + distance * GRID_HORIZONTAL, y: START.y } };
}
function fitView(plots: Plots, traveling?: Point): View {
  return { width: Math.max(1200, plots.work.x + 490, plots.rest.x + 490, (traveling?.x ?? 0) + 110), height: Math.max(660, plots.work.y + 330, plots.rest.y + 330, (traveling?.y ?? 0) + 170) };
}
function permittedPosition(id: PlotId, point: Point, plots: Plots, view: View): Point | null {
  const candidate = { x: Math.max(24, Math.min(view.width - 440, point.x)), y: Math.max(155, Math.min(view.height - 300, point.y)) };
  const other = plots[id === "work" ? "rest" : "work"];
  // Equal 4×4 diamond tops must not overlap; side faces do not block placement.
  return Math.abs(candidate.x - other.x) / 416 + Math.abs(candidate.y - other.y) / 216 >= 1.04 ? candidate : null;
}

export default function TransportPreview() {
  const [plots, setPlots] = useState<Plots>(INITIAL);
  const plotsRef = useRef(plots);
  const [view, setView] = useState<View>(() => fitView(INITIAL));
  const [width, setWidth] = useState(1080);
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [efficiency, setEfficiency] = useState(1);
  const efficiencyRef = useRef(1);
  const [boost, setBoost] = useState(false);
  const boostRef = useRef(false);
  const [resident, setResident] = useState<PlotId>("work");
  const residentRef = useRef<PlotId>("work");
  const tripRef = useRef<Trip | null>(null);
  const [sample, setSample] = useState<ReturnType<typeof sampleTransportMotion> | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownUntil = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("点击开始搬运，也可以先拖动地块调整距离。");
  const [dragging, setDragging] = useState<PlotId | null>(null);
  const drag = useRef<Drag | null>(null);
  const [showRoute, setShowRoute] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lastTarget, setLastTarget] = useState<PlotId>("rest");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    if (!busy && cooldown <= 0) return;
    let frame = 0;
    let disposed = false;
    function tick(now: number) {
      if (disposed) return;
      const trip = tripRef.current;
      if (trip) {
        const next = sampleTransportMotion(trip.motion, now);
        setSample(next);
        setElapsed((Math.min(now, trip.motion.completeAtMs) - trip.startedAt) / 1000);
        if (next.phase === "complete") {
          residentRef.current = trip.target;
          setResident(trip.target);
          tripRef.current = null;
          setBusy(false);
          cooldownUntil.current = trip.motion.completeAtMs + 3000;
          const remainingCooldown = Math.max(0, (cooldownUntil.current - now) / 1000);
          setCooldown(remainingCooldown);
          setMessage(`${trip.target === "rest" ? "已送到生活区" : "已送回工作区"}。${remainingCooldown > 0 ? "机器人等待 3 秒后可继续搬运。" : "机器人可以继续搬运。"}`);
        }
      } else {
        const remaining = Math.max(0, (cooldownUntil.current - now) / 1000);
        setCooldown(remaining);
        if (!remaining) return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => { disposed = true; cancelAnimationFrame(frame); };
    // A positive cooldown stays in this same animation loop until it reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, cooldown > 0]);

  const stageHeight = width < 650 ? 240 : 420;
  const scale = Math.min(width / view.width, stageHeight / view.height, .9) * zoom;
  const targetId: PlotId = resident === "work" ? "rest" : "work";
  const source = pointOnPlot(plots, resident);
  const destination = pointOnPlot(plots, busy ? lastTarget : targetId);
  const workerPoint = busy && sample ? sample.point : source;
  const routeStart = busy && sample ? sample.point : source;
  const distance = gridDistance(routeStart, destination);
  const duration = busy && sample ? sample.remainingMs : transportDurationMs(source, destination, efficiency, boost ? 2 : 1);
  const phase = busy && sample ? PHASES[sample.phase] : cooldown > 0 ? "接单间隔" : "准备就绪";
  const lifted = busy && sample && !["pickup", "landing", "complete"].includes(sample.phase);
  const currentSpeed = busy && sample ? sample.speed : 0;

  function replan(positions: Plots, nextEfficiency = efficiencyRef.current, nextBoost = boostRef.current) {
    const trip = tripRef.current;
    if (!trip) return;
    // This helper runs only from input handlers, never during render.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    // Complete on the next frame if arrival has already happened; a later plot move
    // carries its resident normally instead of reopening a completed assignment.
    trip.motion = retargetTransportMotion(trip.motion, pointOnPlot(positions, trip.target), now, nextEfficiency, nextBoost ? 2 : 1);
    setSample(sampleTransportMotion(trip.motion, now));
  }

  function updatePlots(next: Plots) {
    plotsRef.current = next;
    setPlots(next);
    replan(next);
  }

  function start() {
    // This clock read belongs to the start-button event, never to render.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (tripRef.current || now < cooldownUntil.current) return;
    const current = plotsRef.current;
    const target: PlotId = residentRef.current === "work" ? "rest" : "work";
    const motion = createTransportMotion(pointOnPlot(current, residentRef.current), pointOnPlot(current, target), now, efficiencyRef.current, boostRef.current ? 2 : 1);
    tripRef.current = { motion, target, startedAt: now };
    setLastTarget(target);
    setSample(sampleTransportMotion(motion, now));
    setElapsed(0);
    setBusy(true);
    setMessage("搬运中可以拖动目的地，机器人会从当前位置改道。");
  }

  function chooseDistance(value: number) {
    drag.current = null;
    setDragging(null);
    const next = presetPlots(value);
    updatePlots(next);
    setView(fitView(next, tripRef.current?.motion.from));
    setZoom(1);
    setMessage(tripRef.current ? "目的地已移动，剩余路程与时间已更新。" : `起落点相距 ${value} 格，点击开始比较。`);
  }

  function changeEfficiency(value: number) {
    const next = Math.max(1, Math.min(1.5, Math.round(value * 100) / 100));
    efficiencyRef.current = next;
    setEfficiency(next);
    replan(plotsRef.current, next);
  }

  function changeBoost(value: boolean) {
    boostRef.current = value;
    setBoost(value);
    replan(plotsRef.current, efficiencyRef.current, value);
  }

  function reset() {
    tripRef.current = null;
    cooldownUntil.current = 0;
    drag.current = null;
    residentRef.current = "work";
    setResident("work");
    setBusy(false);
    setCooldown(0);
    setSample(null);
    setElapsed(0);
    setDragging(null);
    updatePlots(presetPlots(12));
    setView(fitView(INITIAL));
    setZoom(1);
    changeEfficiency(1);
    changeBoost(false);
    setMessage("已重置，试试不同距离或搬运途中移动地块。");
  }

  function dragStart(event: PointerEvent<HTMLButtonElement>, id: PlotId) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, id, x: event.clientX, y: event.clientY, origin: { ...plotsRef.current[id] }, scale };
    setDragging(id);
  }

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const point = permittedPosition(current.id, { x: current.origin.x + (event.clientX - current.x) / current.scale, y: current.origin.y + (event.clientY - current.y) / current.scale }, plotsRef.current, view);
    if (point && !samePoint(point, plotsRef.current[current.id])) updatePlots({ ...plotsRef.current, [current.id]: point });
  }

  function dragEnd(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (cancel) updatePlots({ ...plotsRef.current, [current.id]: current.origin });
    else dragMove(event);
    drag.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setMessage(tripRef.current ? "地块位置已更新，机器人继续沿新路线搬运。" : "地块位置已更新，搬运时间按新的实际路线计算。");
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, id: PlotId) {
    const step = event.shiftKey ? 60 : 20;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const current = plotsRef.current;
    const point = permittedPosition(id, { x: current[id].x + delta[0], y: current[id].y + delta[1] }, current, view);
    if (point) updatePlots({ ...current, [id]: point });
  }

  function moveTarget() {
    const id = tripRef.current?.target ?? (residentRef.current === "work" ? "rest" : "work");
    const next = { ...plotsRef.current, [id]: { ...plotsRef.current[id], x: plotsRef.current[id].x + (id === "rest" ? 1 : -1) * 6 * GRID_HORIZONTAL } };
    if (next[id].x < 24) {
      next[id] = { ...plotsRef.current[id], y: plotsRef.current[id].y + 6 * 27 * Math.SQRT2 };
    }
    updatePlots(next);
    setView(fitView(next, tripRef.current?.motion.from));
    setZoom(1);
    setMessage("已把目的地移远，机器人从当前位置重新计算剩余路线。");
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/"><TabletIcon name="factory" size={19} /><span>PLOT WORKERS</span><small>搬运实验场</small></Link>
        <span className={styles.badge}><i />独立预览</span>
      </header>
      <div className={styles.intro}>
        <div><p className={styles.eyebrow}>ROBOT TRANSPORT / 01</p><h1>距离，让布局有了意义。</h1><p>抓起、加速、减速、落地。拖动地块，看看机器人如何跟上。</p></div>
        <button type="button" className={styles.reset} onClick={reset}>重置演示 <span>↺</span></button>
      </div>

      <section className={styles.sceneCard} aria-label="机器人搬运实验场">
        <div className={styles.toolbar}>
          <div className={styles.presets} role="group" aria-label="搬运距离">
            {([4, 12, 28] as const).map((value, i) => <button type="button" key={value} aria-pressed={Math.abs(gridDistance(pointOnPlot(plots, "work"), pointOnPlot(plots, "rest")) - value) < .01} onClick={() => chooseDistance(value)}>{["近距离", "中距离", "远距离"][i]}<small>{value} 格</small></button>)}
          </div>
          <label className={styles.routeToggle}><input type="checkbox" checked={showRoute} onChange={event => setShowRoute(event.target.checked)} />显示路线</label>
          <label className={styles.zoom}>视角<input aria-label="视角缩放" type="range" min=".7" max="1.25" step=".05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span></label>
        </div>

        <div className={styles.stage} ref={frameRef} style={{ height: stageHeight }}>
          <div className={styles.world} style={{ width: view.width, height: view.height, transform: `translate(-50%, -50%) scale(${scale})` }}>
            {showRoute && <svg className={styles.route} width={view.width} height={view.height} aria-hidden="true"><line x1={routeStart.x} y1={routeStart.y} x2={destination.x} y2={destination.y} /><circle cx={destination.x} cy={destination.y} r="13" /><circle cx={destination.x} cy={destination.y} r="4" /></svg>}
            {(["work", "rest"] as const).map(id => <div className={styles.plot} key={id} style={{ left: plots[id].x, top: plots[id].y }} data-dragging={dragging === id || undefined}>
              {/* Reuse the actual game artwork at its native world size. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/plot-baked-${id === "work" ? "gather" : "living"}-4.png`} alt="" draggable={false} width={416} height={275} />
              <button type="button" className={styles.plotHit} aria-label={`拖动${id === "work" ? "工作区" : "生活区"}`} onPointerDown={event => dragStart(event, id)} onPointerMove={dragMove} onPointerUp={event => dragEnd(event)} onPointerCancel={event => dragEnd(event, true)} onLostPointerCapture={() => { drag.current = null; setDragging(null); }} onKeyDown={event => nudge(event, id)} />
              <div className={styles.plotLabel}><strong>{id === "work" ? "工作区" : "生活区"}</strong><span>{busy && lastTarget === id ? "工人正在搬入" : !busy && resident === id ? "1 位工人" : "等待工人"}</span></div>
            </div>)}
            <div className={styles.worker} style={{ left: workerPoint.x, top: workerPoint.y, "--lift": lifted && !reducedMotion ? "-16px" : "0px" } as CSSProperties} data-in-flight={busy || undefined} aria-label={busy ? `机器人正在搬运工人，${phase}` : resident === "work" ? "工人在工作区" : "工人在生活区"}>
              <span className={styles.shadow} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/worker-highlight-3x.png" width={64} height={106} alt="工人" draggable={false} style={{ scale: destination.x < workerPoint.x ? "-1 1" : undefined }} />
              {busy && <div className={styles.gripper}>🦾<span>调度机器人 1</span></div>}
            </div>
          </div>
          <div className={styles.stageHint}><span>↔</span> 地块可拖动 · 搬运途中也可以</div>
          <span className={styles.phase} data-busy={busy || undefined}><i />{phase}</span>
        </div>

        <div className={styles.tripBar}>
          <div className={styles.tripStats}>
            <div><span>{busy ? "剩余路程" : "起落距离"}</span><strong>{distance.toFixed(1)}<small>格</small></strong></div>
            <div><span>{busy ? "预计剩余" : "预计搬运"}</span><strong>{(duration / 1000).toFixed(2)}<small>秒</small></strong></div>
            <div><span>当前移速</span><strong>{currentSpeed.toFixed(1)}<small>格/秒</small></strong></div>
          </div>
          <div className={styles.tripActions}>
            <button type="button" className={styles.moveTarget} onClick={moveTarget}>把目的地移远 ↗</button>
            <button type="button" className={styles.start} disabled={busy || cooldown > 0} onClick={start}><TabletIcon name="robot" size={18} />{busy ? "正在搬运" : cooldown > 0 ? `等待 ${cooldown.toFixed(1)} 秒` : resident === "work" ? "开始搬运" : "送回工作区"}</button>
          </div>
        </div>
      </section>

      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.cardTitle}><span>01 / 移动速度</span><strong>{Math.round(efficiency * 100)}<small>%</small></strong></div>
          <h2>升级机器人</h2><p>升级只提高移动速度，抓放仍需 0.3 秒。</p>
          <div className={styles.upgrade}><button type="button" aria-label="降低机器人效率" disabled={efficiency <= 1} onClick={() => changeEfficiency(efficiency - .02)}>−</button><input aria-label="机器人效率" type="range" min="1" max="1.5" step=".02" value={efficiency} onChange={event => changeEfficiency(Number(event.target.value))} /><button type="button" aria-label="升级机器人效率" disabled={efficiency >= 1.5} onClick={() => changeEfficiency(efficiency + .02)}>＋</button></div>
          <div className={styles.rangeLabels}><span>基础 100%</span><span>满级 150%</span></div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTitle}><span>02 / 道具加成</span><TabletIcon name="bolt" size={19} /></div>
          <h2>智械领袖</h2><p>移动速度 ×2，可与机器人升级叠加。</p>
          <button type="button" className={styles.boost} role="switch" aria-checked={boost} onClick={() => changeBoost(!boost)}><span><i /><b>{boost ? "加成已开启" : "开启速度加成"}</b></span><span className={styles.switch}><i /></span></button>
          <div className={styles.rangeLabels}><span>当前匀速移速</span><strong>{(BASE_GRID_SPEED * TRANSPORT_CRUISE_MULTIPLIER * efficiency * (boost ? 2 : 1)).toFixed(1)} 格/秒</strong></div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTitle}><span>03 / 运动节奏</span><span>慢 → 快 → 慢</span></div>
          <h2>更快起步，平稳减速</h2><p>前 {Math.round(TRANSPORT_ACCELERATION_FRACTION * 100)}% 加速，中间 {Math.round((1 - TRANSPORT_ACCELERATION_FRACTION - TRANSPORT_BRAKING_FRACTION) * 100)}% 匀速，后 {Math.round(TRANSPORT_BRAKING_FRACTION * 100)}% 减速。</p>
          <svg className={styles.speedChart} viewBox="0 0 300 48" role="img" aria-label="速度随时间快速线性上升，中间保持匀速，最后线性下降"><path className={styles.chartArea} d={`${SPEED_CHART_LINE} Z`} /><path className={styles.chartLine} d={SPEED_CHART_LINE} /><path className={styles.chartAxis} d="M4 43 H296" /></svg>
          <div className={styles.rangeLabels}><span>平稳起步</span><span>平稳落地</span></div>
        </section>
      </div>
      <footer className={styles.footer}><p aria-live="polite"><i />{message}</p><span>{elapsed > 0 ? `${busy ? "已搬运" : "上一趟"} ${elapsed.toFixed(2)} 秒` : `基础平均速度 ${BASE_GRID_SPEED} 格/秒 · 接单间隔 3 秒`}</span></footer>
      <p className={styles.note}>独立搬运预览，不读取或写入工坊存档。调度规则保持原样，就近调度留待传承研究。</p>
    </div>
  </main>;
}
