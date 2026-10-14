"use client";

import { useCallback, useLayoutEffect, useId, useRef, useState } from "react";
import { getOrderProductionStatus, orderCoinReward, orderDuration, RECIPES, SYNTHESIS_RECIPES } from "./game-engine";
import type { GameState, OrderState } from "./game-engine";
import { createOrderDeliveryGate, mergeRetainedOrders } from "./order-delivery-presentation";
import type { RetainedOrder } from "./order-delivery-presentation";
import { animateOrderPeel } from "./order-peel-motion";
import { isGoldenOrderConfirmationCurrent } from "./order-ticket-confirmation";
import { TabletIcon } from "./tablet-icon";
import { OrderActionButton } from "./order-action-button";
import styles from "./workshop-orders.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
type OrderCardData = {
  id: string;
  order: OrderState;
  available: [number, number];
  coins: number;
  phase: "live" | "leaving";
  tracking: boolean;
  production: ReturnType<typeof getOrderProductionStatus> | null;
};

function OrderCard({ card, planningUnlocked, negotiationUnlocked, canStartTracking, refreshCooldown, hasGoldenTicket, onTrack, onCancelTracking, onRefresh, onDeliver, onGoldenRequest, onFinish }: {
  card: OrderCardData;
  planningUnlocked: boolean;
  negotiationUnlocked: boolean;
  canStartTracking: boolean;
  refreshCooldown: number;
  hasGoldenTicket: boolean;
  onTrack: (id: string) => void;
  onCancelTracking: () => void;
  onRefresh: (id: string) => void;
  onDeliver: (card: OrderCardData) => void;
  onGoldenRequest: (card: OrderCardData) => void;
  onFinish: (id: string) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const { order, phase } = card;
  const remaining = Math.max(0, order.remaining);
  const timeProgress = Math.min(1, remaining / orderDuration(order));
  const ready = order.remaining > 0 && card.available[0] >= order.processed.amount && card.available[1] >= order.synthesized.amount;

  useLayoutEffect(() => {
    if (phase !== "leaving" || !slot.current || !paper.current || !fold.current) return;
    const controller = new AbortController();
    void animateOrderPeel(slot.current, paper.current, fold.current, controller.signal).then((finished) => {
      if (finished && !controller.signal.aborted) onFinish(order.id);
    }, () => {
      // A visual failure must not leave a card stuck after its trade has succeeded.
      if (!controller.signal.aborted) onFinish(order.id);
    });
    return () => controller.abort();
  }, [phase, order.id, onFinish]);

  return <div
    ref={slot}
    className={`${styles.slot} ${phase === "leaving" ? styles.delivering : ""}`}
    data-order-id={order.id}
    data-delivery-state={phase}
    aria-busy={phase !== "live" || undefined}
  >
    <article ref={paper} className={`${styles.sticker} ${remaining <= 60 ? styles.expiring : ""}`} aria-label={`订单，${RECIPES[order.processed.kind].name}和${SYNTHESIS_RECIPES[order.synthesized.kind].name}`}>
      <span className={styles.countdownFill} aria-hidden="true" style={{ width: `${timeProgress * 100}%` }} />
      <div className={styles.row}>
        <span className={styles.time} role="timer" aria-live="off">剩余 {Math.ceil(remaining)} 秒</span>
        <span className={`${styles.status} ${ready ? styles.ready : ""}`}>{phase !== "live" ? "交付中" : ready ? "可以交付" : "库存不足"}</span>
      </div>
      <div className={styles.materialGrid}>{[order.processed, order.synthesized].map((item, index) => {
        const name = item.kind === "rough" || item.kind === "refined" ? RECIPES[item.kind].name : SYNTHESIS_RECIPES[item.kind].name;
        const amount = Math.min(item.amount, Math.max(0, Math.floor(card.available[index])));
        return <div key={item.kind} className={styles.material}>
          <div className={styles.resource}><span>{name}</span><strong>{number.format(amount)}<small> / {number.format(item.amount)}</small></strong></div>
          <div className={styles.progress} role="progressbar" aria-label={`${name}库存`} aria-valuemin={0} aria-valuemax={item.amount} aria-valuenow={amount}>
            <i style={{ width: `${Math.min(100, amount / Math.max(1, item.amount) * 100)}%` }} />
          </div>
        </div>;
      })}</div>
      {card.tracking && card.production && <div className={`${styles.planStatus} ${card.production.phase === "blocked" ? styles.blocked : ""}`}>
        <strong>{card.production.label}</strong>
        <span>{card.production.detail}</span>
      </div>}
      <div className={`${styles.row} ${styles.bottom}`}>
        <span className={styles.reward}><TabletIcon name="coin" size={16} /><span>{number.format(card.coins)} 金币{order.reward === "special" && " + 随机特殊物品 ×1"}</span></span>
        <div className={styles.actions}>
          <button type="button" className={`${styles.secondaryButton} ${card.tracking ? styles.trackingButton : ""}`} disabled={phase !== "live" || !planningUnlocked || (!card.tracking && !canStartTracking)} onClick={() => card.tracking ? onCancelTracking() : onTrack(order.id)} title={!planningUnlocked ? "在研究中花费5,000金币解锁生产计划" : !card.tracking && !canStartTracking ? "请先交付或取消正在追踪的订单，并等待配方恢复" : "临时调整现有地块配方；交付或取消后恢复"}>
            {card.tracking ? "取消追踪" : "追踪"}
          </button>
          <OrderActionButton className={styles.secondaryButton} active={phase === "live"}
            disabled={phase !== "live" || !negotiationUnlocked || !!order.rerolled || refreshCooldown > 0}
            label={negotiationUnlocked && order.rerolled ? "已换" : "换单"}
            hint={!negotiationUnlocked ? "在研究中解锁客户协商" : order.rerolled ? "这张订单已换过一次" : refreshCooldown > 0 ? `换单冷却中，还剩 ${Math.ceil(refreshCooldown)} 秒` : "每张订单限换一次，保留奖励类型和剩余时间"}
            onClick={() => onRefresh(order.id)} />
          <button type="button" className={styles.goldenButton} disabled={!hasGoldenTicket || order.remaining <= 0 || phase !== "live"} aria-label="使用黄金订单券" title={hasGoldenTicket ? "使用黄金订单券" : "暂无黄金订单券"} onClick={() => onGoldenRequest(card)}><TabletIcon name="golden-ticket" size={22} /></button>
          <button type="button" className={styles.deliverButton} disabled={!ready || phase !== "live"} onClick={() => onDeliver(card)}>交付</button>
        </div>
      </div>
    </article>
    <div ref={fold} className={styles.fold} aria-hidden="true" />
  </div>;
}

function GoldenOrderConfirmation({ card, available, onCancel, onConfirm }: {
  card: OrderCardData;
  available: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog ref={dialogRef} className={styles.confirmation} aria-labelledby={titleId} aria-describedby={detailId} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <div className={styles.confirmationTitle}><TabletIcon name="golden-ticket" size={26} /><h3 id={titleId}>使用黄金订单券？</h3></div>
    <p id={detailId}>{available ? "消耗 1 张黄金订单券，免材料完成这张订单。" : "订单已变化或黄金订单券不足，请返回重新选择。"}</p>
    <div className={styles.confirmationOrder}>
      <span>{RECIPES[card.order.processed.kind].name} ×{number.format(card.order.processed.amount)} · {SYNTHESIS_RECIPES[card.order.synthesized.kind].name} ×{number.format(card.order.synthesized.amount)}</span>
      <strong>领取 {number.format(card.coins)} 金币{card.order.reward === "special" && " + 随机特殊物品 ×1"}</strong>
    </div>
    <div className={styles.confirmationActions}>
      <button type="button" className={styles.cancelConfirmation} onClick={onCancel}>取消</button>
      <button type="button" className={styles.confirmGolden} disabled={!available} onClick={onConfirm}>确认使用</button>
    </div>
  </dialog>;
}

export function WorkshopOrders({ game, onTrack, onCancelTracking, onRefresh, onDeliver, onGoldenDeliver, onRefreshTicket, infiniteResources = false, onNotice }: {
  game: GameState;
  onTrack: (orderId: string) => void;
  onCancelTracking: () => void;
  onRefresh: (orderId: string) => void;
  onDeliver: (orderId: string, accepted: () => void) => boolean;
  onGoldenDeliver: (orderId: string, accepted: () => void) => boolean;
  onRefreshTicket: () => void;
  infiniteResources?: boolean;
  onNotice?: (message: string) => void;
}) {
  const titleId = useId();
  const [retained, setRetained] = useState<RetainedOrder<OrderCardData>[]>([]);
  const [deliveryGate] = useState(createOrderDeliveryGate);
  const [goldenCandidate, setGoldenCandidate] = useState<OrderCardData | null>(null);
  const productionStatus = getOrderProductionStatus(game);
  const cards = mergeRetainedOrders(game.orders.map((order): OrderCardData => ({
    id: order.id,
    order,
    available: [game.inventory[order.processed.kind], game.inventory[order.synthesized.kind]],
    coins: orderCoinReward(game, order),
    phase: "live",
    tracking: game.productionPlan?.orderId === order.id && game.productionPlan.phase === "tracking",
    production: game.productionPlan?.orderId === order.id ? productionStatus : null,
  })), retained);
  const finish = useCallback((id: string) => {
    setRetained((current) => current.filter(({ value }) => value.id !== id));
  }, []);

  function deliver(card: OrderCardData, golden = false) {
    if (card.phase !== "live") return;
    const position = cards.findIndex(({ id }) => id === card.id);
    const departure: RetainedOrder<OrderCardData> = {
      value: { ...card, phase: "leaving" },
      before: cards.slice(0, position).map(({ id }) => id),
      after: cards.slice(position + 1).map(({ id }) => id),
    };
    let result: "success" | "failed" | "duplicate";
    try {
      result = deliveryGate.attempt(card.id, () => {
        setRetained((current) => [...current, departure]);
        onNotice?.("订单已交付");
      }, (accepted) => (golden ? onGoldenDeliver : onDeliver)(card.id, accepted));
    } catch {
      result = "failed";
    }
    if (result === "duplicate") return;
    if (result === "failed") {
      finish(card.id);
      onNotice?.(golden ? "订单已变化或黄金订单券不足，暂时无法完成" : "订单已变化或库存不足，暂时无法交付");
      return;
    }
  }

  const refreshCount = infiniteResources ? "∞" : number.format(game.inventory.specials.orderRefresh);
  const refreshDisabled = game.inventory.specials.orderRefresh < 1 || game.orders.filter((order) => order.remaining > 0).length >= 2;
  const currentGoldenCard = goldenCandidate ? cards.find((card) => card.phase === "live" && isGoldenOrderConfirmationCurrent(goldenCandidate.order, card.order)) : undefined;
  const canConfirmGolden = !!currentGoldenCard && game.inventory.specials.goldenOrder > 0;

  function confirmGoldenDelivery() {
    if (!currentGoldenCard || !canConfirmGolden) return;
    setGoldenCandidate(null);
    deliver(currentGoldenCard, true);
  }

  return <section className={styles.page} aria-labelledby={titleId}>
    <div className={styles.header}>
      <h2 className={styles.heading} id={titleId}>工厂订单</h2>
      <button type="button" className={styles.refreshTicketButton} disabled={refreshDisabled} aria-label={`刷新订单，剩余${refreshCount}次`} title={game.inventory.specials.orderRefresh < 1 ? "暂无订单刷新券" : refreshDisabled ? "订单已满，交付后可用" : "消耗1张订单刷新券，立即新增一张订单"} onClick={onRefreshTicket}>
        <TabletIcon name="refresh" size={24} />
        <span className={styles.refreshCount} aria-hidden="true">{refreshCount}</span>
      </button>
    </div>
    <div className={styles.stack}>
      {cards.length ? cards.map((card) => <OrderCard key={card.id} card={card} planningUnlocked={game.research.planning > 0} negotiationUnlocked={game.research.negotiation > 0} canStartTracking={!game.productionPlan} refreshCooldown={Math.max(0, Math.ceil(game.orderRefreshCooldown))} hasGoldenTicket={game.inventory.specials.goldenOrder > 0} onTrack={onTrack} onCancelTracking={onCancelTracking} onRefresh={onRefresh} onDeliver={deliver} onGoldenRequest={setGoldenCandidate} onFinish={finish} />)
        : <div className={styles.empty}>暂无订单</div>}
    </div>
    {productionStatus.phase === "restoring" && <div className={styles.restoring}><strong>{productionStatus.label}</strong><span>{productionStatus.detail}</span></div>}
    {goldenCandidate && <GoldenOrderConfirmation card={goldenCandidate} available={canConfirmGolden} onCancel={() => setGoldenCandidate(null)} onConfirm={confirmGoldenDelivery} />}
  </section>;
}
