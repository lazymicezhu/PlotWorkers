import { ForemanDescription } from "./foreman-description";
import { ForemanSprite } from "./foreman-sprite";
import styles from "./foreman-profile.module.css";

export function ForemanProfile({ animated = false, descriptionId }: { animated?: boolean; descriptionId?: string }) {
  return (
    <div className={styles.profile}>
      <figure className={styles.artwork}>
        {animated ? (
          <div className={styles.character} role="img" aria-label="戴金色安全帽的包工头">
            <ForemanSprite commanding loop />
          </div>
        ) : (
          // The existing game portrait is already sized for this compact display.
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/foreman.png" alt="戴金色安全帽的包工头" width="112" height="168" />
        )}
      </figure>
      <div className={styles.copy}>
        <p className={styles.role}>专属守护工人</p>
        <h3 className={styles.name}>包工头</h3>
        <p id={descriptionId} className={styles.description}><ForemanDescription /></p>
      </div>
      <dl className={styles.benefits}>
        <div><dt>驻守生产地块</dt><dd>生产效率翻倍</dd></div>
        <div><dt>驻守生活区</dt><dd>心情恢复速度翻倍</dd></div>
      </dl>
    </div>
  );
}
