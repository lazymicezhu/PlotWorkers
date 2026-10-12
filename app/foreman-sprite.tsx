import styles from "./foreman-sprite.module.css";

/** Complete poses keep the hands, sleeves, and body connected while directing. */
export function ForemanSprite({ commanding, onCommandEnd, loop = false }: { commanding: boolean; onCommandEnd?: () => void; loop?: boolean }) {
  return (
    <span
      className={`worker-image foreman-sprite ${styles.sprite} ${commanding ? styles.commanding : ""} ${loop ? styles.looping : ""}`}
      data-foreman-pose={commanding ? "commanding" : "resting"}
      aria-hidden="true"
    >
      <span className={styles.frames} onAnimationEnd={(event) => {
        if (!loop && event.target === event.currentTarget) onCommandEnd?.();
      }} />
    </span>
  );
}
