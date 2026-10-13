"use client";

import { memo, useEffect, useState } from "react";
import {
  getPerformanceSnapshot,
  recordPerformanceFrame,
  setPerformanceMonitoringEnabled,
} from "./performance-metrics";
import type { GamePerformanceSnapshot } from "./performance-metrics";

type Props = { enabled: boolean; workers: number; robots: number };

function milliseconds(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(2)} ms`;
}

function ActivePerformanceOverlay({ workers, robots }: Omit<Props, "enabled">) {
  const [snapshot, setSnapshot] = useState<GamePerformanceSnapshot | null>(null);

  useEffect(() => {
    let frameId: number | undefined;
    let intervalId: number | undefined;
    let active = false;

    function recordFrame(at: number) {
      if (!active) return;
      recordPerformanceFrame(at);
      frameId = window.requestAnimationFrame(recordFrame);
    }

    function stop() {
      active = false;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      frameId = undefined;
      intervalId = undefined;
      setPerformanceMonitoringEnabled(false);
    }

    function start() {
      active = true;
      setPerformanceMonitoringEnabled(true);
      if (typeof window.requestAnimationFrame === "function") frameId = window.requestAnimationFrame(recordFrame);
      // React only updates the panel once per second, never on each frame.
      intervalId = window.setInterval(() => setSnapshot(getPerformanceSnapshot(performance.now())), 1000);
    }

    function onVisibilityChange() {
      stop();
      setSnapshot(null);
      if (document.visibilityState !== "hidden") start();
    }

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <aside className="performance-overlay" aria-label="性能监测">
      <div className="performance-overlay-heading"><strong>性能监测</strong><span>每秒刷新</span></div>
      <dl className="performance-overlay-grid">
        <div><dt>帧率 FPS</dt><dd>{snapshot?.fps == null ? "—" : snapshot.fps.toFixed(0)}</dd></div>
        <div title="近 5 秒内，95% 的相邻画面帧间隔不超过这个值；越低越流畅。"><dt>帧间隔 P95</dt><dd>{milliseconds(snapshot?.frameP95Ms)}</dd></div>
        <div title="相邻画面帧间隔超过 50 毫秒的次数。"><dt>帧间隔 &gt; 50 ms</dt><dd>{snapshot?.frameCount ? `${snapshot.longFrameCount} 次 / 5 秒` : "—"}</dd></div>
        <div><dt>人物 / 机器人</dt><dd>{workers} / {robots}</dd></div>
      </dl>
    </aside>
  );
}

export const PerformanceOverlay = memo(function PerformanceOverlay({ enabled, workers, robots }: Props) {
  return enabled ? <ActivePerformanceOverlay workers={workers} robots={robots} /> : null;
});
