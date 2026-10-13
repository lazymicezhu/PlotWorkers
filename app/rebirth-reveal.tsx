"use client";

import { useEffect, useRef } from "react";
import { ForemanDescription } from "./foreman-description";
import { ForemanSprite } from "./foreman-sprite";
import styles from "./rebirth-reveal.module.css";

export function RebirthReveal({ onContinue, error }: { onContinue: () => void; error?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    continueRef.current?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="rebirth-reward-title"
      aria-describedby={error ? "rebirth-reward-description rebirth-save-error" : "rebirth-reward-description"}
      onCancel={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={styles.content}>
        <div className={styles.artwork} aria-hidden="true">
          <span className={styles.firstReward}>首次转生 · 永久伙伴</span>
          <div className={styles.stage}>
            <span className={styles.halo} />
            <span className={styles.orbit} />
            <span className={styles.ground} />
            <span className={styles.sparkleOne}>✦</span>
            <span className={styles.sparkleTwo}>✧</span>
            <div className={styles.character}><ForemanSprite commanding loop /></div>
          </div>
        </div>

        <section className={styles.details}>
          <h2 id="rebirth-reward-title">包工头</h2>
          <p id="rebirth-reward-description" className={styles.description}><ForemanDescription /></p>

          <dl className={styles.benefits}>
            <div><dt><span aria-hidden="true">↑</span> 驻守生产地块</dt><dd>生产效率翻倍</dd></div>
            <div><dt><span aria-hidden="true">♡</span> 驻守生活区</dt><dd>心情恢复速度翻倍</dd></div>
          </dl>
          <div className={styles.traits}><span>不消耗心情</span><span>占 1 个工位</span></div>

          {error && <p id="rebirth-save-error" className={styles.error} role="alert">{error}</p>}
          <button ref={continueRef} className={styles.continueButton} onClick={onContinue}>{error ? "重试并开启新工坊" : "带上包工头，开启新工坊"}<span aria-hidden="true">→</span></button>
          <p className={styles.continueHint}>{error ? "保存成功后进入新的游戏" : "点击后进入新的游戏"}</p>
        </section>
      </div>
    </dialog>
  );
}
