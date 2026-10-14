"use client";

import { useId } from "react";
import { RESEARCH } from "./game-engine";
import type { GameState, ResearchId } from "./game-engine";
import { TabletIcon } from "./tablet-icon";
import styles from "./workshop-research.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const groups = [
  { id: "production", name: "生产工艺", description: "根据产线瓶颈，提高采集、加工和合成速度。" },
  { id: "automation", name: "自动管理", description: "解锁机器人参数升级和订单生产计划。" },
  { id: "commerce", name: "商业合作", description: "提高订单收益，让协商和交付更从容。" },
] as const;

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
  }
}

export function WorkshopResearch({ game, onUpgrade }: {
  game: GameState;
  onUpgrade: (id: ResearchId) => void;
}) {
  const titleId = useId();
  return <section className={styles.page} aria-labelledby={titleId}>
    <h2 className={styles.heading} id={titleId}>研究</h2>
    <p className={styles.note}>本轮持续生效，转生后重置。费用为本次升级所需金币。</p>
    {groups.map((group) => <section className={styles.group} key={group.id} aria-labelledby={`${titleId}-${group.id}`}>
      <h3 id={`${titleId}-${group.id}`}>{group.name}</h3>
      <p className={styles.description}>{group.description}</p>
      <div className={styles.cards}>{(Object.keys(RESEARCH) as ResearchId[]).filter((id) => RESEARCH[id].group === group.id).map((id) => {
        const research = RESEARCH[id];
        const level = game.research[id];
        const cost = research.costs[level];
        const complete = cost === undefined;
        const unlockedOnce = research.costs.length === 1;
        const affordable = !complete && game.coins >= cost;
        return <article className={`${styles.card} ${complete ? styles.complete : ""}`} key={id}>
          <div className={styles.cardTop}>
            <span className={styles.icon}><TabletIcon name="research" size={19} /></span>
            <h4>{research.name}</h4>
            <span className={styles.level}>{unlockedOnce ? complete ? "已解锁" : "未解锁" : `Lv.${level} / ${research.costs.length}`}</span>
          </div>
          <div className={styles.steps} role="img" aria-label={`${research.name}，已完成${level}级，共${research.costs.length}级`}>
            {research.costs.map((_, index) => <i key={index} className={index < level ? styles.filled : undefined} />)}
          </div>
          <p className={styles.effect}>
            <span className={styles.current}>{effect(id, level)}</span>
            {!complete && <><span className={styles.arrow} aria-hidden="true">→</span><strong>{effect(id, level + 1)}</strong></>}
          </p>
          <p className={styles.detail}>{research.description}</p>
          <div className={styles.cardBottom}>
            <span className={`${styles.state} ${!complete && !affordable ? styles.insufficient : ""}`}>
              {complete ? unlockedOnce ? "功能已开放" : "研究已完成" : affordable ? unlockedOnce ? "可以解锁" : "可以升级" : `还差 ${number.format(Math.ceil(cost - game.coins))} 金币`}
            </span>
            <button type="button" disabled={complete || !affordable} onClick={() => onUpgrade(id)} aria-label={complete ? `${research.name}${unlockedOnce ? "已解锁" : "已满级"}` : `${unlockedOnce ? "解锁" : "升级"}${research.name}，${number.format(cost)}金币${affordable ? "" : "，金币不足"}`}>
              {complete ? unlockedOnce ? "已解锁" : "已满级" : <><TabletIcon name="coin" size={13} />{number.format(cost)}<span>{unlockedOnce ? "解锁" : "升级"}</span></>}
            </button>
          </div>
        </article>;
      })}</div>
    </section>)}
  </section>;
}
