"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { useButtonFeedback } from "../use-button-feedback";
import styles from "./preview.module.css";

const DRAFT_KEY = "plot-workers-button-position-preview-v1";
const LIMIT = 160;
type Offset = { x: number; y: number };
type Drag = { pointerId: number; x: number; y: number; start: Offset; scale: number };
const DEFAULT: Offset = { x: 0, y: 0 };
const clamp = (value: number) => Math.max(-LIMIT, Math.min(LIMIT, Math.round(value)));
const signed = (value: number) => value > 0 ? `+${value}` : String(value);

function OffsetInput({ value, label, disabled, onChange }: { value: number; label: string; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label={label} type="number" min={-LIMIT} max={LIMIT} step={1}
    value={draft ?? value} disabled={disabled}
    onFocus={() => setDraft(String(value))}
    onChange={event => {
      setDraft(event.target.value);
      if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
    }}
    onBlur={() => setDraft(null)}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
  />;
}

export default function ButtonPositionPreview() {
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [offset, setOffset] = useState<Offset>(DEFAULT);
  const [size, setSize] = useState<4 | 8>(8);
  const [type, setType] = useState<"process" | "synthesis">("process");
  const [frameWidth, setFrameWidth] = useState(900);
  const [guides, setGuides] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState("");
  useButtonFeedback(root);

  useEffect(() => {
    let next = DEFAULT;
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (raw && typeof raw === "object" && "x" in raw && "y" in raw &&
        typeof raw.x === "number" && Number.isFinite(raw.x) &&
        typeof raw.y === "number" && Number.isFinite(raw.y)) {
        next = { x: clamp(raw.x), y: clamp(raw.y) };
      }
    } catch { /* A missing or invalid preview draft starts at the game's position. */ }
    // Hydrate a browser-only draft after the identical server/client first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(next);
    setReady(true);
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = size * 104;
  const topHeight = size * 54;
  const imageHeight = Math.ceil((topHeight + 38) * 1.08);
  const worldWidth = plotWidth + 360;
  const worldHeight = imageHeight + 144;
  const scale = Math.min(1, Math.max(0.15, (frameWidth - 32) / worldWidth));
  const label = type === "process" ? "配方" : "合成";

  function update(next: Offset) {
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return;
    const normalized = { x: clamp(next.x), y: clamp(next.y) };
    setOffset(normalized);
    setMessage("");
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(normalized));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || !ready || !world.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      start: offset, scale: world.current.getBoundingClientRect().width / worldWidth,
    };
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    update({
      x: current.start.x + (event.clientX - current.x) / current.scale,
      y: current.start.y + (event.clientY - current.y) / current.scale,
    });
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (cancel) update(current.start);
    else moveDrag(event);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 10 : 1;
    const direction = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!direction || !ready) return;
    event.preventDefault();
    update({ x: offset.x + direction[0], y: offset.y + direction[1] });
  }

  async function copyPosition() {
    const text = `地块按钮位置（配方、合成；4×4、8×8 共用）：相对预览初始位置，水平 ${signed(offset.x)}px，垂直 ${signed(offset.y)}px。right: ${10 - offset.x}px；top: calc(var(--plot-height) / 2 + ${offset.y}px)；translate: 0 -50%。`;
    try {
      await navigator.clipboard.writeText(text);
      setMessage("位置已复制，可以直接发给我。");
    } catch {
      setMessage(`请告诉我：水平 ${signed(offset.x)}，垂直 ${signed(offset.y)}。`);
    }
  }

  return <main className={styles.page} ref={root}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>PLOT WORKERS · 位置预览</span><h1>把按钮拖到合适的位置</h1><p>拖动地块上的按钮，或用下方滑杆微调。</p></div>
        <Link href="/" className={styles.back}>返回工坊 ↗</Link>
      </header>

      <section className={styles.editor} aria-label="地块按钮位置调整">
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="group" aria-label="地块尺寸">
            {([4, 8] as const).map(value => <button key={value} type="button" aria-pressed={size === value} onClick={() => setSize(value)}>{value}×{value} 地块</button>)}
          </div>
          <div className={styles.tabs} role="group" aria-label="按钮类型">
            {([['process', '配方'], ['synthesis', '合成']] as const).map(([value, name]) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>{name}</button>)}
          </div>
          <label className={styles.guideToggle}><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} />显示角点</label>
        </div>

        <div ref={frame} className={styles.canvas} style={{ height: worldHeight * scale + 24 }}>
          <div ref={world} className={styles.world} style={{ width: worldWidth, height: worldHeight, transform: `translateX(-50%) scale(${scale})` }}>
            <div className={styles.plot} style={{ width: plotWidth, height: topHeight + 38, "--plot-height": `${topHeight}px` } as CSSProperties}>
              {/* Match the game's unscaled artwork, typography and anchor exactly. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="plot-baked" src={`/plot-baked-${type}-${size}.png`} alt={`${size}×${size}${type === "process" ? "加工区" : "合成区"}地块`} draggable={false} style={{ width: plotWidth, height: imageHeight }} />
              {guides && <span className={styles.corner} style={{ left: plotWidth, top: topHeight / 2 }} aria-hidden="true" />}
              <div className="plot-action-anchor" style={{ right: 10 - offset.x, top: topHeight / 2 + offset.y }}>
                <button
                  type="button" className={`scene-action recipe-action ${styles.dragButton}`}
                  aria-label={`拖动${label}按钮`} aria-describedby="position-help"
                  data-button-feedback="off" data-dragging={dragging || undefined} disabled={!ready}
                  onPointerDown={startDrag} onPointerMove={moveDrag}
                  onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}
                  onLostPointerCapture={() => { drag.current = null; setDragging(false); }} onKeyDown={nudge}
                >{label}</button>
              </div>
            </div>
          </div>
          <span className={styles.canvasCaption}>{size}×{size} · {type === "process" ? "加工区" : "合成区"}</span>
        </div>

        <div className={styles.controls}>
          {([['x', '水平位置', '向左', '向右'], ['y', '垂直位置', '向上', '向下']] as const).map(([axis, title, low, high]) => <div key={axis} className={styles.control}>
            <div className={styles.controlHeading}><label htmlFor={`position-${axis}`}>{title}</label><span className={styles.number}><OffsetInput label={`${title}数值`} value={offset[axis]} disabled={!ready} onChange={value => update({ ...offset, [axis]: value })} /><span>px</span></span></div>
            <input id={`position-${axis}`} type="range" min={-LIMIT} max={LIMIT} step={1} value={offset[axis]} disabled={!ready} onChange={event => update({ ...offset, [axis]: Number(event.target.value) })} />
            <div className={styles.rangeLabels}><span>{low}</span><span>{high}</span></div>
          </div>)}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerText}><p className={styles.status} aria-live="polite"><i />{message || (saved ? "位置会自动保留，调好后告诉我即可。" : "暂时无法保存，请复制位置留存。")}</p><p id="position-help">大小地块、配方与合成共用位置。选中按钮后也可用方向键微调。</p></div>
        <div className={styles.actions}><button type="button" className={styles.reset} disabled={!ready} onClick={() => update(DEFAULT)}>恢复原位</button><button type="button" className={styles.copy} disabled={!ready} onClick={copyPosition}>复制位置</button></div>
      </footer>
      <p className={styles.note}>这是独立的位置预览，调整暂不应用到工坊。</p>
    </div>
  </main>;
}
