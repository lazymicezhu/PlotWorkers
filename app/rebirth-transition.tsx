"use client";

import { useEffect, useRef } from "react";
import styles from "./rebirth-transition.module.css";

export { default as rebirthTransitionStyles } from "./rebirth-transition.module.css";

export function RebirthTransition({ onComplete }: { onComplete: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="正在转生"
      aria-describedby="rebirth-transition-message"
      aria-busy="true"
      tabIndex={-1}
      onCancel={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p id="rebirth-transition-message" className={styles.message} role="status">旧工坊正在归于大地…</p>
      <span
        className={styles.completionSignal}
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget || completedRef.current) return;
          completedRef.current = true;
          onComplete();
        }}
      />
    </dialog>
  );
}
