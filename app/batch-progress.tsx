"use client";

import { useLayoutEffect, useRef } from "react";
import { advanceBatchMotion, createBatchMotion, updateBatchMotion } from "./batch-progress-motion";
import type { BatchMotion, BatchSnapshot } from "./batch-progress-motion";

type PlotAnimation = {
  motion: BatchMotion | null;
  snapshot: BatchSnapshot | null;
  nodes: Set<HTMLSpanElement>;
};

// The recipe card and management row share one animation for each plot. Frames
// only update transforms; they never re-render the game or advance its economy.
const animations = new Map<string, PlotAnimation>();
let frameId: number | null = null;
let lastFrame: number | null = null;
let reducedMotion: MediaQueryList | null = null;

function paint(animation: PlotAnimation) {
  const transform = `scaleX(${animation.motion?.value ?? 0})`;
  for (const node of animation.nodes) node.style.transform = transform;
}

function stopFrames() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  lastFrame = null;
}

function animate(now: number) {
  frameId = null;
  const elapsed = lastFrame === null ? 0 : now - lastFrame;
  lastFrame = now;
  for (const animation of animations.values()) {
    if (!animation.motion || animation.motion.phase === "idle") continue;
    animation.motion = advanceBatchMotion(animation.motion, elapsed);
    paint(animation);
  }
  startFrames();
}

function startFrames() {
  if (frameId !== null || document.hidden || reducedMotion?.matches) return;
  if ([...animations.values()].some(({ motion }) => motion && motion.phase !== "idle")) {
    frameId = requestAnimationFrame(animate);
  } else {
    lastFrame = null;
  }
}

function alignSnapshots() {
  stopFrames();
  for (const animation of animations.values()) {
    if (animation.snapshot) animation.motion = createBatchMotion(animation.snapshot);
    paint(animation);
  }
}

function visibilityChanged() {
  // Returning to a tab should show its current batch, not replay time spent away.
  if (document.hidden) stopFrames();
  else alignSnapshots();
}

function subscribe(plotId: string, node: HTMLSpanElement) {
  if (animations.size === 0) {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener("change", alignSnapshots);
    document.addEventListener("visibilitychange", visibilityChanged);
  }
  let animation = animations.get(plotId);
  if (!animation) {
    animation = { motion: null, snapshot: null, nodes: new Set() };
    animations.set(plotId, animation);
  }
  animation.nodes.add(node);
  paint(animation);
  return () => {
    animation.nodes.delete(node);
    if (animation.nodes.size === 0) animations.delete(plotId);
    if (animations.size === 0) {
      stopFrames();
      reducedMotion?.removeEventListener("change", alignSnapshots);
      reducedMotion = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
    }
  };
}

function publishSnapshot(plotId: string, snapshot: BatchSnapshot) {
  const animation = animations.get(plotId);
  if (!animation) return;
  animation.snapshot = snapshot;
  animation.motion = !animation.motion || document.hidden || reducedMotion?.matches
    ? createBatchMotion(snapshot)
    : updateBatchMotion(animation.motion, snapshot);
  paint(animation);
  startFrames();
}

export function BatchProgressBackground({ plotId, recipe, completed, progress, active }: BatchSnapshot & { plotId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => subscribe(plotId, ref.current!), [plotId]);
  useLayoutEffect(() => {
    publishSnapshot(plotId, { recipe, completed, progress, active });
  }, [plotId, recipe, completed, progress, active]);
  return <span ref={ref} className="batch-progress-fill" aria-hidden="true" style={{ transform: "scaleX(0)" }} />;
}
