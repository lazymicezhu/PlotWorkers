"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./order-action-button.module.css";

/** Keep disabled actions hoverable without waiting for the browser's title timer. */
export function OrderActionButton({ label, hint, disabled, active, className, onClick }: {
  label: string;
  hint: string;
  disabled: boolean;
  active: boolean;
  className: string;
  onClick: () => void;
}) {
  const hintId = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const open = active && !dismissed && (hovered || focused);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    cancelClose();
    setHovered(false);
    setFocused(false);
    setDismissed(true);
  }, [cancelClose]);

  function contains(target: EventTarget | null) {
    return target instanceof Node && (trigger.current?.contains(target) || tooltip.current?.contains(target));
  }

  function enter(pointerType: string) {
    if (pointerType === "touch") return;
    cancelClose();
    setDismissed(false);
    setHovered(true);
  }

  function leave(target: EventTarget | null) {
    if (contains(target)) return;
    cancelClose();
    // A short exit grace lets the pointer cross the gap into the hint itself.
    // Opening has no timer, and cooldown ticks never change the open state.
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setHovered(false); }, 100);
  }

  useEffect(() => cancelClose, [cancelClose]);

  useLayoutEffect(() => {
    if (!disabled && document.activeElement === trigger.current) {
      trigger.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bubble = tooltip.current.getBoundingClientRect();
    const edge = 8;
    const left = Math.max(edge, Math.min(anchor.left + (anchor.width - bubble.width) / 2, window.innerWidth - bubble.width - edge));
    const above = anchor.top - bubble.height - edge;
    const top = Math.max(edge, Math.min(above >= edge ? above : anchor.bottom + edge, window.innerHeight - bubble.height - edge));
    // Layout measurement must finish before paint to avoid a misplaced first frame.
    setPosition((current) => current?.left === left && current.top === top ? current : { left, top });
  }, [open, hint]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const onOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !trigger.current?.contains(target) && !tooltip.current?.contains(target)) dismiss();
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !tooltip.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("pointerdown", onOutsidePress, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("pointerdown", onOutsidePress, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open, dismiss]);

  return <span ref={trigger} className={styles.trigger} tabIndex={disabled ? 0 : undefined}
    role={disabled ? "group" : undefined} aria-label={disabled ? `${label}，暂不可用` : undefined}
    aria-describedby={disabled && open ? hintId : undefined}
    onPointerEnter={(event) => enter(event.pointerType)} onPointerLeave={(event) => leave(event.relatedTarget)}
    onFocus={(event) => {
      if (!event.target.matches(":focus-visible")) return;
      cancelClose(); setDismissed(false); setFocused(true);
    }} onBlur={(event) => { if (!trigger.current?.contains(event.relatedTarget)) setFocused(false); }}>
    <button type="button" className={className} disabled={disabled} aria-describedby={open ? hintId : undefined} onClick={() => { if (!disabled) onClick(); }}>{label}</button>
    {open && createPortal(<div ref={tooltip} id={hintId} role="tooltip" className={styles.tooltip}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
      onPointerEnter={(event) => enter(event.pointerType)} onPointerLeave={(event) => leave(event.relatedTarget)}>{hint}</div>, document.body)}
  </span>;
}
