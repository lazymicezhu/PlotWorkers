"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

type Feedback = {
  animation?: Animation;
  releaseTimer?: number;
  pressedAt: number;
  speed: number;
};

/** Scoped visual feedback never triggers or changes a button's action. */
export function useButtonFeedback(rootRef: RefObject<HTMLElement | null>, slow = false): { replay: () => void } {
  const replayRef = useRef<() => void>(() => {});
  const speedRef = useRef(slow ? 3 : 1);
  const replay = useCallback(() => replayRef.current(), []);

  useEffect(() => {
    speedRef.current = slow ? 3 : 1;
  }, [slow]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const feedback = new Map<HTMLButtonElement, Feedback>();
    const pointers = new Map<number, HTMLButtonElement>();
    const keys = new Map<HTMLButtonElement, string>();
    const ripples = new Map<HTMLSpanElement, Animation>();
    const timers = new Set<number>();
    const replayTimers = new Set<number>();
    const replayButtons = new Set<HTMLButtonElement>();
    const recentInputs = new WeakMap<HTMLButtonElement, number>();

    function later(callback: () => void, delay: number, isReplay = false) {
      const id = window.setTimeout(() => {
        timers.delete(id);
        replayTimers.delete(id);
        callback();
      }, delay);
      timers.add(id);
      if (isReplay) replayTimers.add(id);
      return id;
    }

    function clearTimer(id: number | undefined) {
      if (id === undefined) return;
      window.clearTimeout(id);
      timers.delete(id);
      replayTimers.delete(id);
    }

    function enabled(button: HTMLButtonElement) {
      return button.isConnected && root!.contains(button)
        && !button.matches(":disabled") && button.getAttribute("aria-disabled") !== "true"
        && !button.closest('[inert], [data-button-feedback="off"], [hidden]')
        && button.getClientRects().length > 0
        && getComputedStyle(button).visibility === "visible";
    }

    function eventButton(target: EventTarget | null) {
      const button = target instanceof Element ? target.closest("button") : null;
      return button instanceof HTMLButtonElement && enabled(button) ? button : null;
    }

    function removeRipple(span: HTMLSpanElement) {
      ripples.get(span)?.cancel();
      ripples.delete(span);
      span.remove();
    }

    function reset(button: HTMLButtonElement) {
      const active = feedback.get(button);
      clearTimer(active?.releaseTimer);
      active?.animation?.cancel();
      feedback.delete(button);
      delete button.dataset.feedbackPressed;
      for (const span of ripples.keys()) {
        if (span.parentElement === button) removeRipple(span);
      }
    }

    function stopReplay() {
      for (const id of replayTimers) clearTimer(id);
      for (const button of replayButtons) reset(button);
      replayButtons.clear();
    }

    function ripple(button: HTMLButtonElement, speed: number, point?: { x: number; y: number }) {
      const rect = button.getBoundingClientRect();
      const width = button.offsetWidth;
      const height = button.offsetHeight;
      if (!width || !height || !rect.width || !rect.height) return;
      const x = point ? (point.x - rect.left) * width / rect.width : width / 2;
      const y = point ? (point.y - rect.top) * height / rect.height : height / 2;
      const diameter = Math.hypot(width, height) * 2;
      const span = document.createElement("span");
      span.dataset.feedbackRipple = "";
      span.setAttribute("aria-hidden", "true");
      Object.assign(span.style, {
        all: "initial", position: "absolute", display: "block", boxSizing: "border-box",
        pointerEvents: "none", borderRadius: "inherit", inset: "0", overflow: "hidden",
        color: "inherit", margin: "0", padding: "0", border: "0",
      });
      const disk = document.createElement("span");
      Object.assign(disk.style, {
        all: "initial", position: "absolute", display: "block", boxSizing: "border-box",
        pointerEvents: "none", borderRadius: "50%", color: "inherit", margin: "0",
        background: "currentColor", left: `${x}px`, top: `${y}px`,
        width: `${diameter}px`, height: `${diameter}px`, opacity: "0",
      });
      span.append(disk);
      button.append(span);
      const animation = disk.animate([
        { transform: "translate(-50%, -50%) scale(.06)", opacity: 0.1 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
      ], { duration: 460 * speed, easing: "cubic-bezier(.2,.7,.3,1)" });
      ripples.set(span, animation);
      animation.onfinish = () => removeRipple(span);
    }

    function press(button: HTMLButtonElement, point?: { x: number; y: number }) {
      if (!enabled(button)) return;
      const speed = speedRef.current;
      const currentScale = getComputedStyle(button).scale;
      reset(button);
      const active: Feedback = { pressedAt: performance.now(), speed };
      feedback.set(button, active);
      button.dataset.feedbackPressed = "";
      if (reducedMotion.matches) return;
      ripple(button, speed, point);
      active.animation = button.animate([
        { scale: currentScale === "none" ? "1" : currentScale },
        { scale: button.dataset.feedbackSize === "wide" ? ".99" : ".965" },
      ], { duration: 80 * speed, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
    }

    function release(button: HTMLButtonElement, cancelled = false) {
      const active = feedback.get(button);
      if (!active) return;
      const speed = active.speed;
      clearTimer(active.releaseTimer);
      const finish = () => {
        if (feedback.get(button) !== active) return;
        delete button.dataset.feedbackPressed;
        if (reducedMotion.matches || cancelled || !enabled(button)) {
          reset(button);
          return;
        }
        const currentScale = getComputedStyle(button).scale;
        active.animation?.cancel();
        const animation = button.animate([
          { scale: currentScale === "none" ? "1" : currentScale },
          { scale: button.dataset.feedbackSize === "wide" ? "1.004" : "1.015", offset: 0.6 },
          { scale: "1" },
        ], { duration: 240 * speed, easing: "cubic-bezier(.2,.7,.3,1)" });
        active.animation = animation;
        animation.onfinish = () => {
          animation.cancel();
          if (feedback.get(button) === active) feedback.delete(button);
        };
      };
      // A quick tap still reaches the pressed shape before the small rebound.
      const remaining = cancelled ? 0 : Math.max(0, 80 * speed - (performance.now() - active.pressedAt));
      if (remaining) active.releaseTimer = later(finish, remaining);
      else finish();
    }

    function pointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const button = eventButton(event.target);
      if (!button) return;
      stopReplay();
      recentInputs.set(button, performance.now());
      pointers.set(event.pointerId, button);
      press(button, { x: event.clientX, y: event.clientY });
    }

    function pointerEnd(event: PointerEvent) {
      const button = pointers.get(event.pointerId);
      if (!button) return;
      pointers.delete(event.pointerId);
      recentInputs.set(button, performance.now());
      const rect = button.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      release(button, event.type === "pointercancel" || outside);
    }

    function keyDown(event: KeyboardEvent) {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const button = eventButton(event.target);
      if (!button) return;
      stopReplay();
      recentInputs.set(button, performance.now());
      keys.set(button, event.key);
      press(button);
    }

    function keyUp(event: KeyboardEvent) {
      for (const [button, key] of keys) {
        if (key !== event.key) continue;
        keys.delete(button);
        recentInputs.set(button, performance.now());
        release(button);
      }
    }

    function click(event: MouseEvent) {
      const button = eventButton(event.target);
      if (!button || performance.now() - (recentInputs.get(button) ?? -Infinity) < 500) return;
      // Assistive technology may dispatch a click without pointer or key events.
      stopReplay();
      press(button);
      release(button);
    }

    function focusOut(event: FocusEvent) {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement) || !keys.has(button)) return;
      keys.delete(button);
      release(button, true);
    }

    function resetAll() {
      stopReplay();
      for (const id of timers) clearTimer(id);
      for (const button of feedback.keys()) reset(button);
      for (const span of ripples.keys()) removeRipple(span);
      pointers.clear();
      keys.clear();
    }

    function visibilityChange() {
      if (document.hidden) resetAll();
    }

    replayRef.current = () => {
      stopReplay();
      const speed = speedRef.current;
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-preview-sample]")).filter(enabled);
      buttons.forEach((button, index) => {
        later(() => {
          replayButtons.add(button);
          press(button);
          release(button);
        }, index * 360 * speed, true);
      });
    };

    root.addEventListener("pointerdown", pointerDown, true);
    root.addEventListener("keydown", keyDown, true);
    root.addEventListener("click", click, true);
    root.addEventListener("focusout", focusOut, true);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", resetAll);
    document.addEventListener("visibilitychange", visibilityChange);
    reducedMotion.addEventListener("change", resetAll);

    return () => {
      replayRef.current = () => {};
      resetAll();
      root.removeEventListener("pointerdown", pointerDown, true);
      root.removeEventListener("keydown", keyDown, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("focusout", focusOut, true);
      window.removeEventListener("pointerup", pointerEnd, true);
      window.removeEventListener("pointercancel", pointerEnd, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", resetAll);
      document.removeEventListener("visibilitychange", visibilityChange);
      reducedMotion.removeEventListener("change", resetAll);
    };
  }, [rootRef]);

  return { replay };
}
