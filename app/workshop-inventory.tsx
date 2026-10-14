import { SPECIAL_ITEM_IDS, SPECIAL_ITEM_NAMES } from "./game-engine";
import type { GameState, SpecialItemId } from "./game-engine";
import { TabletIcon } from "./tablet-icon";

const itemDetails: Record<SpecialItemId, { icon: string; description: string }> = {
  canOpener: { icon: "can", description: "生活区恢复+50% · 120秒" },
  smartLeader: { icon: "robot", description: "机器人搬运速度+100% · 120秒" },
  holyLight: { icon: "bolt", description: "放置圣圈，圈内采集/加工/合成效率+100%，人物不消耗心情 · 60秒" },
  orderRefresh: { icon: "refresh-ticket", description: "立即新增一张订单 · 仅有空位时可用，最多同时保留两张" },
  goldenOrder: { icon: "golden-ticket", description: "选择一张订单，无需消耗材料即可完成，并领取全部奖励" },
};

export function WorkshopInventory({ game, infiniteResources, onUse }: {
  game: GameState;
  infiniteResources: boolean;
  onUse: (id: SpecialItemId) => void;
}) {
  const unlocked = game.plots.some((plot) => plot.type === "synthesis");
  const liveOrders = game.orders.filter((order) => order.remaining > 0).length;
  const activeHolyLights = game.effects.holyLight.filter((effect) => effect.remaining > 0);

  return <>
    <h2>特殊物品背包</h2>
    {SPECIAL_ITEM_IDS.map((id) => {
      const reason = id === "orderRefresh"
        ? !unlocked ? "建造合成区后可用" : liveOrders >= 2 ? "订单已满" : ""
        : id === "goldenOrder" && liveOrders === 0 ? "暂无订单" : "";
      return <div className={`special-row ${id === "goldenOrder" ? "special-golden" : ""}`} key={id}>
        <i className="tablet-item-icon"><TabletIcon name={itemDetails[id].icon} size={21} /></i>
        <span>
          <strong>{SPECIAL_ITEM_NAMES[id]} ×{infiniteResources ? "∞" : game.inventory.specials[id]}{id === "goldenOrder" && <em className="special-rarity">稀有</em>}</strong>
          <small>{itemDetails[id].description}</small>
        </span>
        <button type="button" aria-label={`使用${SPECIAL_ITEM_NAMES[id]}`} disabled={game.inventory.specials[id] <= 0 || !!reason} title={reason || itemDetails[id].description} onClick={() => onUse(id)}>
          {reason || (id === "goldenOrder" ? "选择订单" : "使用")}
        </button>
      </div>;
    })}
    <div className="effect-summary">生效中：罐头起子 {Math.ceil(game.effects.canOpener)}s · 智械领袖 {Math.ceil(game.effects.smartLeader)}s · 圣光 {activeHolyLights.length}处{activeHolyLights.length > 0 && `（${activeHolyLights.map((effect) => `${Math.ceil(effect.remaining)}s`).join(" / ")}）`}</div>
  </>;
}
