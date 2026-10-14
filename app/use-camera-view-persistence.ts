"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CameraPoint } from "./camera-motion";
import { parseCameraView, serializeCameraView } from "./camera-view-state";
import { previewStorageKey } from "./preview-resources";

const VIEW_KEY = "green-realm-camera-view-v1";
const LEGACY_ZOOM_KEY = "green-realm-player-zoom";

/** Restore before displaying the world; persist the live camera, not its culling snapshot. */
export function useCameraViewPersistence({ worldRef, cameraRef, zoom, setZoom, setCamera }: {
  worldRef: RefObject<HTMLDivElement | null>;
  cameraRef: RefObject<CameraPoint>;
  zoom: number;
  setZoom: (zoom: number) => void;
  setCamera: (camera: CameraPoint) => void;
}) {
  const [restored, setRestored] = useState(false);
  const zoomRef = useRef(zoom);

  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useLayoutEffect(() => {
    const world = worldRef.current;
    const previousTransition = world?.style.transition ?? "";
    if (world) world.style.transition = "none";
    try {
      const view = parseCameraView(localStorage.getItem(previewStorageKey(VIEW_KEY)));
      if (view) {
        setZoom(view.zoom);
        setCamera(view.camera);
      } else {
        const legacyZoom = Number(localStorage.getItem(LEGACY_ZOOM_KEY));
        if (Number.isFinite(legacyZoom) && legacyZoom >= .28 && legacyZoom <= 1.5) setZoom(legacyZoom);
      }
    } catch {
      // Storage can be unavailable; the default view must still be usable.
    }
    // Browser-only preferences must be applied before the first visible paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { if (world) world.style.transition = previousTransition; });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (world) world.style.transition = previousTransition;
    };
  }, [setCamera, setZoom, worldRef]);

  useEffect(() => {
    if (!restored) return;
    const key = previewStorageKey(VIEW_KEY);
    let previous = "";
    const save = () => {
      try {
        const world = worldRef.current;
        // During zoom easing, save the scale actually on screen with its camera position.
        const renderedZoom = world?.offsetWidth ? world.getBoundingClientRect().width / world.offsetWidth : zoomRef.current;
        // Layout rounding may place an endpoint a few ulps outside the allowed range.
        const scale = Number.isFinite(renderedZoom) && renderedZoom > 0 ? Math.max(.28, Math.min(1.5, renderedZoom)) : zoomRef.current;
        const serialized = serializeCameraView({ camera: cameraRef.current, zoom: scale });
        if (serialized === previous) return;
        localStorage.setItem(key, serialized);
        previous = serialized;
      } catch {
        // A full or blocked store must never interrupt panning or tracking.
      }
    };
    const onHidden = () => { if (document.visibilityState === "hidden") save(); };
    // Never write during startup effect replay, or on every camera animation frame.
    const timer = window.setInterval(save, 2_000);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [restored, cameraRef, worldRef]);

  return restored;
}
