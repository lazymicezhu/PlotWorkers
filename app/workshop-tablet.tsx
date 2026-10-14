"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { TabletIcon } from "./tablet-icon";
import styles from "./workshop-tablet.module.css";

export type TabletPage = "shop" | "research" | "orders" | "sell" | "inventory" | "workers" | "robots" | "plots";
const pages: { id: TabletPage; label: string; icon: string }[] = [
  { id: "shop", label: "商店", icon: "shop" },
  { id: "research", label: "研究", icon: "research" },
  { id: "orders", label: "订单", icon: "orders" },
  { id: "sell", label: "出售", icon: "box" },
  { id: "inventory", label: "背包", icon: "bag" },
  { id: "workers", label: "人物", icon: "worker" },
  { id: "robots", label: "机器人", icon: "robot" },
  { id: "plots", label: "地块", icon: "plots" },
];
const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
function shortAmount(value: number) {
  return value >= 100_000_000 ? `${amount.format(value / 100_000_000)}亿`
    : value >= 10_000 ? `${amount.format(value / 10_000)}万`
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

export function WorkshopTablet({ open, activePage, onOpenChange, onPageChange, unreadPages, notificationVersion, coins, workerCount, children, infiniteResources = false }: {
  open: boolean;
  activePage: TabletPage;
  onOpenChange: (open: boolean) => void;
  onPageChange: (page: TabletPage) => void;
  unreadPages: Partial<Record<TabletPage, boolean>>;
  notificationVersion: number;
  coins: number;
  workerCount: number;
  children: ReactNode;
  infiniteResources?: boolean;
}) {
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const keyboardInteraction = useRef(false);
  const previousNotification = useRef(notificationVersion);
  const [lastOpen, setLastOpen] = useState(open);
  const [present, setPresent] = useState(open);
  const [entryReady, setEntryReady] = useState(false);
  const [motion, setMotion] = useState<{ version: number; type: "idle" | "opening" | "closing" }>({ version: 0, type: "idle" });
  const [layout, setLayout] = useState({ scale: 1, edge: 24, bottom: 166 });
  const hasUnread = Object.values(unreadPages).some(Boolean);

  // Keep the surface mounted through its exit so transitions can reverse in place.
  if (lastOpen !== open) {
    setLastOpen(open);
    setPresent(true);
    setMotion({ version: motion.version + 1, type: open ? "opening" : "closing" });
  }

  useEffect(() => {
    const measure = () => {
      // The layout viewport stays stable when the keyboard reduces only the
      // visual viewport, so editing a quantity does not resize the tablet.
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const edge = width <= 640 ? 12 : 24;
      const bottom = height < 500 ? 144 : 166;
      // The logical canvas is always 900 × 675; only viewport fitting changes scale.
      const scale = Math.max(.1, Math.min(1, (width - edge * 2) / 900, (height - bottom - 16) / 675));
      setLayout(current => current.scale === scale && current.edge === edge && current.bottom === bottom ? current : { scale, edge, bottom });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (!present || entryReady) return;
    // Paint the newly mounted surface at its closed position before entering.
    // Reversals keep entryReady and therefore retain the current transition.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setEntryReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [present, entryReady]);

  useEffect(() => {
    if (open || !present) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
    const timer = window.setTimeout(() => {
      setPresent(false);
      setEntryReady(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (notificationVersion > previousNotification.current && !open) {
      // New notifications reuse a gentle hop, without interrupting a close motion.
      setMotion(current => current.type === "idle" ? { version: current.version + 1, type: "opening" } : current);
    }
    previousNotification.current = notificationVersion;
  }, [notificationVersion, open]);

  useEffect(() => {
    const usePointer = () => { keyboardInteraction.current = false; };
    const useKeyboard = () => { keyboardInteraction.current = true; };
    // Map interactions can also close the tablet, so track input outside it.
    window.addEventListener("pointerdown", usePointer, true);
    window.addEventListener("keydown", useKeyboard, true);
    return () => {
      window.removeEventListener("pointerdown", usePointer, true);
      window.removeEventListener("keydown", useKeyboard, true);
    };
  }, []);

  useEffect(() => {
    if (open && !wasOpen.current) panel.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    if (!open && wasOpen.current) {
      if (keyboardInteraction.current) {
        launcher.current?.focus({ preventScroll: true });
      } else {
        // Pointer actions can close the tablet to start placing a plot. Leaving
        // its launcher focused would make the later Escape key reveal a ring.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && (focused === launcher.current || panel.current?.contains(focused))) focused.blur();
      }
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onOpenChange]);

  // Finish sprite state even when CSS animation is suppressed by reduced motion.
  useEffect(() => {
    if (motion.type === "idle") return;
    const timer = window.setTimeout(() => setMotion(current => current.version === motion.version ? { ...current, type: "idle" } : current), motion.type === "opening" ? 720 : 640);
    return () => window.clearTimeout(timer);
  }, [motion]);

  useEffect(() => {
    for (const source of ["tablet-idle.png", "tablet-open.png", "tablet-close.png"]) {
      const image = new Image();
      image.src = `/tablet/${source}`;
    }
  }, []);

  function navigation(group: typeof pages, label: string) {
    return <div className={styles.navGroup}>
      <span className={styles.groupLabel}>{label}</span>
      {group.map(page => <button key={page.id} type="button" data-feedback-size="wide" className={`${styles.navItem} ${activePage === page.id ? styles.selected : ""}`} aria-current={activePage === page.id ? "page" : undefined} aria-label={`${page.label}${unreadPages[page.id] ? "，有新内容" : ""}`} onClick={() => onPageChange(page.id)}>
        <TabletIcon name={page.icon} size={18} /><span>{page.label}</span>
        {unreadPages[page.id] && <span className={styles.navDot} aria-hidden="true" />}
      </button>)}
    </div>;
  }

  return <div className={styles.root} data-workshop-tablet>
    {present && <div className={`${styles.stage} ${open && entryReady ? styles.entering : styles.exiting}`} style={{ "--tablet-scale": layout.scale, right: layout.edge, bottom: layout.bottom } as CSSProperties}>
      <section ref={panel} id={`${id}-panel`} className={styles.tablet} role="region" aria-labelledby={`${id}-title`} aria-hidden={!open || undefined} inert={!open} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
        <div className={styles.screen}>
          <header className={styles.topBar}>
            <div className={styles.brand}><TabletIcon name="factory" size={17} /><span id={`${id}-title`}>工坊管理</span></div>
            <span className={styles.running}><i />{infiniteResources ? "无限资源" : "运行中"}</span>
            <div className={styles.resources}>
              <span title={infiniteResources ? "金币无限" : `金币 ${coins}`}><TabletIcon name="coin" size={16} />{infiniteResources ? "∞" : shortAmount(coins)}</span>
              <span title={`${workerCount} 位伙伴`}><TabletIcon name="users" size={16} />{workerCount} 人</span>
            </div>
            <button type="button" className={styles.closeButton} aria-label="关闭平板面板" title="收起 · Esc" onClick={() => onOpenChange(false)}><TabletIcon name="minus" size={16} /></button>
          </header>
          <div className={styles.workspace}>
            <nav className={styles.sidebar} aria-label="工坊功能">
              {navigation(pages.slice(0, 5), "经营")}{navigation(pages.slice(5), "管理")}
              <div className={styles.sidebarFooter}><span /><span>工坊正在运转</span></div>
            </nav>
            <div key={activePage} className={styles.page} aria-label={`${pages.find(page => page.id === activePage)?.label}页面`}>
              <div className={`${styles.content} tablet-page-content`}>{children}</div>
            </div>
          </div>
        </div>
      </section>
    </div>}
    <button ref={launcher} type="button" data-button-feedback="off" className={styles.launcher} aria-label={open ? "收起工坊平板" : "打开工坊平板"} aria-expanded={open} aria-controls={`${id}-panel`} title={hasUnread ? "工坊平板 · 有新内容" : "工坊平板"} onClick={() => onOpenChange(!open)} onPointerDown={event => event.stopPropagation()}>
      <span key={motion.version} className={`${styles.sprite} ${motion.type === "opening" ? styles.spriteOpening : motion.type === "closing" ? styles.spriteClosing : ""}`} aria-hidden="true" />
      {!open && hasUnread && <span className={styles.notificationDot} aria-hidden="true" />}
      <span className={styles.launcherTooltip}>工坊平板</span>
    </button>
  </div>;
}
