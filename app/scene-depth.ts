export const SCENE_DRAG_Z = 900_000;

export function sceneDepth(y: number, boost = 0) {
  const depth = 100_000 + Math.round(y) + boost;
  return Math.max(1_000, Math.min(800_000, depth));
}
