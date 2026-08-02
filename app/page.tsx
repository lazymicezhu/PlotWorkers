"use client";

import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";

// Dimetric projection: all tile tops share one perfectly flat plane.
const TILE_W = 104;
const TILE_H = 54;
const CUBE_DEPTH = 38;
const WORLD_W = 1700;
const WORLD_H = 860;

type Plot = {
  id: "large" | "small";
  x: number;
  y: number;
  cols: number;
  rows: number;
};

type Worker = {
  plotId: Plot["id"];
  u: number;
  v: number;
  x: number;
  y: number;
  moving: boolean;
  duration: number;
};

const plots: Plot[] = [
  { id: "large", x: 115, y: 150, cols: 8, rows: 8 },
  { id: "small", x: 1130, y: 395, cols: 4, rows: 4 },
];

const tones = ["sage", "mint", "grass", "moss"];

function project(plot: Plot, u: number, v: number) {
  return {
    x: plot.x + (u - v) * TILE_W / 2 + plot.rows * TILE_W / 2,
    y: plot.y + (u + v) * TILE_H / 2,
  };
}

function unproject(plot: Plot, x: number, y: number) {
  const localX = x - plot.x - plot.rows * TILE_W / 2;
  const localY = y - plot.y;
  return {
    u: localY / TILE_H + localX / TILE_W,
    v: localY / TILE_H - localX / TILE_W,
  };
}

function findPlot(x: number, y: number) {
  return plots.find((plot) => {
    const point = unproject(plot, x, y);
    return point.u >= 0 && point.u <= plot.cols && point.v >= 0 && point.v <= plot.rows;
  }) ?? null;
}

function tileTone(x: number, y: number, plotId: Plot["id"]) {
  const offset = plotId === "large" ? 1 : 0;
  return tones[(x * 3 + y * 5 + offset) % tones.length];
}

const firstPlot = plots[0];
const firstPosition = project(firstPlot, 4, 4);

export default function Home() {
  const worldRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker>({
    plotId: "large",
    u: 4,
    v: 4,
    ...firstPosition,
    moving: false,
    duration: 1000,
  });
  const dragOrigin = useRef<Worker | null>(null);
  const panOrigin = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });
  const [worker, setWorker] = useState(workerRef.current);
  const [zoom, setZoom] = useState(.62);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [hoveredPlot, setHoveredPlot] = useState<Plot["id"] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const fit = Math.min(.78, (window.innerWidth - 30) / WORLD_W, (window.innerHeight - 30) / WORLD_H);
    setZoom(Math.max(.34, fit));
  }, []);

  useEffect(() => {
    workerRef.current = worker;
  }, [worker]);

  useEffect(() => {
    if (dragging) return;
    let cancelled = false;
    let pauseTimer: ReturnType<typeof setTimeout>;
    let moveTimer: ReturnType<typeof setTimeout>;

    function scheduleWalk() {
      pauseTimer = setTimeout(() => {
        if (cancelled) return;
        const current = workerRef.current;
        const plot = plots.find((item) => item.id === current.plotId)!;
        const u = .55 + Math.random() * (plot.cols - 1.1);
        const v = .55 + Math.random() * (plot.rows - 1.1);
        const next = project(plot, u, v);
        const distance = Math.hypot(next.x - current.x, next.y - current.y);
        const duration = Math.max(850, Math.min(2600, distance * 7.2));

        setFacing(next.x < current.x ? "left" : "right");
        setWorker({ ...current, u, v, ...next, moving: true, duration });
        moveTimer = setTimeout(() => {
          if (cancelled) return;
          setWorker((value) => ({ ...value, moving: false }));
          scheduleWalk();
        }, duration);
      }, 650 + Math.random() * 1000);
    }

    scheduleWalk();
    return () => {
      cancelled = true;
      clearTimeout(pauseTimer);
      clearTimeout(moveTimer);
    };
  }, [dragging]);

  function pointerInWorld(event: PointerEvent) {
    const rect = worldRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * WORLD_W,
      y: (event.clientY - rect.top) / rect.height * WORLD_H,
    };
  }

  function onWorkerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = workerRef.current;
    setDragging(true);
    setWorker((value) => ({ ...value, moving: false }));
  }

  function onWorkerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const point = pointerInWorld(event);
    const target = findPlot(point.x, point.y);
    setHoveredPlot(target?.id ?? null);
    setFacing(point.x < workerRef.current.x ? "left" : "right");
    setWorker((value) => ({ ...value, x: point.x, y: point.y, moving: false }));
  }

  function onWorkerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const point = pointerInWorld(event);
    const target = findPlot(point.x, point.y);

    if (target) {
      const raw = unproject(target, point.x, point.y);
      const u = Math.max(.4, Math.min(target.cols - .4, raw.u));
      const v = Math.max(.4, Math.min(target.rows - .4, raw.v));
      setWorker({
        plotId: target.id,
        u,
        v,
        ...project(target, u, v),
        moving: false,
        duration: 300,
      });
    } else if (dragOrigin.current) {
      setWorker({ ...dragOrigin.current, moving: false, duration: 300 });
    }

    dragOrigin.current = null;
    setDragging(false);
    setHoveredPlot(null);
  }

  function onWheel(event: WheelEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".plot, .walker")) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? .9 : 1.1;
    setZoom((value) => Math.max(.28, Math.min(1.5, value * factor)));
  }

  function onPanDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".plot, .walker")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panOrigin.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: camera.x,
      y: camera.y,
    };
    setPanning(true);
  }

  function onPanMove(event: PointerEvent<HTMLElement>) {
    if (!panning) return;
    setCamera({
      x: panOrigin.current.x + event.clientX - panOrigin.current.clientX,
      y: panOrigin.current.y + event.clientY - panOrigin.current.clientY,
    });
  }

  function onPanUp() {
    setPanning(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "+" || event.key === "=") {
      setZoom((value) => Math.min(1.5, value * 1.1));
    }
    if (event.key === "-") {
      setZoom((value) => Math.max(.28, value * .9));
    }
  }

  return (
    <main
      className={`viewport ${panning ? "is-panning" : ""}`}
      aria-label="2.5D 地块世界，空白处滚轮缩放，人物可拖拽到另一地块"
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onPointerDown={onPanDown}
      onPointerMove={onPanMove}
      onPointerUp={onPanUp}
      onPointerCancel={onPanUp}
      tabIndex={0}
    >
      <div
        className="world"
        ref={worldRef}
        style={{
          "--zoom": zoom,
          "--camera-x": `${camera.x}px`,
          "--camera-y": `${camera.y}px`,
        } as CSSProperties}
      >
        {plots.map((plot) => (
          <section
            className={`plot plot-${plot.id} ${hoveredPlot === plot.id ? "is-hovered" : ""}`}
            key={plot.id}
            style={{
              left: plot.x,
              top: plot.y,
              width: plot.cols * TILE_W,
              height: plot.rows * TILE_H + CUBE_DEPTH,
              "--cols": plot.cols,
              "--rows": plot.rows,
              "--plot-width": `${plot.cols * TILE_W}px`,
              "--plot-height": `${plot.rows * TILE_H}px`,
            } as CSSProperties}
          >
            <div className="plot-shadow" />
            <div className="plot-base" aria-hidden="true">
              <span className="base-left" />
              <span className="base-right" />
            </div>
            {Array.from({ length: plot.cols * plot.rows }, (_, index) => {
              const x = index % plot.cols;
              const y = Math.floor(index / plot.cols);
              return (
                <div
                  className={`tile tile-${tileTone(x, y, plot.id)}`}
                  key={`${plot.id}-${x}-${y}`}
                  style={{ "--tile-x": x, "--tile-y": y } as CSSProperties}
                >
                  <span className="tile-left" />
                  <span className="tile-right" />
                  <span className="tile-top" />
                  <i className="grass-blade blade-one" />
                  <i className="grass-blade blade-two" />
                </div>
              );
            })}
            <div className="plot-volume-highlight" aria-hidden="true">
              <span className="highlight-left" />
              <span className="highlight-right" />
              <span className="highlight-top" />
            </div>
            <div
              className="plot-hit"
              onPointerEnter={() => !dragging && setHoveredPlot(plot.id)}
              onPointerLeave={() => !dragging && setHoveredPlot(null)}
            />
          </section>
        ))}

        <div
          className={`walker ${worker.moving ? "is-walking" : ""} ${dragging ? "is-dragging" : ""} facing-${facing}`}
          onPointerDown={onWorkerDown}
          onPointerMove={onWorkerMove}
          onPointerUp={onWorkerUp}
          onPointerCancel={onWorkerUp}
          style={{
            left: worker.x,
            top: worker.y,
            zIndex: 1000 + Math.round(worker.y),
            "--move-duration": `${worker.duration}ms`,
          } as CSSProperties}
          role="button"
          aria-label="拖动小人到另一块地"
        >
          <span className="walker-shadow" />
          <span className="character">
            <i className="hair" />
            <i className="face" />
            <i className="neck" />
            <i className="torso" />
            <i className="arm arm-back" />
            <i className="arm arm-front" />
            <i className="leg leg-back"><b className="shoe" /></i>
            <i className="leg leg-front"><b className="shoe" /></i>
          </span>
        </div>
      </div>
    </main>
  );
}
