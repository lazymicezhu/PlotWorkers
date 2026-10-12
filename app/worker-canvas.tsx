"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { WorkerState } from "./game-engine";
import { sceneDepth } from "./scene-depth";
import { canvasLayerZIndex, canvasOcclusionDepths, canvasWorkerLayer, canvasWorkerContains, canvasWorkerPosition, canvasViewport, createCanvasWorkerHandoffs, retargetCanvasWorker } from "./worker-canvas-motion";
import type { CanvasPoint, CanvasView, CanvasWorkerMotion } from "./worker-canvas-motion";

export type CanvasWorker = {
  worker: WorkerState;
  projected: CanvasPoint;
  tracked: boolean;
  hovered: boolean;
};

type Entry = CanvasWorker & { motion: CanvasWorkerMotion; depth: number; order: number };
type Registry = { entries: Map<string, Entry>; ordered: Entry[] };
type Raster = { image: HTMLCanvasElement; width: number; height: number };
type BadgeStatus = "exhausted" | "ready" | "slacking";
type WorkerImages = { normalImage: HTMLImageElement; highlightImage: HTMLImageElement };
type CanvasLayer = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  previousView: string;
  lastCount: number;
};

// Reuse decoded local images across scene changes. The weak document key keeps
// this small cache separate from the viewport-sized Canvas backing store.
const spriteImages = new WeakMap<Document, WorkerImages>();
function getWorkerImages(ownerDocument: Document): WorkerImages {
  const cached = spriteImages.get(ownerDocument);
  if (cached) return cached;
  const normalImage = ownerDocument.createElement("img");
  const highlightImage = ownerDocument.createElement("img");
  normalImage.src = "/worker.png";
  highlightImage.src = "/worker-highlight-3x.png";
  const images = { normalImage, highlightImage };
  spriteImages.set(ownerDocument, images);
  return images;
}

// Begin loading before the scene mounts so cached assets can paint during
// the first layout commit.
if (typeof document !== "undefined") getWorkerImages(document);

const registries = new WeakMap<HTMLElement, Registry>();
const handoffs = createCanvasWorkerHandoffs<HTMLElement>();
const WORLD_WIDTH = 2000;
const ANCHOR_Y = 106 * .92;
const BADGE_PADDING = 18;
const BADGES: Record<BadgeStatus, { text: string; color: string }> = {
  exhausted: { text: "需要休息", color: "#9e6459" },
  ready: { text: "可以工作", color: "#4f8061" },
  slacking: { text: "摸鱼中", color: "#81725a" },
};

function badgeStatus(worker: WorkerState): BadgeStatus | null {
  return worker.status === "exhausted" || worker.status === "ready" || worker.status === "slacking" ? worker.status : null;
}

/** Lets the existing scheduler turn from the currently painted point. */
export function getCanvasWorkerPosition(world: HTMLElement | null, id: string): CanvasPoint | null {
  const entry = world ? registries.get(world)?.entries.get(id) : undefined;
  return entry ? canvasWorkerPosition(entry.motion, performance.now()) : null;
}

/** Capture the visible DOM point before returning this worker to Canvas. */
export function setCanvasWorkerHandoff(world: HTMLElement | null, id: string, point: CanvasPoint) {
  if (world) handoffs.set(world, id, point, performance.now());
}

/** Clear pending boundary positions whenever a different scene is installed. */
export function clearCanvasWorkerHandoffs(world: HTMLElement | null) {
  if (world) handoffs.clear(world);
}

/** Find the frontmost worker at a point in world coordinates. */
export function hitTestCanvasWorker(world: HTMLElement | null, point: CanvasPoint, minDepth = -Infinity): string | null {
  const registry = world ? registries.get(world) : undefined;
  if (!registry) return null;
  const now = performance.now();
  for (let index = registry.ordered.length - 1; index >= 0; index -= 1) {
    const entry = registry.ordered[index];
    if (entry.depth <= minDepth) break;
    if (canvasWorkerContains(canvasWorkerPosition(entry.motion, now), point)) return entry.worker.id;
  }
  return null;
}

function raster(width: number, height: number, density: number) {
  const image = document.createElement("canvas");
  image.width = Math.ceil(width * density);
  image.height = Math.ceil(height * density);
  const context = image.getContext("2d")!;
  context.scale(image.width / width, image.height / height);
  return { image, context, width, height };
}

function makeShadow(density: number): Raster {
  const result = raster(42, 13, density);
  const { context } = result;
  // CSS radial-gradient defaults to farthest-corner; border-radius clips
  // that gradient to the original 42 × 13 ellipse.
  context.translate(21, 6.5);
  context.scale(21, 6.5);
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.clip();
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
  gradient.addColorStop(0, "rgba(38,54,39,.32)");
  gradient.addColorStop(.44, "rgba(38,54,39,.32)");
  gradient.addColorStop(.68, "rgba(38,54,39,.12)");
  gradient.addColorStop(.74, "rgba(38,54,39,0)");
  gradient.addColorStop(1, "rgba(38,54,39,0)");
  context.fillStyle = gradient;
  context.fillRect(-1, -1, 2, 2);
  return result;
}

function makeBadge(status: BadgeStatus, density: number): Raster {
  const { text, color } = BADGES[status];
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = "700 10px Arial, Helvetica, sans-serif";
  const metrics = measure.measureText(text);
  const boxWidth = metrics.width + 18;
  const boxHeight = 25; // 15px inherited line-height + 5px padding above/below.
  const result = raster(boxWidth + BADGE_PADDING * 2, boxHeight + BADGE_PADDING * 2, density);
  const { context } = result;
  context.save();
  // Cache the original 0 4px 12px box-shadow once, never filter every worker/frame.
  context.shadowColor = "rgba(29,40,31,.14)";
  context.shadowBlur = 12 * density;
  context.shadowOffsetY = 4 * density;
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(BADGE_PADDING, BADGE_PADDING, boxWidth, boxHeight, boxHeight / 2);
  context.fill();
  context.restore();
  context.fillStyle = "#fff";
  context.font = measure.font;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const ascent = metrics.fontBoundingBoxAscent ?? 9;
  const descent = metrics.fontBoundingBoxDescent ?? 2;
  context.fillText(text, result.width / 2, BADGE_PADDING + 5 + (15 - ascent - descent) / 2 + ascent);
  return result;
}

function WorkerCanvasLayer({ layer, zIndex, register }: {
  layer: number;
  zIndex: number;
  register: (layer: number, canvas: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => register(layer, canvas), [layer, register]);
  return <canvas ref={canvasRef} className="worker-canvas" data-worker-count="0" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, zIndex, pointerEvents: "none" }} />;
}

/**
 * Batch ordinary workers into viewport-sized layers around the few DOM sprites
 * that need depth interleaving. Every layer shares one animation loop and cache.
 */
export function CanvasWorkers({ workers, worldRef, zoom, population, occlusionDepths }: {
  workers: CanvasWorker[];
  worldRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  population: number;
  occlusionDepths: readonly number[];
}) {
  const boundaries = useMemo(() => canvasOcclusionDepths(occlusionDepths), [occlusionDepths]);
  const layersRef = useRef(new Map<number, CanvasLayer>());
  const registryRef = useRef<Registry>({ entries: new Map(), ordered: [] });
  const paintOptionsRef = useRef({ zoom, population, boundaries });
  const repaintRef = useRef<((now: number) => void) | null>(null);

  const registerCanvas = useCallback((layer: number, canvas: HTMLCanvasElement | null) => {
    const previous = layersRef.current.get(layer);
    if (previous?.canvas === canvas) return;
    if (previous) {
      previous.canvas.width = 0;
      previous.canvas.height = 0;
      layersRef.current.delete(layer);
    }
    if (canvas) layersRef.current.set(layer, {
      canvas,
      context: canvas.getContext("2d", { alpha: true }),
      previousView: "",
      lastCount: -1,
    });
  }, []);

  useLayoutEffect(() => {
    const shadowOpacity = (count: number) => count > 300 ? .48 : count > 150 ? .72 : 1;
    const previousOptions = paintOptionsRef.current;
    let changed = shadowOpacity(population) !== shadowOpacity(previousOptions.population) ||
      boundaries.length !== previousOptions.boundaries.length ||
      boundaries.some((depth, index) => depth !== previousOptions.boundaries[index]);
    paintOptionsRef.current = { zoom, population, boundaries };
    const registry = registryRef.current;
    const world = worldRef.current ?? layersRef.current.get(0)?.canvas.parentElement ?? null;
    const now = performance.now();
    const currentIds = new Set<string>();
    let orderChanged = false;
    workers.forEach((worker, order) => {
      const id = worker.worker.id;
      currentIds.add(id);
      const previous = registry.entries.get(id);
      const handoff = world ? handoffs.consume(world, id, now) : undefined;
      const depth = sceneDepth(worker.projected.y, badgeStatus(worker.worker) ? 20_000 : 0);
      if (!previous || handoff || previous.projected.x !== worker.projected.x || previous.projected.y !== worker.projected.y ||
          previous.worker.facing !== worker.worker.facing || previous.tracked !== worker.tracked ||
          previous.hovered !== worker.hovered || badgeStatus(previous.worker) !== badgeStatus(worker.worker)) changed = true;
      if (!previous || previous.depth !== depth || previous.order !== order) orderChanged = true;
      const next = {
        ...worker,
        motion: retargetCanvasWorker(previous?.motion, worker.projected, worker.worker.duration, now, worker.hovered, handoff),
        depth,
        order,
      };
      // Preserve ordered entries on mood-only updates; those do not need a sort
      // or an extra full Canvas repaint in the React commit.
      if (previous) Object.assign(previous, next);
      else registry.entries.set(id, next);
    });
    for (const id of registry.entries.keys()) {
      if (!currentIds.has(id)) {
        registry.entries.delete(id);
        changed = true;
        orderChanged = true;
      }
    }
    // CSS z-index is based on the destination, even mid-transition.
    if (orderChanged) registry.ordered = [...registry.entries.values()].sort((a, b) => a.depth - b.depth || a.order - b.order);
    if (world) registries.set(world, registry);
    // Removing a worker must erase it in this commit, before its DOM replacement
    // can paint. The regular frame loop remains singular and keeps its timing.
    if (changed) repaintRef.current?.(now);
  }, [workers, worldRef, zoom, population, boundaries]);

  useLayoutEffect(() => {
    const layers = layersRef.current;
    const firstCanvas = layers.get(0)?.canvas;
    // On a freshly mounted world, its parent's ref may attach after this child
    // layout effect. The actual Canvas parent is already present in the DOM.
    const world = worldRef.current ?? firstCanvas?.parentElement;
    if (!world) return;
    const registry = registryRef.current;
    registries.set(world, registry);
    const { normalImage, highlightImage } = getWorkerImages(world.ownerDocument);
    let frame: number | null = null;
    let active = true;
    let spriteDensity = 0;
    let shadow: Raster | null = null;
    let badges: Record<BadgeStatus, Raster> | null = null;
    let lastView: CanvasView | null = null;

    function schedule() {
      if (active && frame === null && !document.hidden) frame = requestAnimationFrame(draw);
    }

    function draw(now: number) {
      frame = null;
      paint(now, true);
      schedule();
    }

    function paint(now: number, updateViewport: boolean) {
      if (!active || document.hidden || !world || !world.isConnected) return;
      const options = paintOptionsRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (updateViewport) {
        // One geometry read per animation frame. Layout-commit handoffs reuse
        // the previous mapping and raster caches instead of forcing layout.
        const rect = world.getBoundingClientRect();
        const scale = rect.width / WORLD_WIDTH || options.zoom;
        lastView = canvasViewport(rect, scale, window.innerWidth, window.innerHeight, dpr);
      }
      const view = lastView;
      if (!view) return;
      const viewKey = `${view.left},${view.top},${view.width},${view.height}`;
      const sx = view.pixelWidth / view.width;
      const sy = view.pixelHeight / view.height;
      for (const layer of layers.values()) {
        const { canvas, context } = layer;
        if (!context) continue;
        if (canvas.width !== view.pixelWidth || canvas.height !== view.pixelHeight) {
          canvas.width = view.pixelWidth;
          canvas.height = view.pixelHeight;
        }
        if (viewKey !== layer.previousView) {
          canvas.style.left = `${view.left}px`;
          canvas.style.top = `${view.top}px`;
          canvas.style.width = `${view.width}px`;
          canvas.style.height = `${view.height}px`;
          layer.previousView = viewKey;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.setTransform(sx, 0, 0, sy, -view.left * sx, -view.top * sy);
      }
      // Raster caches are shared by all workers; zoom animation resamples them
      // without rebuilding hundreds of labels or allocating per-frame textures.
      const density = dpr * Math.max(1, options.zoom);
      if (updateViewport && density !== spriteDensity) {
        shadow = makeShadow(density);
        badges = {
          exhausted: makeBadge("exhausted", density),
          ready: makeBadge("ready", density),
          slacking: makeBadge("slacking", density),
        };
        spriteDensity = density;
      }
      const right = view.left + view.width;
      const bottom = view.top + view.height;
      const opacity = options.population > 300 ? .48 : options.population > 150 ? .72 : 1;
      const drawn = new Array<number>(options.boundaries.length + 1).fill(0);
      let layerIndex = 0;
      for (const entry of registry.ordered) {
        layerIndex = canvasWorkerLayer(entry.depth, options.boundaries, layerIndex);
        const context = layers.get(layerIndex)?.context;
        if (!context) continue;
        const point = canvasWorkerPosition(entry.motion, now);
        // Include the selected glow and status label/shadow in the cull bounds.
        if (point.x + 72 < view.left || point.x - 72 > right || point.y + 46 < view.top || point.y - 152 > bottom) continue;
        const x = point.x - 32;
        const y = point.y - ANCHOR_Y;
        if (shadow) {
          context.globalAlpha = opacity;
          context.drawImage(shadow.image, x + 12, y + 93, shadow.width, shadow.height);
          context.globalAlpha = 1;
        }
        const image = entry.tracked ? highlightImage : normalImage;
        if (image.complete && image.naturalWidth > 0) {
          const left = entry.tracked ? -34 : -2;
          const top = entry.tracked ? -32 : 0;
          const width = entry.tracked ? 128 : 64;
          const height = entry.tracked ? 168 : 104;
          if (entry.worker.facing === "left") {
            context.save();
            // Both normal and padded images flip about walker-local x = 32.
            context.translate(x + 32, 0);
            context.scale(-1, 1);
            context.drawImage(image, left - 32, y + top, width, height);
            context.restore();
          } else context.drawImage(image, x + left, y + top, width, height);
        }
        const status = badgeStatus(entry.worker);
        if (status && badges) {
          const badge = badges[status];
          context.drawImage(badge.image, point.x - badge.width / 2, y - 29 - BADGE_PADDING, badge.width, badge.height);
        }
        drawn[layerIndex] += 1;
      }
      for (const [index, layer] of layers) {
        if (drawn[index] !== layer.lastCount) {
          layer.canvas.dataset.workerCount = String(drawn[index] ?? 0);
          layer.lastCount = drawn[index] ?? 0;
        }
      }
    }

    const repaint = (now: number) => paint(now, false);
    repaintRef.current = repaint;

    function visibilityChanged() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      schedule();
    }

    function imageLoaded() {
      // A cold image becomes drawable immediately on load; this does not create
      // another animation loop, and hidden/unmounted scenes remain inactive.
      paint(performance.now(), !lastView);
    }

    document.addEventListener("visibilitychange", visibilityChanged);
    normalImage.addEventListener("load", imageLoaded);
    highlightImage.addEventListener("load", imageLoaded);
    paint(performance.now(), true);
    schedule();
    return () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibilityChanged);
      normalImage.removeEventListener("load", imageLoaded);
      highlightImage.removeEventListener("load", imageLoaded);
      if (repaintRef.current === repaint) repaintRef.current = null;
      if (registries.get(world) === registry) registries.delete(world);
      clearCanvasWorkerHandoffs(world);
      // Release the viewport's backing store when the scene unmounts.
      for (const { canvas } of layers.values()) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [worldRef]);

  return Array.from({ length: boundaries.length + 1 }, (_, layer) =>
    <WorkerCanvasLayer key={layer} layer={layer} zIndex={canvasLayerZIndex(layer, boundaries)} register={registerCanvas} />
  );
}
