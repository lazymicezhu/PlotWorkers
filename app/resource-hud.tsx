"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GameState } from "./game-engine";
import { formatHudExact, formatHudGain, formatHudNumber } from "./hud-number";
import type { ResourceActivity, ResourceKind } from "./resource-activity";
import styles from "./resource-hud.module.css";

const resources = [
  { id: "coins", label: "金币" },
  { id: "raw", label: "原料" },
  { id: "cans", label: "罐头" },
  { id: "processed", label: "粗制/精制" },
  { id: "products", label: "螺丝/钢筋" },
  { id: "robot", label: "机器人时间/数量" },
] as const;
type ResourceId = typeof resources[number]["id"];
type Snapshot = Record<ResourceId, readonly number[]>;
type Receipt = { id: number; text: string; expiresAt: number };
type Receipts = Partial<Record<ResourceId, { gain?: Receipt; loss?: Receipt }>>;
const activityKinds: Partial<Record<ResourceId, readonly ResourceKind[]>> = {
  coins: ["coins"], raw: ["raw"], cans: ["cans"], processed: ["rough", "refined"], products: ["screws", "rebar"],
};

function isPair(id: ResourceId) {
  return id === "processed" || id === "products";
}

export function ResourceHud({ game, activity, showChanges, onSettings }: { game: GameState; activity: ResourceActivity; showChanges: boolean; onSettings: () => void }) {
  const { coins, schedulerSeconds, schedulerBots } = game;
  const { raw, cans, rough, refined, screws, rebar } = game.inventory;
  const values = useMemo<Snapshot>(() => ({
    coins: [coins], raw: [raw], cans: [cans], processed: [rough, refined],
    products: [screws, rebar], robot: [Math.ceil(schedulerSeconds), schedulerBots],
  }), [coins, raw, cans, rough, refined, screws, rebar, schedulerSeconds, schedulerBots]);
  const latestActivity = useRef(activity);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Partial<Record<ResourceId, HTMLButtonElement>>>({});
  const [selected, setSelected] = useState<{ id: ResourceId; left: number } | null>(null);
  const [receipts, setReceipts] = useState<Receipts>({});
  const detailId = useId();

  useEffect(() => { latestActivity.current = activity; }, [activity]);

  useEffect(() => {
    if (!showChanges) return;
    let previous = latestActivity.current;
    let sequence = 0;
    // Read separate cumulative receipts so production and consumption cannot cancel
    // each other, even if several simulation steps are committed together.
    const timer = window.setInterval(() => {
      const current = latestActivity.current;
      const updates: Receipts = {};
      const now = performance.now();
      if (!document.hidden) {
        for (const { id } of resources) {
          const kinds = activityKinds[id];
          if (!kinds) continue;
          for (const direction of ["gain", "loss"] as const) {
            const field = direction === "gain" ? "gained" : "spent";
            const amounts = kinds.map((kind) => Math.max(0, Number((current[kind][field] - previous[kind][field]).toPrecision(12))));
            if (amounts.some((amount) => amount > 0)) {
              const sign = direction === "gain" ? "+" : "−";
              updates[id] ??= {};
              updates[id][direction] = {
                id: ++sequence,
                text: amounts.map((amount) => `${amount > 0 ? sign : ""}${formatHudGain(amount)}`).join("/"),
                expiresAt: now + 1000,
              };
            }
          }
        }
      }
      previous = current;
      setReceipts((old) => {
        const next: Receipts = {};
        let changed = false;
        for (const { id } of resources) {
          for (const direction of ["gain", "loss"] as const) {
            const prior = old[id]?.[direction];
            const receipt = updates[id]?.[direction] ?? (prior && prior.expiresAt > now ? prior : undefined);
            if (receipt !== prior) changed = true;
            if (receipt) { next[id] ??= {}; next[id][direction] = receipt; }
          }
        }
        return changed ? next : old;
      });
    }, 150);
    const resetBaseline = () => { previous = latestActivity.current; setReceipts({}); };
    document.addEventListener("visibilitychange", resetBaseline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resetBaseline);
    };
  }, [showChanges]);

  useEffect(() => {
    if (!selected) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setSelected(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [selected]);

  const details = selected && (selected.id === "robot"
    ? `${formatHudExact(schedulerSeconds)} 秒 / ${formatHudExact(schedulerBots)} 台`
    : values[selected.id].map(formatHudExact).join(" / "));

  return <header
    ref={headerRef}
    className="hud"
    aria-label="工坊资源状态栏"
    onPointerDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        if (selected) {
          event.stopPropagation();
          event.preventDefault();
          buttonRefs.current[selected.id]?.focus({ preventScroll: true });
          setSelected(null);
        }
        return;
      }
      event.stopPropagation();
    }}
  >
    {resources.map(({ id, label }) => {
      const paired = isPair(id);
      const warning = id === "raw" ? raw <= 0 : id === "cans" ? cans < 20 : id === "robot" && schedulerSeconds < 60;
      const className = [styles.card, paired ? styles.pair : "", id === "robot" ? styles.robot : "", id === "coins" ? styles.gold : "", warning ? styles.warning : ""].filter(Boolean).join(" ");
      if (id === "robot" && schedulerBots <= 0) return <div key={id} className={`${className} ${styles.empty}`} aria-hidden="true" />;
      const changes = showChanges ? receipts[id] : undefined;
      return <button
        key={id}
        type="button"
        ref={(element) => { if (element) buttonRefs.current[id] = element; else delete buttonRefs.current[id]; }}
        className={className}
        data-resource={id}
        aria-label={`查看${label}完整数值`}
        aria-expanded={selected?.id === id}
        aria-controls={selected?.id === id ? detailId : undefined}
        onClick={(event) => setSelected(selected?.id === id ? null : { id, left: Math.min(471, event.currentTarget.offsetLeft) })}
      >
        <span className={styles.caption}>{label}</span>
        <strong className={styles.values}>
          {id === "robot" ? <span className={styles.number}>{formatHudNumber(values.robot[0], true)}s/{formatHudNumber(schedulerBots, true)}台</span>
            : paired ? <><span className={styles.number}>{formatHudNumber(values[id][0], true)}</span><span className={styles.divider}>/</span><span className={styles.number}>{formatHudNumber(values[id][1], true)}</span></>
              : <span className={styles.number}>{formatHudNumber(values[id][0])}</span>}
        </strong>
        {changes?.gain && <span key={changes.gain.id} className={`${styles.change} ${styles.gain}`} data-resource-change="gain" aria-hidden="true">{changes.gain.text}</span>}
        {changes?.loss && <span key={changes.loss.id} className={`${styles.change} ${styles.loss}`} data-resource-change="loss" aria-hidden="true">{changes.loss.text}</span>}
      </button>;
    })}
    <button type="button" className="settings-button" aria-label="设置与存档" title="设置与存档" aria-haspopup="dialog" onClick={() => { setSelected(null); onSettings(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 2a7 7 0 0 0-1.8 1l-2-.6-2 3.5 1.5 1.5a7 7 0 0 0 0 3.2l-1.5 1.5 2 3.5 2-.6a7 7 0 0 0 1.8 1l.5 2h4l.5-2a7 7 0 0 0 1.8-1l2 .6 2-3.5-1.5-1.5a7 7 0 0 0 0-3.2l1.5-1.5-2-3.5-2 .6a7 7 0 0 0-1.8-1L14 3z"/><circle cx="12" cy="12" r="3"/></svg></button>
    {selected && <div id={detailId} className={styles.details} style={{ left: selected.left }} role="region" aria-label={`${resources.find((resource) => resource.id === selected.id)?.label}完整数值`}>
      <span className={styles.detailLabel}>{resources.find((resource) => resource.id === selected.id)?.label}</span>
      <strong className={styles.detailValue}>{details}</strong>
    </div>}
  </header>;
}
