"use client";

import { ForemanProfile } from "./foreman-profile";
import { SettingsPanel } from "./settings-panel";
import panelStyles from "./settings-panel.module.css";
import styles from "./rebirth-reveal.module.css";

export function RebirthReveal({ onContinue, error }: { onContinue: () => void; error?: string }) {
  return (
    <SettingsPanel
      title="首次转生"
      titleId="rebirth-reward-title"
      page="reward"
      initialFocus="action"
      descriptionId={error ? "rebirth-reward-description rebirth-save-error" : "rebirth-reward-description"}
      actions={(
        <button className={`${panelStyles.button} ${panelStyles.solid}`} onClick={onContinue}>
          {error ? "重试并开启新工坊" : "带上包工头，开启新工坊"}
        </button>
      )}
      feedback={error ? <p id="rebirth-save-error" className={styles.error} role="alert">{error}</p> : undefined}
    >
      <ForemanProfile animated descriptionId="rebirth-reward-description" />
    </SettingsPanel>
  );
}
