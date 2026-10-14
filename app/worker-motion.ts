type Point = { x: number; y: number };

/** CSS individual translate reports the currently painted position, not its destination. */
export function parseWorkerTranslation(value: string): Point | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2 || parts.some((part) => !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(part))) return null;
  const [x, y] = parts.map(Number.parseFloat);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function readRenderedWorkerPosition(element: Element | null): Point | null {
  if (element?.hasAttribute("data-fishing-worker")) {
    const x = Number(element.getAttribute("data-world-x"));
    const y = Number(element.getAttribute("data-world-y"));
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return element ? parseWorkerTranslation(getComputedStyle(element).translate) : null;
}

export function facingForDestination(position: Point | null, destinationX: number, previous: "left" | "right") {
  if (!position || !Number.isFinite(destinationX) || Math.abs(destinationX - position.x) < .5) return previous;
  return destinationX < position.x ? "left" as const : "right" as const;
}
