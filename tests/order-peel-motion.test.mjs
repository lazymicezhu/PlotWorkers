import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { animateOrderPeel } from "../app/order-peel-motion.ts";

class ElementStub {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.style = {
      height: "", marginBottom: "", overflow: "", clipPath: "", visibility: "",
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(child) { child.parentElement = this; this.children.push(child); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this.isConnected = false;
  }
  set innerHTML(markup) {
    // Only the SVG elements queried by the animation need DOM identities.
    this.children = [];
    for (const match of markup.matchAll(/<(linearGradient|path)\b/g)) this.append(new ElementStub(match[1]));
  }
  querySelectorAll(tagName) { return this.children.filter((child) => child.tagName === tagName); }
  querySelector(tagName) { return this.querySelectorAll(tagName)[0] ?? null; }
}

function harness(t, { width = 600, height = 320, reducedMotion = false } = {}) {
  let now = 0;
  let nextFrame = 0;
  const frames = new Map();
  const animations = [];
  const media = new EventTarget();
  media.matches = reducedMotion;
  const parent = new ElementStub();
  const slot = new ElementStub();
  const paper = new ElementStub("article");
  const layer = new ElementStub();
  parent.append(slot);
  slot.append(paper);
  slot.append(layer);
  paper.offsetWidth = width;
  paper.offsetHeight = height;
  slot.animate = (keyframes, options) => {
    let resolve, reject;
    const animation = {
      keyframes, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      cancelled: false, completed: false,
      finish() { this.completed = true; resolve(); },
      cancel() { this.cancelled = true; reject(new Error("animation cancelled")); },
    };
    animations.push(animation);
    return animation;
  };
  const replacements = {
    document: { createElementNS: (_namespace, name) => new ElementStub(name) },
    matchMedia: () => media,
    getComputedStyle: (element) => { assert.equal(element, parent); return { rowGap: "13px" }; },
    performance: { now: () => now },
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => { frames.delete(id); },
  };
  for (const [name, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  return {
    slot, paper, layer, frames, animations, media,
    frame(at) {
      now = at;
      const queued = [...frames.values()];
      frames.clear();
      for (const callback of queued) callback(at);
    },
    reduce() { media.matches = true; media.dispatchEvent(new Event("change")); },
  };
}

function paperPolygon(paper) {
  assert.match(paper.style.clipPath, /^polygon\(/);
  const values = [...paper.style.clipPath.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  return Array.from({ length: values.length / 2 }, (_, index) => values.slice(index * 2, index * 2 + 2));
}

function polygonArea(points) {
  return Math.abs(points.reduce((area, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return area + x * nextY - y * nextX;
  }, 0)) / 2;
}

const microtasks = async () => { await Promise.resolve(); await Promise.resolve(); };

test("a visible corner, curled fold and opacity exist before any animation frame runs", async (t) => {
  const h = harness(t);
  const controller = new AbortController();
  const done = animateOrderPeel(h.slot, h.paper, h.layer, controller.signal);
  assert.equal(h.frames.size, 1, "only the advancing frame should be queued");
  assert.equal(h.layer.children.length, 1);
  const overlay = h.layer.children[0];
  const points = paperPolygon(h.paper);
  const cutWidth = h.paper.offsetWidth - Math.max(...points.filter(([, y]) => y === 0).map(([x]) => x));
  assert.ok(cutWidth >= 16 && cutWidth <= 20, `600×320 card should start with an evident corner, got ${cutWidth}px`);
  assert.ok(polygonArea(points) < h.paper.offsetWidth * h.paper.offsetHeight, "the clipping must already remove some paper");
  assert.ok(Number(overlay.style.opacity) >= .7, "the initial fold must already be visible");
  const fold = overlay.querySelectorAll("path")[0];
  assert.match(fold.getAttribute("d"), /^M .+ Q .+ Z$/);
  const gradient = overlay.querySelector("linearGradient");
  assert.notEqual(gradient.getAttribute("x1"), gradient.getAttribute("x2"), "the curl must have width instead of lying flat");
  assert.equal(h.slot.style.height, "320px");
  controller.abort();
  assert.equal(await done, false);
});

test("the first two frames advance smoothly and peeling lasts 1200ms before the 220ms collapse", async (t) => {
  const h = harness(t);
  const controller = new AbortController();
  const done = animateOrderPeel(h.slot, h.paper, h.layer, controller.signal);
  const initialArea = polygonArea(paperPolygon(h.paper));
  const initialCorner = paperPolygon(h.paper)[1][0];
  h.frame(16);
  const firstArea = polygonArea(paperPolygon(h.paper));
  const firstCorner = paperPolygon(h.paper)[1][0];
  h.frame(32);
  const secondArea = polygonArea(paperPolygon(h.paper));
  const secondCorner = paperPolygon(h.paper)[1][0];
  assert.ok(initialArea > firstArea && firstArea > secondArea, "paper should disappear continuously from the very first frame");
  assert.ok(initialCorner - firstCorner > 5, "the first frame must visibly move beyond its initial cut");
  assert.ok(Math.abs((initialCorner - firstCorner) - (firstCorner - secondCorner)) < 1, "the initial motion must not jump between frames");
  h.frame(1199);
  assert.equal(h.animations.length, 0, "do not shorten the authored peel duration");
  h.frame(1200);
  await microtasks();
  assert.equal(h.frames.size, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(h.paper.style.visibility, "hidden");
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].options.duration, 220);
  assert.deepEqual(h.animations[0].keyframes, [
    { height: "320px", marginBottom: "0px" },
    { height: "0px", marginBottom: "-13px" },
  ]);
  h.animations[0].finish();
  assert.equal(await done, true);
  assert.equal(h.slot.style.height, "0px");
  assert.equal(h.slot.style.marginBottom, "-13px");
  assert.equal(h.animations[0].cancelled, true, "the finished Web Animation must not retain styles");
  assert.equal(getEventListeners(h.media, "change").length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("aborting a peel restores authored styles and removes its frame, SVG and listeners", async (t) => {
  const h = harness(t);
  Object.assign(h.slot.style, { height: "auto", marginBottom: "4px", overflow: "visible" });
  Object.assign(h.paper.style, { clipPath: "inset(1px)", visibility: "visible" });
  const controller = new AbortController();
  const done = animateOrderPeel(h.slot, h.paper, h.layer, controller.signal);
  h.frame(160);
  controller.abort();
  assert.equal(await done, false);
  assert.equal(h.slot.style.height, "auto");
  assert.equal(h.slot.style.marginBottom, "4px");
  assert.equal(h.slot.style.overflow, "visible");
  assert.equal(h.paper.style.clipPath, "inset(1px)");
  assert.equal(h.paper.style.visibility, "visible");
  assert.equal(h.slot.style["--peel-progress"], undefined);
  assert.equal(h.frames.size, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(h.animations.length, 0);
  assert.equal(getEventListeners(h.media, "change").length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("aborting during collapse cancels it and restores the original paper", async (t) => {
  const h = harness(t);
  const controller = new AbortController();
  const done = animateOrderPeel(h.slot, h.paper, h.layer, controller.signal);
  h.frame(1200);
  await microtasks();
  assert.equal(h.animations.length, 1);
  controller.abort();
  assert.equal(await done, false);
  assert.equal(h.animations[0].cancelled, true);
  assert.equal(h.slot.style.height, "");
  assert.equal(h.slot.style.marginBottom, "");
  assert.equal(h.paper.style.visibility, "");
  assert.equal(h.paper.style.clipPath, "");
  assert.equal(h.frames.size, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(getEventListeners(h.media, "change").length, 0);
});

test("reduced motion skips both animated phases and leaves no temporary elements", async (t) => {
  const h = harness(t, { reducedMotion: true });
  const controller = new AbortController();
  assert.equal(await animateOrderPeel(h.slot, h.paper, h.layer, controller.signal), true);
  assert.equal(h.frames.size, 0);
  assert.equal(h.animations.length, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(h.slot.style.height, "0px");
  assert.equal(h.paper.style.visibility, "hidden");
  assert.equal(getEventListeners(h.media, "change").length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("enabling reduced motion during peeling finishes without waiting for another frame", async (t) => {
  const h = harness(t);
  const controller = new AbortController();
  const done = animateOrderPeel(h.slot, h.paper, h.layer, controller.signal);
  h.frame(100);
  h.reduce();
  assert.equal(await done, true);
  assert.equal(h.frames.size, 0);
  assert.equal(h.animations.length, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(getEventListeners(h.media, "change").length, 0);
});

test("an already-aborted request never touches the DOM or schedules work", async (t) => {
  const h = harness(t);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await animateOrderPeel(h.slot, h.paper, h.layer, controller.signal), false);
  assert.equal(h.frames.size, 0);
  assert.equal(h.layer.children.length, 0);
  assert.equal(h.slot.style.height, "");
  assert.equal(h.paper.style.clipPath, "");
});
