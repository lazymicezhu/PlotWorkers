"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./settings-panel.module.css";

export function SettingsPanel({ title, titleId = "settings-title", page, onClose, onBack, children, actions, feedback, initialFocus = "close", descriptionId }: {
  title: string;
  titleId?: string;
  page: string;
  onClose?: () => void;
  onBack?: () => void;
  children: ReactNode;
  actions?: ReactNode;
  feedback?: ReactNode;
  initialFocus?: "close" | "action";
  descriptionId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const target = initialFocus === "action"
      ? actionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      : closeRef.current;
    target?.focus({ preventScroll: true });
    return () => dialog.close();
  }, [initialFocus]);

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
    if (!dialogRef.current?.open) return;
    const target = backRef.current ?? closeRef.current
      ?? actionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus({ preventScroll: true });
  }, [page]);

  return <dialog
    ref={dialogRef}
    className={`settings-dialog ${styles.dialog}`}
    data-settings-page={page}
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); (onBack ?? onClose)?.(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose?.();
    }}
    onPointerDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
  >
    <header className={styles.head}>
      {onBack && <button ref={backRef} className={`${styles.icon} ${styles.back}`} aria-label="返回" onClick={onBack}>←</button>}
      <h2 id={titleId}>{title}</h2>
      {onClose && <button ref={closeRef} className={`${styles.icon} ${styles.close}`} aria-label="关闭设置" onClick={onClose}>×</button>}
    </header>
    <div ref={bodyRef} className={styles.body}>{children}</div>
    <div ref={actionsRef} className={styles.actions}>{actions}</div>
    <footer className={styles.feedback}>{feedback}</footer>
  </dialog>;
}
