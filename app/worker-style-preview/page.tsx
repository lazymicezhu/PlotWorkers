"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useButtonFeedback } from "../use-button-feedback";
import styles from "./preview.module.css";

type Version = "original" | "redraw";
type View = "portrait" | "map";

const sources: Record<Version, string> = {
  original: "/worker.png",
  redraw: "/previews/worker-style/worker-lowpoly-v1.png",
};

// Display the opaque character body at the same height without changing either PNG.
// Bounds use alpha >= 128 to ignore nearly transparent padding.
const spriteGeometry: Record<Version, { width: number; height: number; body: { x: number; y: number; width: number; height: number } }> = {
  original: { width: 64, height: 104, body: { x: 11, y: 3, width: 47, height: 99 } },
  redraw: { width: 1024, height: 1536, body: { x: 180, y: 38, width: 682, height: 1457 } },
};

const workers = [
  { x: 208, y: 76, facing: 1 },
  { x: 130, y: 120, facing: -1 },
  { x: 282, y: 138, facing: 1 },
  { x: 210, y: 183, facing: -1 },
];

function WorkerImage({ version, onError, onLoad }: {
  version: Version;
  onError?: () => void;
  onLoad?: () => void;
}) {
  const geometry = spriteGeometry[version];
  const source = sources[version];
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    // A cached SSR image can finish before React attaches its load listener.
    if (!image?.complete) return;
    if (image.naturalWidth > 0) onLoad?.();
    else onError?.();
  }, [onLoad, onError]);
  return <img
    key={source}
    ref={imageRef}
    className={styles.workerImage}
    style={{
      height: `${geometry.height / geometry.body.height * 100}%`,
      top: `${-geometry.body.y / geometry.body.height * 100}%`,
      transform: `translateX(${-((geometry.body.x + geometry.body.width / 2) / geometry.width) * 100}%)`,
    }}
    src={source}
    alt={version === "original" ? "原版黄衣小人" : "包工头画风的新版黄衣小人"}
    draggable={false}
    onError={onError}
    onLoad={onLoad}
  />;
}

export default function WorkerStylePreview() {
  const root = useRef<HTMLElement>(null);
  const hasOpenedMap = useRef(false);
  useButtonFeedback(root);
  const [view, setView] = useState<View>("portrait");
  const [zoom, setZoom] = useState(0.7);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const handleImageLoad = useCallback(() => setImageStatus("ready"), []);
  const handleImageError = useCallback(() => setImageStatus("unavailable"), []);

  function showMap() {
    if (!hasOpenedMap.current) {
      if (window.matchMedia("(max-width: 640px)").matches) setZoom(0.4);
      hasOpenedMap.current = true;
    }
    setView("map");
  }

  return <main ref={root} className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}><span aria-hidden="true">←</span> 返回工坊</Link>
        <span className={styles.previewBadge}><i />原小人保持不变</span>
      </header>

      <section className={styles.intro} aria-labelledby="preview-title">
        <p className={styles.eyebrow}>人物形象预览</p>
        <h1 id="preview-title">普通小人 <span>·</span> 画风对比</h1>
        <p className={styles.description}>保留黄上衣、蓝灰长裤，试试包工头一样的切面与块状造型。</p>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="对比视图">
          <button type="button" aria-pressed={view === "portrait"} onClick={() => setView("portrait")}>放大看</button>
          <button type="button" aria-pressed={view === "map"} onClick={showMap}>放到地图中</button>
        </div>
        {view === "map" ? <div className={styles.zoomControl}>
          <span>场景缩放</span>
          <div className={styles.segmented} role="group" aria-label="场景缩放">
            {[0.4, 0.7, 1].map(value => <button type="button" key={value} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{Math.round(value * 100)}%</button>)}
          </div>
        </div> : <span className={styles.heightNote}>同等身高对比 · 脚底对齐</span>}
      </div>

      <div className={styles.comparison}>
        {(["original", "redraw"] as const).map(version => <section key={version} className={`${styles.card} ${version === "redraw" ? styles.newCard : ""}`} aria-labelledby={`${version}-title`}>
          <div className={styles.cardHeading}>
            <div><span className={styles.cardEyebrow}>{version === "original" ? "现在的形象" : "新的尝试"}</span><h2 id={`${version}-title`}>{version === "original" ? "原版小人" : "包工头同画风"}</h2></div>
            <span className={version === "original" ? styles.versionBadge : styles.newBadge}>{version === "original" ? "游戏中" : "仅预览"}</span>
          </div>

          {view === "portrait" ? <div className={styles.portrait}>
            <span className={styles.baseline} aria-hidden="true" />
            <div className={styles.portraitWorker} style={{ visibility: version === "redraw" && imageStatus !== "ready" ? "hidden" : "visible" }}>
              <WorkerImage version={version} onLoad={version === "redraw" ? handleImageLoad : undefined} onError={version === "redraw" ? handleImageError : undefined} />
            </div>
            {version === "redraw" && imageStatus !== "ready" && <span className={styles.imageMessage} role="status">{imageStatus === "loading" ? "新版形象载入中…" : "新版形象暂未载入"}</span>}
          </div> : <div className={styles.mapViewport}>
            <div className={styles.mapCanvas} style={{ width: 420 * zoom, height: 362 * zoom }}>
              <div className={styles.mapWorld} style={{ transform: `scale(${zoom})` }}>
                <img className={styles.plotImage} src="/plot-baked-gather-4.png" width={416} height={275} alt="与游戏相同的四乘四采集地块" draggable={false} />
                {workers.map((worker, index) => <div className={styles.mapWorker} key={index} style={{ left: worker.x + 2, top: worker.y + 86, "--facing": worker.facing, visibility: version === "redraw" && imageStatus !== "ready" ? "hidden" : "visible" } as CSSProperties}>
                  <span className={styles.workerShadow} aria-hidden="true" />
                  <div className={styles.mapWorkerImage}><WorkerImage version={version} onLoad={version === "redraw" ? handleImageLoad : undefined} onError={version === "redraw" ? handleImageError : undefined} /></div>
                </div>)}
              </div>
            </div>
            {version === "redraw" && imageStatus !== "ready" && <span className={styles.mapImageMessage} role="status">{imageStatus === "loading" ? "新版形象载入中…" : "新版形象暂未载入"}</span>}
          </div>}

          <p className={styles.cardCaption}>{version === "original" ? "圆润轮廓 · 简单色块" : "立体切面 · 块状手脚 · 简化面部"}</p>
        </section>)}
      </div>

      <footer className={styles.footer}>
        <div className={styles.reference}>
          <img src="/foreman.png" alt="现有包工头，作为画风参考" draggable={false} />
          <div><strong>以现有包工头为画风参考</strong><p>同等身高、相同地块与站位，便于比较缩小后的辨识度。</p></div>
        </div>
        <span className={styles.previewNote}>独立预览，不影响工坊与存档</span>
      </footer>
    </div>
  </main>;
}
