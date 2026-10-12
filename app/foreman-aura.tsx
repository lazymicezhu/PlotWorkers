import styles from "./foreman-aura.module.css";

/** Place inside a positioned plot with the same width and height as its artwork. */
export function ForemanAura() {
  return (
    <div className={styles.aura} aria-hidden="true">
      <svg className={styles.surface} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon className={styles.wash} points="50,1 99,50 50,99 1,50" />
        <polygon className={styles.outerGlow} points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
        <polygon className={styles.innerGlow} points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
        <polygon className={styles.rim} points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={`${styles.spark} ${styles.sparkOne}`} />
      <span className={`${styles.spark} ${styles.sparkTwo}`} />
      <span className={`${styles.spark} ${styles.sparkThree}`} />
    </div>
  );
}
