"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "./game-engine";
import { exportGameSave, MAX_SAVE_FILE_BYTES, parseGameSave } from "./save-file";
import { saveValuation } from "./save-valuation";
import rebirthStyles from "./rebirth-settings.module.css";
import { canFirstRebirth, FIRST_REBIRTH_ASSET_REQUIREMENT } from "./rebirth";

export const SAVE_BACKUP_KEY = "green-realm-save-backup-v1";
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
type ImportPreview = { state: GameState; exportedAt: string | null; name: string; backup: boolean };

function saveDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "旧版存档";
}

export function SettingsDialog({ game, onClose, onImport, onReset, performanceEnabled, onPerformanceChange, rebirth }: {
  game: GameState;
  onClose: () => void;
  onImport: (state: GameState) => void;
  onReset: () => void;
  performanceEnabled: boolean;
  onPerformanceChange: (enabled: boolean) => void;
  rebirth?: { completed: boolean; onRebirth: () => void };
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backup, setBackup] = useState<ReturnType<typeof parseGameSave> | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const valuation = useMemo(() => saveValuation(game), [game]);
  const importValue = useMemo(() => preview ? saveValuation(preview.state).total : 0, [preview]);
  const rebirthThreshold = FIRST_REBIRTH_ASSET_REQUIREMENT;
  const rebirthEligible = canFirstRebirth(game);
  const rebirthProgress = Math.min(100, Math.max(0, valuation.total / rebirthThreshold * 100));

  useEffect(() => {
    dialogRef.current?.showModal();
    try {
      const stored = localStorage.getItem(SAVE_BACKUP_KEY);
      // Restore browser-only backup metadata after mounting the dialog.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setBackup(parseGameSave(stored));
    } catch { /* An unavailable or obsolete backup must not block settings. */ }
    return () => { readId.current += 1; };
  }, []);

  useEffect(() => {
    if (!resetArmed) return;
    const timeout = window.setTimeout(() => setResetArmed(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [resetArmed]);

  function restartGame() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    setError("");
    try {
      onReset();
    } catch {
      setError("浏览器无法保存新存档，当前进度未替换，请重试。");
    }
  }

  function exportSave() {
    setError("");
    try {
      const now = new Date();
      const blob = new Blob([exportGameSave(game, now)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `plot-workers-${now.toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("存档已导出，请保管好下载的文件。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    }
  }

  async function readSave(file: File | undefined) {
    if (!file) return;
    const id = ++readId.current;
    setPreview(null);
    setError("");
    setMessage("");
    setReading(true);
    try {
      if (file.size > MAX_SAVE_FILE_BYTES) throw new Error("存档文件过大，请选择 5 MB 以内的 JSON 存档。");
      const loaded = parseGameSave(await file.text());
      if (id === readId.current) setPreview({ ...loaded, name: file.name, backup: false });
    } catch (cause) {
      if (id === readId.current) setError(cause instanceof Error ? cause.message : "无法读取这份存档，请检查文件。");
    } finally {
      if (id === readId.current) setReading(false);
    }
  }

  function confirmImport() {
    if (!preview) return;
    setResetArmed(false);
    setError("");
    try {
      onImport(preview.state);
      const stored = localStorage.getItem(SAVE_BACKUP_KEY);
      setBackup(stored ? parseGameSave(stored) : null);
      setPreview(null);
      setMessage(preview.backup ? "已恢复备份，恢复前的进度已另存为备份。" : "导入成功，原来的进度已自动备份。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，当前进度未替换，请重试。");
    }
  }

  return <dialog ref={dialogRef} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <div className="settings-content">
      <header className="settings-head"><div><h2 id="settings-title">设置与存档</h2><p>保存你的工坊，随时接着玩。</p></div><button className="settings-close" aria-label="关闭设置" onClick={onClose} autoFocus>×</button></header>
      <section className="save-worth" aria-label="当前存档价值"><span>当前存档价值</span><div><strong>{number.format(valuation.total)}</strong><span>金币</span></div><p>按全部资产的固定基准价计算</p></section>
      <details className="save-value-details"><summary>查看价值明细</summary><dl>{valuation.items.map((item) => <div key={item.id}><dt>{item.label}</dt><dd>{number.format(item.value)}</dd></div>)}</dl><p>库存按基准价，人物与机器人按购置成本，地块按购买价，永久升级按投入金币计入。</p><p>库存含生产中已预扣的材料。特殊物品暂未折价；未完成订单奖励不计入。</p></details>
      {rebirth && <section className={rebirthStyles.section} aria-labelledby="rebirth-title">
        <div className={rebirthStyles.heading}><div><span className={rebirthStyles.eyebrow}>第一次转生</span><h3 id="rebirth-title">转生</h3></div><span className={`${rebirthStyles.status} ${rebirthEligible || rebirth.completed ? rebirthStyles.ready : ""}`}>{rebirth.completed ? "奖励已领取" : rebirthEligible ? "已达成条件" : "积累资产中"}</span></div>
        <p className={rebirthStyles.requirement}>{rebirth.completed ? "首次转生已完成，包工头已加入工坊。" : <>总资产达到 <strong>500 万</strong>，即可进行首次转生。</>}</p>
        {!rebirth.completed && <div className={rebirthStyles.progressArea}>
          <div className={rebirthStyles.progressLabels}><span>{number.format(valuation.total)} / 5,000,000</span><span>{rebirthEligible ? "目标已达成" : `还差 ${number.format(rebirthThreshold - valuation.total)}`}</span></div>
          <div className={rebirthStyles.progress} role="progressbar" aria-label="首次转生资产进度" aria-valuemin={0} aria-valuemax={rebirthThreshold} aria-valuenow={Math.min(rebirthThreshold, Math.max(0, valuation.total))}><span style={{ width: `${rebirthProgress}%` }} /></div>
        </div>}
        <div className={rebirthStyles.reward}>
          {/* The portrait keeps the original sprite's aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={rebirthStyles.portrait} src="/foreman.png" alt="戴金色安全帽的包工头" width={64} height={96} />
          <div><p className={rebirthStyles.rewardLabel}>{rebirth.completed ? "已获得守护工人" : "首次转生必得：包工头"}</p><strong>{rebirth.completed ? "包工头已加入新工坊" : "带着可靠的伙伴，再出发。"}</strong><p className={rebirthStyles.traits}>不消耗心情 · 占 1 个工位<br />守护地块效率翻倍</p></div>
        </div>
        <p className={rebirthStyles.explanation}>{rebirth.completed ? "你的专属守护工人将陪伴这一轮工坊。首次转生仅可进行一次。" : "转生后，金币、库存、地块、普通工人、机器人，以及研究、自动补给等升级均回到初始状态，包工头将加入新工坊。首次转生仅可进行一次。"}</p>
        <button className={rebirthStyles.start} disabled={!rebirthEligible || rebirth.completed} onClick={() => { if (rebirthEligible && !rebirth.completed) rebirth.onRebirth(); }}>{rebirth.completed ? "首次转生已完成" : "开始第一次转生"}</button>
        {!rebirth.completed && <p className={rebirthStyles.nextStep}>先认识你的包工头，再开启新工坊。</p>}
      </section>}
      <section className="save-actions" aria-label="存档管理"><h3>存档管理</h3><p>进度每 30 秒自动保存在当前浏览器，离开页面时补存。导出文件可用于备份或换设备继续。</p><div className="save-action-buttons"><button className="save-export" onClick={exportSave}>导出存档</button><button className="save-import" disabled={reading} onClick={() => inputRef.current?.click()}>{reading ? "读取中…" : "导入存档"}</button></div><input ref={inputRef} type="file" accept=".json,application/json" aria-label="选择存档文件" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readSave(file); }} /></section>
      {preview && <section className="save-import-preview" aria-label="导入存档预览"><h3>{preview.backup ? "恢复备份" : "确认导入"}</h3><p className="save-filename">{preview.name}</p><dl><div><dt>存档价值</dt><dd>{number.format(importValue)} 金币</dd></div><div><dt>持有金币</dt><dd>{number.format(preview.state.coins)}</dd></div><div><dt>工坊规模</dt><dd>{preview.state.workers.length} 人 · {preview.state.plots.length} 地块</dd></div><div><dt>导出时间</dt><dd>{saveDate(preview.exportedAt)}</dd></div></dl><p>将替换当前进度，并自动保留替换前的备份。</p><div className="save-action-buttons"><button className="save-export" onClick={confirmImport}>{preview.backup ? "确认恢复备份" : "导入并替换存档"}</button><button className="save-import" onClick={() => setPreview(null)}>取消</button></div></section>}
      {backup && !preview && <button className="restore-save" disabled={reading} onClick={() => { setError(""); setMessage(""); setPreview({ ...backup, name: "上一次替换前的存档", backup: true }); }}>恢复上一次备份<span>{saveDate(backup.exportedAt)}</span></button>}
      {message && <p className="save-message" role="status">{message}</p>}
      {error && <p className="save-error" role="alert">{error}</p>}
      <section className="settings-performance" aria-label="性能监测设置"><h3>性能监测</h3><label><span>显示性能数据</span><input type="checkbox" checked={performanceEnabled} onChange={(event) => onPerformanceChange(event.target.checked)} /></label><p>在游戏画面查看帧率、卡顿和任务耗时。关闭后停止采样。</p></section>
      <section className="settings-reset" aria-label="重新开始游戏"><h3>重新开始</h3><p id="reset-description">将清空当前进度，回到初始工坊。建议先导出存档备份。</p><button className="reset-button" aria-describedby="reset-description" onClick={restartGame}>{resetArmed ? "再次点击确认" : "重新开始"}</button></section>
    </div>
  </dialog>;
}
