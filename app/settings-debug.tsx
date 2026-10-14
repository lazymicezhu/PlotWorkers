"use client";

import { useState } from "react";
import { RESEARCH, SPECIAL_ITEM_IDS, SPECIAL_ITEM_NAMES, type GameState, type SpecialItemId } from "./game-engine";
import { DEBUG_MATERIAL_IDS, DEBUG_MATERIAL_NAMES, type DebugAction, type DebugResourceId } from "./debug-actions";
import panel from "./settings-panel.module.css";
import styles from "./settings-debug.module.css";

type Category = "coins" | "materials" | "items";
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const categories = [{ id: "coins", name: "金币" }, { id: "materials", name: "物资" }, { id: "items", name: "道具" }] as const;

export function SettingsDebug({ game, onAction }: {
  game: GameState;
  onAction: (action: DebugAction, success: string) => void;
}) {
  const [category, setCategory] = useState<Category>("coins");
  const [material, setMaterial] = useState<typeof DEBUG_MATERIAL_IDS[number]>("raw");
  const [item, setItem] = useState<SpecialItemId>("goldenOrder");
  const [amount, setAmount] = useState("1000");
  const resource: DebugResourceId = category === "coins" ? "coins" : category === "materials" ? material : item;
  const name = category === "coins" ? "金币" : category === "materials" ? DEBUG_MATERIAL_NAMES[material] : SPECIAL_ITEM_NAMES[item];
  const owned = category === "coins" ? game.coins : category === "materials" ? game.inventory[material] : game.inventory.specials[item];
  const quantity = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isSafeInteger(quantity) && quantity > 0;
  const unlocked = Object.values(game.research).filter((level) => level > 0).length;

  return <div className={styles.debug}>
    <section aria-labelledby="debug-resources-title">
      <h3 id="debug-resources-title">增加资源</h3>
      <div className={styles.categories} role="group" aria-label="资源分类">
        {categories.map((entry) => <button key={entry.id} type="button" aria-pressed={category === entry.id} onClick={() => {
          if (entry.id === category) return;
          setCategory(entry.id);
          setAmount(entry.id === "items" ? "1" : "1000");
        }}>{entry.name}</button>)}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (validAmount) onAction({ type: "add-resource", resource, amount: quantity }, `已增加 ${number.format(quantity)} ${name}`);
      }}>
        {category === "materials" && <div className={styles.field}>
          <div className={styles.fieldHeading}><label htmlFor="debug-material">物资种类</label><span id="debug-balance">持有 {number.format(owned)}</span></div>
          <select id="debug-material" aria-describedby="debug-balance" value={material} onChange={(event) => setMaterial(event.target.value as typeof material)}>
            {DEBUG_MATERIAL_IDS.map((id) => <option key={id} value={id}>{DEBUG_MATERIAL_NAMES[id]}</option>)}
          </select>
        </div>}
        {category === "items" && <div className={styles.field}>
          <div className={styles.fieldHeading}><label htmlFor="debug-item">道具种类</label><span id="debug-balance">持有 {number.format(owned)}</span></div>
          <select id="debug-item" aria-describedby="debug-balance" value={item} onChange={(event) => setItem(event.target.value as SpecialItemId)}>
            {SPECIAL_ITEM_IDS.map((id) => <option key={id} value={id}>{SPECIAL_ITEM_NAMES[id]}</option>)}
          </select>
        </div>}
        {category === "coins" && <p className={styles.balance}>当前{name}<strong>{number.format(owned)}</strong></p>}
        <label className={styles.field}>增加数量
          <input type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="debug-amount-help" />
        </label>
        <div className={styles.presets} role="group" aria-label="快捷数量">
          {(category === "items" ? [1, 10, 100] : [100, 1000, 10000]).map((value) => <button key={value} type="button" aria-pressed={quantity === value} onClick={() => setAmount(String(value))}>{number.format(value)}</button>)}
          <span id="debug-amount-help">可输入自定义正整数</span>
        </div>
        <button type="submit" className={`${panel.button} ${panel.solid} ${styles.add}`} disabled={!validAmount}>增加{name}</button>
      </form>
    </section>
    <section className={styles.research} aria-labelledby="debug-research-title">
      <div className={styles.sectionHead}><h3 id="debug-research-title">研究</h3><span>已解锁 {unlocked} / {Object.keys(RESEARCH).length} 项</span></div>
      <p>重置为未研究，研究投入归零，不返还金币。</p>
      <div className={styles.researchActions}>
        <button type="button" className={panel.button} onClick={() => onAction({ type: "reset-research" }, "全部研究已重置，订单追踪已停止")}>重置全部研究</button>
        <button type="button" className={`${panel.button} ${panel.primary}`} onClick={() => onAction({ type: "max-research" }, "全部研究已升至满级")}>全部研究满级</button>
      </div>
    </section>
  </div>;
}
