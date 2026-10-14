"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { TabletIcon } from "../tablet-icon";
import { useButtonFeedback } from "../use-button-feedback";
import styles from "./preview.module.css";

export default function ButtonFeedbackPreview() {
  const root = useRef<HTMLElement>(null);
  const [slow, setSlow] = useState(false);
  const { replay } = useButtonFeedback(root, slow);
  const [page, setPage] = useState("商店");
  const [quantity, setQuantity] = useState(10);
  const [worker, setWorker] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [tabletOpen, setTabletOpen] = useState(false);
  const [recipe, setRecipe] = useState("粗加工");
  const [clicks, setClicks] = useState(0);
  const [lastAction, setLastAction] = useState("点击任意按钮，试试手感");
  function record(label: string) {
    setClicks(value => value + 1);
    setLastAction(label);
  }

  return <main ref={root} className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><TabletIcon name="factory" size={19} />PLOT WORKERS<span>交互实验室</span></Link>
        <span className={styles.previewBadge}><i />独立预览</span>
      </header>

      <div className={styles.intro}>
        <div><p className={styles.eyebrow}>BUTTON FEEDBACK / 01</p><h1>每次点击，都有回应。</h1><p className={styles.description}>沿用工坊的按钮样式，加一点轻压、回弹和柔和的点击反馈。</p></div>
        <div className={styles.toolbar}>
          <div className={styles.speed} role="group" aria-label="播放速度">
            <button type="button" aria-pressed={!slow} onClick={() => setSlow(false)}>标准</button>
            <button type="button" aria-pressed={slow} onClick={() => setSlow(true)}>慢放</button>
          </div>
          <button type="button" className={styles.replay} onClick={() => { replay(); setLastAction("正在依次演示各类按钮的点击反馈"); }}><TabletIcon name="arrow" size={15} />播放一轮</button>
        </div>
      </div>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroContent}>
          <span className={styles.sectionNumber}>01 / 主要操作</span>
          <h2 id="hero-title">按住，再松开。</h2>
          <p>按下时轻轻压低，松开后短促回弹。<br />点击的位置，会泛起一层很淡的光。</p>
          <button type="button" className={`${styles.primary} ${styles.heroButton}`} data-preview-sample onClick={() => record("购买反馈已触发")}><TabletIcon name="can" size={20} /><span>购买罐头</span><span className={styles.buttonPrice}>100 金币</span></button>
        </div>
        <div className={styles.motionDiagram} aria-label="动效分为按下、回弹和归位三个阶段">
          <div className={styles.diagramStage}><span className={`${styles.miniButton} ${styles.miniPressed}`}><TabletIcon name="check" size={18} /></span><b>轻压</b><small>按住时</small></div>
          <span className={styles.diagramArrow}>→</span>
          <div className={styles.diagramStage}><span className={`${styles.miniButton} ${styles.miniBounce}`}><TabletIcon name="check" size={18} /></span><b>微弹</b><small>松开时</small></div>
          <span className={styles.diagramArrow}>→</span>
          <div className={styles.diagramStage}><span className={styles.miniButton}><TabletIcon name="check" size={18} /></span><b>归位</b><small>自然停下</small></div>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="actions-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>02 / 交易与确认</span><h2 id="actions-title">大小按钮，同一种手感</h2><p>购买、升级、取消和确认，都有即时反馈。</p></div>
          <div className={styles.actions}>
            <button type="button" className={styles.purchase} data-preview-sample onClick={() => record("购买按钮已点击")}>购买</button>
            <button type="button" className={styles.primary} onClick={() => record("升级按钮已点击")}>升级研究<TabletIcon name="plus" size={13} /></button>
            <button type="button" className={styles.secondary} onClick={() => record("取消按钮已点击")}>取消</button>
            <button type="button" className={styles.danger} onClick={() => record("确认按钮已点击；这只是演示")}>确认重置</button>
          </div>
          <div className={styles.disabledLine}><button type="button" className={styles.primary} disabled>已满级</button><span>不可用时保持安静</span></div>
        </section>

        <section className={styles.card} aria-labelledby="nav-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>03 / 栏目切换</span><h2 id="nav-title">切换也能感受到按下</h2><p>当前栏目随点击更新，文字和图标一起回应。</p></div>
          <div className={styles.navigation} role="group" aria-label="示例栏目">
            {([['商店', 'shop'], ['研究', 'research'], ['人物', 'worker']] as const).map(([label, icon]) => <button type="button" key={label} aria-pressed={page === label} data-feedback-size="wide" data-preview-sample={label === '研究' ? true : undefined} onClick={() => { setPage(label); record(`已切换到${label}`); }}><TabletIcon name={icon} size={17} />{label}<TabletIcon name="arrow" size={13} /></button>)}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="worker-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>04 / 人物信息卡</span><h2 id="worker-title">薄卡片，轻一点的反馈</h2><p>保持原有厚度，只做幅度更小的按压。</p></div>
          <div className={styles.workerList}>
            {[1, 2].map(id => <button type="button" key={id} className={styles.worker} aria-pressed={worker === id} data-feedback-size="wide" data-preview-sample={id === 1 ? true : undefined} onClick={() => { setWorker(id); record(`已选择小人 ${id}`); }}><i /><span><strong>小人 {id}<em> · {id === 1 ? "慢热" : "领班"}</em></strong><small>{id === 1 ? "采集中" : "休息中"} · 体力 5 · 效率 5 · 精力 5</small></span><b>{id === 1 ? 85 : 62}</b></button>)}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="small-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>05 / 小型控件</span><h2 id="small-title">再小的按钮，也有反馈</h2><p>数量、开关和图标按钮保持清晰利落。</p></div>
          <div className={styles.controlsRow}>
            <div className={styles.quantities} role="group" aria-label="示例购买数量">{[10, 50, 200].map(value => <button type="button" key={value} aria-pressed={quantity === value} data-preview-sample={value === 50 ? true : undefined} onClick={() => { setQuantity(value); record(`已选择数量 ${value}`); }}>{value}</button>)}</div>
            <span className={styles.controlDivider} />
            <button type="button" className={styles.iconButton} aria-label="示例增加" data-preview-sample onClick={() => record("增加按钮已点击")}><TabletIcon name="plus" size={17} /></button>
            <button type="button" className={styles.iconButton} aria-label="示例关闭" onClick={() => record("关闭按钮已点击")}><TabletIcon name="close" size={15} /></button>
          </div>
          <div className={styles.switchRow}><span>自动调度</span><button type="button" className={styles.switch} role="switch" aria-label="示例自动调度" aria-checked={enabled} onClick={() => { setEnabled(!enabled); record(`自动调度演示已${enabled ? '关闭' : '开启'}`); }}><span /></button></div>
        </section>

        <section className={`${styles.card} ${styles.sceneCard}`} aria-labelledby="scene-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>06 / 地图按钮</span><h2 id="scene-title">场景里的按钮，也能按下</h2><p>保留原有悬浮感，点击时轻轻收一下。</p></div>
          <div className={styles.sceneSample}><span className={styles.sceneTile} /><button type="button" className={styles.recipe} data-preview-sample onClick={() => { const next = recipe === '粗加工' ? '精加工' : '粗加工'; setRecipe(next); record(`配方演示已切换为${next}`); }}>配方</button><span className={styles.recipeLabel}>{recipe}</span></div>
        </section>

        <section className={`${styles.card} ${styles.launcherCard}`} aria-labelledby="launcher-title">
          <div className={styles.cardHeading}><span className={styles.sectionNumber}>07 / 平板入口</span><h2 id="launcher-title">平板入口保持原样</h2><p>此入口不使用统一的轻压、回弹和点击波纹。</p></div>
          <div className={styles.launcherSample}><button type="button" className={styles.launcher} aria-label="示例工坊平板" aria-expanded={tabletOpen} data-button-feedback="off" onClick={() => { setTabletOpen(!tabletOpen); record(`平板入口演示已${tabletOpen ? '收起' : '展开'}`); }}><span /></button><span className={styles.launcherState}>{tabletOpen ? '平板已展开' : '点击试试'}</span></div>
        </section>
      </div>

      <footer className={styles.footer}>
        <output className={styles.feedback} aria-live="polite"><span className={styles.feedbackDot} /><span>{lastAction}</span><small>{clicks > 0 ? `${clicks} 次体验` : '准备就绪'}</small></output>
        <p>这是一份独立演示，不影响游戏存档。支持鼠标、触屏与键盘；开启系统「减少动态效果」时会自动减弱动效。</p>
      </footer>
    </div>
  </main>;
}
