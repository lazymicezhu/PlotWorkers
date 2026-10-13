const svgNS = "http://www.w3.org/2000/svg";
let peelSerial = 0;

function clippedPaper(width: number, height: number, crease: number) {
  const corners = [[0, 0], [width, 0], [width, height], [0, height]];
  const points: number[][] = [];
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index], b = corners[(index + 1) % corners.length];
    const da = a[0] - a[1] - crease, db = b[0] - b[1] - crease;
    if (da <= 0) points.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return points.length ? `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(",")})` : "polygon(0 100%,0 100%,0 100%)";
}

/** Owns only transient styles and the empty fold layer; React owns the card lifetime. */
export async function animateOrderPeel(slot: HTMLElement, paper: HTMLElement, layer: HTMLElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || !slot.isConnected) return false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  // The tablet scales as a whole. Clip-path, slot height and the SVG fold all
  // use untransformed layout pixels, never the scaled viewport rectangle.
  const width = paper.offsetWidth;
  const height = paper.offsetHeight;
  const gap = Number.parseFloat(getComputedStyle(slot.parentElement!).rowGap) || 0;
  const original = {
    height: slot.style.height, marginBottom: slot.style.marginBottom, overflow: slot.style.overflow,
    clipPath: paper.style.clipPath, visibility: paper.style.visibility,
  };
  const overlay = document.createElementNS(svgNS, "svg");
  const gradientId = `workshop-order-fold-${++peelSerial}`;
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "width:100%;height:100%;overflow:visible;display:block";
  overlay.innerHTML = `<defs><linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#adb39c"/><stop offset=".14" stop-color="#dadfc9"/><stop offset=".42" stop-color="#fbfbed"/><stop offset=".72" stop-color="#fffef7"/><stop offset="1" stop-color="#e6e8d8"/></linearGradient></defs><path fill="url(#${gradientId})"/><path fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width=".8"/>`;
  const [fold, edge] = overlay.querySelectorAll("path");
  const gradient = overlay.querySelector("linearGradient")!;
  let frame = 0;
  let collapse: Animation | null = null;
  let finishPeel: (() => void) | undefined;
  let aborted = false;

  function restore() {
    slot.style.height = original.height;
    slot.style.marginBottom = original.marginBottom;
    slot.style.overflow = original.overflow;
    paper.style.clipPath = original.clipPath;
    paper.style.visibility = original.visibility;
    slot.style.removeProperty("--peel-progress");
  }
  function abort() {
    aborted = true;
    cancelAnimationFrame(frame);
    collapse?.cancel();
    finishPeel?.();
    restore();
  }
  function reduceMotion() {
    if (!reduced.matches) return;
    cancelAnimationFrame(frame);
    finishPeel?.();
    collapse?.finish();
  }
  signal.addEventListener("abort", abort, { once: true });
  reduced.addEventListener("change", reduceMotion);
  slot.style.height = `${height}px`;
  layer.append(overlay);

  try {
    if (!reduced.matches && width > 0 && height > 0) await new Promise<void>((resolve) => {
      const started = performance.now();
      finishPeel = resolve;
      function draw(now: number) {
        if (aborted || !slot.isConnected || reduced.matches) { resolve(); return; }
        const t = Math.min(1, (now - started) / 900);
        const progress = t < .18 ? .045 * (t / .18) ** 2 : .045 + .955 * ((t - .18) / .82) ** 1.2;
        const crease = width - (width + height) * progress;
        paper.style.clipPath = clippedPaper(width, height, crease);
        const y0 = Math.max(0, -crease), y1 = Math.min(height, width - crease);
        const ax = crease + y0, ay = y0, bx = crease + y1, by = y1;
        const span = Math.max(0, (y1 - y0) * Math.SQRT2);
        const curl = Math.min(42, span * .28) * Math.sin(Math.PI * Math.min(1, t * 1.06)) ** .45;
        const dx = -curl / Math.SQRT2, dy = curl / Math.SQRT2;
        fold.setAttribute("d", `M ${ax} ${ay} L ${bx} ${by} Q ${bx + dx * 1.7} ${by + dy * .3} ${bx + dx} ${by + dy} L ${ax + dx} ${ay + dy} Q ${ax + dx * .3} ${ay + dy * 1.7} ${ax} ${ay} Z`);
        edge.setAttribute("d", `M ${ax + dx} ${ay + dy} L ${bx + dx} ${by + dy}`);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        gradient.setAttribute("x1", String(mx)); gradient.setAttribute("y1", String(my));
        gradient.setAttribute("x2", String(mx + dx)); gradient.setAttribute("y2", String(my + dy));
        const lift = Math.sin(Math.PI * t);
        overlay.style.filter = `drop-shadow(${3 + lift * 4}px ${-3 - lift * 4}px ${3 + lift * 6}px rgba(57,67,40,${.1 + lift * .14}))`;
        overlay.style.opacity = String(Math.min(1, t * 14, (1 - t) * 12));
        slot.style.setProperty("--peel-progress", String(progress));
        if (t < 1) frame = requestAnimationFrame(draw);
        else resolve();
      }
      frame = requestAnimationFrame(draw);
    });
    cancelAnimationFrame(frame);
    if (aborted || !slot.isConnected) return false;
    paper.style.visibility = "hidden";
    overlay.remove();
    slot.style.overflow = "hidden";
    slot.style.setProperty("--peel-progress", "1");
    if (!reduced.matches && typeof slot.animate === "function") {
      collapse = slot.animate([
        { height: `${height}px`, marginBottom: "0px" },
        { height: "0px", marginBottom: `${-gap}px` },
      ], { duration: 180, easing: "cubic-bezier(.3,0,.2,1)", fill: "forwards" });
      await collapse.finished.catch(() => {});
    }
    if (aborted || !slot.isConnected) return false;
    slot.style.height = "0px";
    slot.style.marginBottom = `${-gap}px`;
    collapse?.cancel();
    return true;
  } finally {
    cancelAnimationFrame(frame);
    reduced.removeEventListener("change", reduceMotion);
    signal.removeEventListener("abort", abort);
    overlay.remove();
    if (aborted) restore();
  }
}
