"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { orderCoinReward, RECIPES, SYNTHESIS_RECIPES } from "./game-engine";
import type { GameState, OrderState } from "./game-engine";
import { createOrderDeliveryGate, mergeRetainedOrders } from "./order-delivery-presentation";
import type { RetainedOrder } from "./order-delivery-presentation";
import { animateOrderPeel } from "./order-peel-motion";
import { TabletIcon } from "./tablet-icon";
import styles from "./workshop-orders.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
type OrderCardData = {
  id: string;
  order: OrderState;
  available: [number, number];
  coins: number;
  phase: "live" | "pending" | "leaving";
};

function OrderCard({ card, onDeliver, onFinish }: {
  card: OrderCardData;
  onDeliver: (card: OrderCardData) => void;
  onFinish: (id: string) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const { order, phase } = card;
  const ready = order.remaining > 0 && card.available[0] >= order.processed.amount && card.available[1] >= order.synthesized.amount;

  useEffect(() => {
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
    <article ref={paper} className={styles.sticker} aria-label={`订单，${RECIPES[order.processed.kind].name}和${SYNTHESIS_RECIPES[order.synthesized.kind].name}`}>
      <div className={styles.row}>
        <span className={styles.time}>剩余 {Math.max(0, Math.ceil(order.remaining))} 秒</span>
        <span className={`${styles.status} ${ready ? styles.ready : ""}`}>{phase !== "live" ? "交付中" : ready ? "可以交付" : "库存不足"}</span>
      </div>
      {[order.processed, order.synthesized].map((item, index) => {
        const name = item.kind === "rough" || item.kind === "refined" ? RECIPES[item.kind].name : SYNTHESIS_RECIPES[item.kind].name;
        const amount = Math.min(item.amount, Math.max(0, Math.floor(card.available[index])));
        return <div key={item.kind} className={styles.material}>
          <div className={styles.resource}><span>{name}</span><strong>{number.format(amount)}<small> / {number.format(item.amount)}</small></strong></div>
          <div className={styles.progress} role="progressbar" aria-label={`${name}库存`} aria-valuemin={0} aria-valuemax={item.amount} aria-valuenow={amount}>
            <i style={{ width: `${Math.min(100, amount / Math.max(1, item.amount) * 100)}%` }} />
          </div>
        </div>;
      })}
      <div className={`${styles.row} ${styles.bottom}`}>
        <span className={styles.reward}><TabletIcon name="coin" size={16} />{number.format(card.coins)} 金币</span>
        <button type="button" className={styles.deliverButton} disabled={!ready || phase !== "live"} onClick={() => onDeliver(card)}>交付</button>
      </div>
      {order.reward === "special" && <p className={styles.special}>随机特殊物品 ×1</p>}
    </article>
    <div ref={fold} className={styles.fold} aria-hidden="true" />
  </div>;
}

export function WorkshopOrders({ game, onDeliver, onNotice }: {
  game: GameState;
  onDeliver: (orderId: string) => boolean;
  onNotice?: (message: string) => void;
}) {
  const titleId = useId();
  const [retained, setRetained] = useState<RetainedOrder<OrderCardData>[]>([]);
  const [deliveryGate] = useState(createOrderDeliveryGate);
  const cards = mergeRetainedOrders(game.orders.map((order): OrderCardData => ({
    id: order.id,
    order,
    available: [game.inventory[order.processed.kind], game.inventory[order.synthesized.kind]],
    coins: orderCoinReward(game, order),
    phase: "live",
  })), retained);
  const finish = useCallback((id: string) => {
    setRetained((current) => current.filter(({ value }) => value.id !== id));
  }, []);

  function deliver(card: OrderCardData) {
    if (card.phase !== "live") return;
    const position = cards.findIndex(({ id }) => id === card.id);
    const departure: RetainedOrder<OrderCardData> = {
      value: { ...card, phase: "pending" },
      before: cards.slice(0, position).map(({ id }) => id),
      after: cards.slice(position + 1).map(({ id }) => id),
    };
    let result: "success" | "failed" | "duplicate";
    try {
      result = deliveryGate.attempt(card.id, () => {
        setRetained((current) => [...current, departure]);
      }, () => onDeliver(card.id));
    } catch {
      result = "failed";
    }
    if (result === "duplicate") return;
    if (result === "failed") {
      finish(card.id);
      onNotice?.("订单已变化或库存不足，暂时无法交付");
      return;
    }
    setRetained((current) => current.map((entry) => entry.value.id === card.id
      ? { ...entry, value: { ...entry.value, phase: "leaving" } }
      : entry));
    onNotice?.("订单已交付");
  }

  const untilNext = Math.max(0, Math.ceil(180 - game.orderElapsed));
  const dispatch = game.orders.length >= 2
    ? untilNext === 0 ? "订单已满 · 交付一张后即可派发" : `订单已满 · 下次派发还有 ${untilNext} 秒`
    : untilNext === 0 ? "等待下一张订单" : `下次订单派发还有 ${untilNext} 秒`;

  return <section className={styles.page} aria-labelledby={titleId}>
    <h2 className={styles.heading} id={titleId}>工厂订单</h2>
    <div className={styles.dispatch}>{dispatch}</div>
    <div className={styles.stack}>
      {cards.length ? cards.map((card) => <OrderCard key={card.id} card={card} onDeliver={deliver} onFinish={finish} />)
        : <div className={styles.empty}>暂无订单</div>}
    </div>
  </section>;
}
