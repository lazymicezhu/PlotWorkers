"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { flushSync } from "react-dom";
import { advanceCameraMotion, cameraNeedsCullingRefresh, CAMERA_CULL_MARGIN_WORLD, createCameraFrameQueue, createCameraMotion } from "./camera-motion";
import type { CameraPoint } from "./camera-motion";
import { readRenderedWorkerPosition } from "./worker-motion";

import { getCanvasWorkerPosition } from "./worker-canvas";

const WORLD_W = 2000;
const WORLD_H = 1080;
const SNAPSHOT_INTERVAL_MS = 100;

type TrackingCameraOptions = {
  worldRef: RefObject<HTMLDivElement | null>;
  trackedId: string | null;
  paused: boolean;
  zoom: number;
  worldRevision: number;
  initialPosition: CameraPoint;
  viewportSize: { width: number; height: number };
};

function paintCamera(world: HTMLDivElement | null, position: CameraPoint) {
  if (!world) return;
  // A direct composited property does not invalidate inherited custom
  // properties on every worker whenever the camera moves.
  world.style.translate = `calc(-50% + ${position.x}px) calc(-50% + ${position.y}px)`;
}

function renderedZoom(world: HTMLDivElement, fallback: number): number {
  const transform = getComputedStyle(world).transform;
  if (transform === "none") return 1;
  try {
    const scale = new DOMMatrixReadOnly(transform).a;
    return Number.isFinite(scale) && scale > 0 ? scale : fallback;
  } catch {
    return fallback;
  }
}

/** Paint every frame; publish occasional React snapshots only for scene culling. */
export function useTrackingCamera({
  worldRef, trackedId, paused, zoom, worldRevision, initialPosition, viewportSize,
}: TrackingCameraOptions): {
  camera: CameraPoint;
  cameraRef: RefObject<CameraPoint>;
  setCamera: (next: CameraPoint) => void;
  beginPan: () => CameraPoint;
  panCamera: (next: CameraPoint) => void;
  endPan: (next?: CameraPoint) => void;
} {
  const [camera, setCameraSnapshot] = useState(() => createCameraMotion(initialPosition).position);
  const cameraRef = useRef(camera);
  const motionRef = useRef(createCameraMotion(camera));
  const snapshotRef = useRef(camera);
  const committedSnapshotRef = useRef(camera);
  const panningRef = useRef(false);
  const snapshotTimeRef = useRef(-Infinity);
  const zoomRef = useRef(zoom);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useLayoutEffect(() => {
    // A queued snapshot is not yet a safe culling boundary for the rendered scene.
    committedSnapshotRef.current = camera;
  }, [camera]);

  const publishSnapshot = useCallback((position: CameraPoint, now: number, force = false, manual = false, allowSynchronous = false) => {
    if (!mountedRef.current) return;
    const previous = snapshotRef.current;
    const beyondRenderedMargin = cameraNeedsCullingRefresh(position, committedSnapshotRef.current, zoomRef.current, CAMERA_CULL_MARGIN_WORLD);
    const urgent = allowSynchronous && beyondRenderedMargin;
    if (!urgent && position.x === previous.x && position.y === previous.y) return;
    if (!force && !urgent) {
      if (manual) {
        if (!cameraNeedsCullingRefresh(position, committedSnapshotRef.current, zoomRef.current)) return;
      } else {
        // Preserve the existing smooth-follow snapshot cadence and distance guard.
        const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
        const distanceLimit = Math.max(24, zoomRef.current * 100);
        if (now - snapshotTimeRef.current < SNAPSHOT_INTERVAL_MS && distance < distanceLimit) return;
      }
    }
    snapshotRef.current = position;
    snapshotTimeRef.current = now;
    const publish = () => setCameraSnapshot(position);
    // Only manual rAF/event callbacks use this path, never a React effect.
    // A jump beyond all pre-rendered margin must commit culling before painting.
    if (urgent) flushSync(publish);
    else publish();
  }, []);

  const commitPan = useCallback((position: CameraPoint, forceSnapshot: boolean) => {
    const motion = createCameraMotion(position);
    motionRef.current = motion;
    cameraRef.current = motion.position;
    publishSnapshot(motion.position, performance.now(), forceSnapshot, true, true);
    paintCamera(worldRef.current, motion.position);
  }, [publishSnapshot, worldRef]);

  const panFramesRef = useRef<ReturnType<typeof createCameraFrameQueue> | null>(null);
  useLayoutEffect(() => {
    const frames = createCameraFrameQueue({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      commit: commitPan,
    });
    panFramesRef.current = frames;
    return () => {
      frames.cancel();
      if (panFramesRef.current === frames) panFramesRef.current = null;
    };
  }, [commitPan]);

  const setCamera = useCallback((next: CameraPoint) => {
    panFramesRef.current?.cancel();
    panningRef.current = false;
    const motion = createCameraMotion(next);
    motionRef.current = motion;
    cameraRef.current = motion.position;
    paintCamera(worldRef.current, motion.position);
    publishSnapshot(motion.position, performance.now(), true);
  }, [publishSnapshot, worldRef]);

  const beginPan = useCallback(() => {
    panFramesRef.current?.cancel();
    // Stop an already queued follow frame before React processes paused/trackedId.
    panningRef.current = true;
    motionRef.current = createCameraMotion(cameraRef.current);
    return cameraRef.current;
  }, []);

  const panCamera = useCallback((next: CameraPoint) => {
    if (!panningRef.current) return;
    const position = createCameraMotion(next).position;
    cameraRef.current = position;
    panFramesRef.current?.queue(position);
  }, []);

  const endPan = useCallback((next?: CameraPoint) => {
    panningRef.current = false;
    panFramesRef.current?.flush(next ?? cameraRef.current);
  }, []);

  useLayoutEffect(() => {
    zoomRef.current = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    paintCamera(worldRef.current, cameraRef.current);
    publishSnapshot(cameraRef.current, performance.now(), true);
  }, [zoom, viewportSize.width, viewportSize.height, worldRef, publishSnapshot]);

  useLayoutEffect(() => {
    panFramesRef.current?.cancel();
    panningRef.current = false;
    paintCamera(worldRef.current, cameraRef.current);
    return () => { panFramesRef.current?.cancel(); panningRef.current = false; };
  }, [worldRef, worldRevision]);

  useEffect(() => {
    if (!trackedId || paused) {
      motionRef.current = createCameraMotion(cameraRef.current);
      return;
    }

    let active = true;
    let frameId: number | null = null;
    let lastFrameTime: number | null = null;
    let cachedWorld: HTMLDivElement | null = null;
    let worker: Element | null = null;
    const selector = `[data-worker-id="${CSS.escape(trackedId)}"]`;

    function scheduleFrame() {
      if (active && frameId === null && !document.hidden) frameId = requestAnimationFrame(animate);
    }

    function animate(now: number) {
      frameId = null;
      if (!active || document.hidden || panningRef.current) return;
      const world = worldRef.current;
      if (!world?.isConnected) {
        lastFrameTime = null;
        scheduleFrame();
        return;
      }
      const canvasPoint = getCanvasWorkerPosition(world, trackedId!);
      if (!canvasPoint && (cachedWorld !== world || !worker?.isConnected || !world.contains(worker))) {
        cachedWorld = world;
        worker = world.querySelector(selector);
        paintCamera(world, cameraRef.current);
      }

      const point = canvasPoint ?? readRenderedWorkerPosition(worker);
      if (!point) {
        lastFrameTime = null;
        scheduleFrame();
        return;
      }
      const scale = renderedZoom(world, zoomRef.current);
      const target = { x: (WORLD_W / 2 - point.x) * scale, y: (WORLD_H / 2 - point.y) * scale };
      const seconds = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      motionRef.current = advanceCameraMotion(motionRef.current, target, seconds);
      const position = motionRef.current.position;
      cameraRef.current = position;
      paintCamera(world, position);
      publishSnapshot(position, now);
      scheduleFrame();
    }

    function stopFrames() {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      lastFrameTime = null;
    }

    function visibilityChanged() {
      stopFrames();
      motionRef.current = createCameraMotion(cameraRef.current);
      publishSnapshot(cameraRef.current, performance.now(), true);
      scheduleFrame();
    }

    document.addEventListener("visibilitychange", visibilityChanged);
    scheduleFrame();
    return () => {
      active = false;
      stopFrames();
      document.removeEventListener("visibilitychange", visibilityChanged);
      // The layout cleanup marks unmount before this passive cleanup runs.
      publishSnapshot(cameraRef.current, performance.now(), true);
    };
  }, [trackedId, paused, worldRevision, worldRef, publishSnapshot]);

  return { camera, cameraRef, setCamera, beginPan, panCamera, endPan };
}
