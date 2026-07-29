"use client";

import { PointerEvent, useMemo, useRef, useState } from "react";

type WorkerState = {
  id: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  zone: number | null;
};

const initialWorkers: WorkerState[] = [
  { id: 1, x: 11, y: 75, homeX: 11, homeY: 75, zone: null },
  { id: 2, x: 18, y: 82, homeX: 18, homeY: 82, zone: null },
  { id: 3, x: 25, y: 74, homeX: 25, homeY: 74, zone: null },
  { id: 4, x: 32, y: 82, homeX: 32, homeY: 82, zone: null },
  { id: 5, x: 39, y: 75, homeX: 39, homeY: 75, zone: null },
  { id: 6, x: 46, y: 82, homeX: 46, homeY: 82, zone: null },
  { id: 7, x: 53, y: 75, homeX: 53, homeY: 75, zone: null },
  { id: 8, x: 60, y: 82, homeX: 60, homeY: 82, zone: null },
];

const zoneTargets = [
  [
    [19, 36],
    [26, 42],
    [33, 36],
  ],
  [
    [50, 27],
    [57, 31],
    [53, 48],
  ],
  [
    [75, 43],
    [82, 48],
    [88, 54],
  ],
];

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [workers, setWorkers] = useState(initialWorkers);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hoverZone, setHoverZone] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(true);

  const workingCount = useMemo(
    () => workers.filter((worker) => worker.zone !== null).length,
    [workers],
  );

  function boardPosition(event: PointerEvent) {
    const rect = boardRef.current!.getBoundingClientRect();
    return {
      x: Math.max(3, Math.min(97, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(5, Math.min(92, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function detectZone(x: number, y: number) {
    if (x >= 11 && x <= 39 && y >= 22 && y <= 56) return 0;
    if (x >= 43 && x <= 66 && y >= 14 && y <= 60) return 1;
    if (x >= 68 && x <= 94 && y >= 27 && y <= 66) return 2;
    return null;
  }

  function onPointerDown(event: PointerEvent, id: number) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
    setShowHelp(false);
  }

  function onPointerMove(event: PointerEvent, id: number) {
    if (dragging !== id) return;
    const position = boardPosition(event);
    setHoverZone(detectZone(position.x, position.y));
    setWorkers((current) =>
      current.map((worker) =>
        worker.id === id
          ? { ...worker, x: position.x, y: position.y, zone: null }
          : worker,
      ),
    );
  }

  function onPointerUp(event: PointerEvent, id: number) {
    if (dragging !== id) return;
    const position = boardPosition(event);
    const zone = detectZone(position.x, position.y);
    setWorkers((current) => {
      const occupied = current.filter(
        (worker) => worker.zone === zone && worker.id !== id,
      ).length;
      return current.map((worker) => {
        if (worker.id !== id) return worker;
        if (zone !== null) {
          const target = zoneTargets[zone][occupied % zoneTargets[zone].length];
          return { ...worker, x: target[0], y: target[1], zone };
        }
        return {
          ...worker,
          x: worker.homeX,
          y: worker.homeY,
          zone: null,
        };
      });
    });
    setDragging(null);
    setHoverZone(null);
  }

  function resetWorkers() {
    setWorkers(initialWorkers);
    setDragging(null);
    setHoverZone(null);
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <div>
            <h1>白境 · WHITE REALM</h1>
            <p>小人调度实验场</p>
          </div>
        </div>
        <div className="status">
          <span>总人数 {workers.length}</span>
          <span>工作中 {workingCount}</span>
          <button onClick={resetWorkers}>全部召回</button>
        </div>
      </header>

      <section className="game-board" ref={boardRef}>
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <div
          className={`zone zone-square ${hoverZone === 0 ? "is-target" : ""}`}
        >
          <div className="square-top">
            <span className="zone-number">01</span>
            <div className="grid-lines" />
          </div>
          <div className="square-front" />
          <div className="zone-label">
            <strong>平面工坊</strong>
            <span>完整正方形地块</span>
          </div>
        </div>

        <div
          className={`zone zone-stairs ${hoverZone === 1 ? "is-target" : ""}`}
        >
          <div className="lower-floor" />
          <div className="upper-floor">
            <span className="zone-number">02</span>
            <i />
            <i />
            <i />
          </div>
          <div className="staircase">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="zone-label">
            <strong>阶梯楼台</strong>
            <span>倾斜楼梯 · 二层</span>
          </div>
        </div>

        <div
          className={`zone zone-quarter ${hoverZone === 2 ? "is-target" : ""}`}
        >
          <div className="quarter-top">
            <span className="zone-number">03</span>
            <i className="arc arc-one" />
            <i className="arc arc-two" />
          </div>
          <div className="quarter-side" />
          <div className="zone-label">
            <strong>弧光庭院</strong>
            <span>四分之一圆地块</span>
          </div>
        </div>

        <div className="home-line">
          <span>待命区</span>
        </div>

        {workers.map((worker) => (
          <button
            aria-label={`白色小人 ${worker.id}，${worker.zone === null ? "待命中" : "工作中"}`}
            className={`worker ${
              dragging === worker.id
                ? "is-dragging"
                : worker.zone !== null
                  ? "is-working"
                  : "is-idle"
            }`}
            key={worker.id}
            onPointerDown={(event) => onPointerDown(event, worker.id)}
            onPointerMove={(event) => onPointerMove(event, worker.id)}
            onPointerUp={(event) => onPointerUp(event, worker.id)}
            onPointerCancel={(event) => onPointerUp(event, worker.id)}
            style={{ left: `${worker.x}%`, top: `${worker.y}%` }}
          >
            <span className="worker-shadow" />
            <span className="person">
              <i className="head" />
              <i className="body" />
              <i className="arm arm-left" />
              <i className="arm arm-right" />
              <i className="leg leg-left" />
              <i className="leg leg-right" />
            </span>
            {worker.zone !== null && <span className="work-spark">✦</span>}
          </button>
        ))}

        {showHelp && (
          <div className="help-card">
            <span className="mouse-icon">↖</span>
            <div>
              <strong>拖动白色小人</strong>
              <p>把他们放进任意地块开始工作</p>
            </div>
          </div>
        )}
      </section>

      <footer className="legend">
        <span><i className="dot idle-dot" /> 待机</span>
        <span><i className="dot drag-dot" /> 拖拽</span>
        <span><i className="dot work-dot" /> 工作</span>
        <p>拖出地块即可召回待命区</p>
      </footer>
    </main>
  );
}
