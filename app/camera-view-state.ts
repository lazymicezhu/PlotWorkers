export type CameraView = { camera: { x: number; y: number }; zoom: number };

const CAMERA_VIEW_VERSION = 1;
const MAX_CAMERA_OFFSET = 10_000_000;
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 1.5;
const WORKER_TRACKING_ZOOM = 1.05;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_CAMERA_OFFSET;
}

function isCameraView(value: unknown): value is CameraView {
  return isRecord(value) && isRecord(value.camera)
    && isCoordinate(value.camera.x) && isCoordinate(value.camera.y)
    && typeof value.zoom === "number" && Number.isFinite(value.zoom)
    && value.zoom >= MIN_ZOOM && value.zoom <= MAX_ZOOM;
}

/** Ignore missing, obsolete or corrupt browser preferences instead of moving off-scene. */
export function parseCameraView(serialized: string | null): CameraView | null {
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== CAMERA_VIEW_VERSION || !isCameraView(value)) return null;
    return { camera: { x: value.camera.x, y: value.camera.y }, zoom: value.zoom };
  } catch {
    return null;
  }
}

export function serializeCameraView(view: CameraView): string {
  if (!isCameraView(view)) throw new RangeError("Invalid camera view");
  return JSON.stringify({ version: CAMERA_VIEW_VERSION, camera: { x: view.camera.x, y: view.camera.y }, zoom: view.zoom });
}

/** Tracking should reveal the worker without repeatedly zooming in or zooming out. */
export function getWorkerTrackingZoom(currentZoom: number): number {
  if (!Number.isFinite(currentZoom)) return WORKER_TRACKING_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(WORKER_TRACKING_ZOOM, currentZoom));
}
