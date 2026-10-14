"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RESEARCH } from "./game-engine";
import type { GameState, ResearchId } from "./game-engine";
import { TabletIcon } from "./tablet-icon";
import styles from "./workshop-research.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const groups = [
  { id: "production", name: "生产工艺" },
  { id: "automation", name: "自动管理" },
  { id: "commerce", name: "商业合作" },
  { id: "special", name: "特殊地块" },
] as const;
type ResearchGroup = "all" | typeof groups[number]["id"];
const researchIds = Object.keys(RESEARCH) as ResearchId[];

function effect(id: ResearchId, level: number) {
  switch (id) {
    case "gather": return `采集速度 +${level * 10}%`;
    case "process": return `加工速度 +${level * 10}%`;
    case "synthesis": return `合成速度 +${level * 15}%`;
    case "management": return level ? "可升级每台机器人参数" : "机器人参数升级未解锁";
    case "planning": return level ? "可追踪订单并自动安排生产" : "订单生产计划未解锁";
    case "orders": return `订单金币奖励 +${level * 10}%`;
    case "negotiation": return level ? `换单冷却 ${[300, 240, 180][level - 1]} 秒` : "换单未解锁";
    case "delivery": return `新订单期限 ${300 + level * 30} 秒`;
    case "fishing": return level ? "可放置摸鱼池" : "摸鱼池未解锁";
  }
}

export function WorkshopResearch({ game, targetId = null, onUpgrade }: {
  game: GameState;
  targetId?: ResearchId | null;
  onUpgrade: (id: ResearchId) => void;
}) {
  const titleId = useId();
  const targetCard = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<{ targetId: ResearchId | null; group: ResearchGroup }>(() => ({
    targetId, group: targetId ? RESEARCH[targetId].group : "all",
  }));
  // A new jump selects its category before the target card is mounted. Manual
  // filtering then stays put until another jump, even while the game updates.
  if (selection.targetId !== targetId) {
    setSelection({ targetId, group: targetId ? RESEARCH[targetId].group : "all" });
  }

  useEffect(() => {
    if (!targetId) return;
    // The tablet remounts its scroll container on page changes. Wait until the
    // target card is mounted, and do not repeat this on simulation updates.
    const frame = window.requestAnimationFrame(() => {
      const card = targetCard.current;
      if (!card) return;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetId]);

  return <section className={styles.page} aria-labelledby={titleId}>
    <h2 className={styles.heading} id={titleId}>研究</h2>
    <div className="tablet-plot-filters" role="group" aria-label="按分类筛选研究">
      <button type="button" aria-pressed={selection.group === "all"} aria-controls={`${titleId}-results`} onClick={() => setSelection({ targetId, group: "all" })}><span>全部</span><small aria-hidden="true">{researchIds.length}</small></button>
      {groups.map((group) => <button type="button" key={group.id} aria-pressed={selection.group === group.id} aria-controls={`${titleId}-results`} onClick={() => setSelection({ targetId, group: group.id })}><span>{group.name}</span><small aria-hidden="true">{researchIds.filter((id) => RESEARCH[id].group === group.id).length}</small></button>)}
    </div>
    <div id={`${titleId}-results`}>{groups.filter((group) => selection.group === "all" || selection.group === group.id).map((group) => <section className={styles.group} key={group.id} aria-labelledby={`${titleId}-${group.id}`}>
      <h3 id={`${titleId}-${group.id}`}>{group.name}</h3>
      <div className={styles.cards}>{researchIds.filter((id) => RESEARCH[id].group === group.id).map((id) => {
        const research = RESEARCH[id];
        const level = game.research[id];
        const cost = research.costs[level];
        const complete = cost === undefined;
        const unlockedOnce = research.costs.length === 1;
        const affordable = !complete && game.coins >= cost;
        const isFishing = id === "fishing";
        const placed = isFishing && game.plots.some((plot) => plot.type === "fishing");
        const fishingAction = placed ? "已放置" : complete ? "放置地块" : "免费解锁";
        return <article className={`${styles.card} ${complete ? styles.complete : ""} ${id === targetId ? styles.targeted : ""}`} key={id} ref={id === targetId ? targetCard : undefined} tabIndex={-1} data-research-id={id} aria-labelledby={`${titleId}-${id}`}>
          <div className={styles.cardTop}>
            <span className={styles.icon}><TabletIcon name="research" size={19} /></span>
            <h4 id={`${titleId}-${id}`}>{research.name}</h4>
            <span className={styles.level}>{placed ? "已放置" : unlockedOnce ? complete ? "已解锁" : "未解锁" : `Lv.${level} / ${research.costs.length}`}</span>
          </div>
          <div className={styles.steps} role="img" aria-label={`${research.name}，已完成${level}级，共${research.costs.length}级`}>
            {research.costs.map((_, index) => <i key={index} className={index < level ? styles.filled : undefined} />)}
          </div>
          <p className={styles.effect}>
            <span className={styles.current}>{placed ? "摸鱼池已放入场地" : effect(id, level)}</span>
            {!complete && <><span className={styles.arrow} aria-hidden="true">→</span><strong>{effect(id, level + 1)}</strong></>}
          </p>
          <p className={styles.detail}>{research.description}</p>
          <div className={styles.cardBottom}>
            <span className={`${styles.state} ${!complete && !affordable ? styles.insufficient : ""}`}>
              {isFishing ? placed ? "拖动人物入座" : complete ? "选择一处空地放置" : "免费获得一个摸鱼池" : complete ? unlockedOnce ? "功能已开放" : "研究已完成" : affordable ? unlockedOnce ? "可以解锁" : "可以升级" : `还差 ${number.format(Math.ceil(cost - game.coins))} 金币`}
            </span>
            <button type="button" disabled={isFishing ? placed : complete || !affordable} onClick={() => onUpgrade(id)} aria-label={isFishing ? `${fishingAction}：${research.name}` : complete ? `${research.name}${unlockedOnce ? "已解锁" : "已满级"}` : `${unlockedOnce ? "解锁" : "升级"}${research.name}，${number.format(cost)}金币${affordable ? "" : "，金币不足"}`}>
              {isFishing ? fishingAction : complete ? unlockedOnce ? "已解锁" : "已满级" : <><TabletIcon name="coin" size={13} />{number.format(cost)}<span>{unlockedOnce ? "解锁" : "升级"}</span></>}
            </button>
          </div>
        </article>;
      })}</div>
    </section>)}</div>
  </section>;
}
