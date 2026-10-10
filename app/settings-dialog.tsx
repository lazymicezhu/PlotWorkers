"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "./game-engine";
import { exportGameSave, MAX_SAVE_FILE_BYTES, parseGameSave } from "./save-file";
import { saveValuation } from "./save-valuation";

export const SAVE_BACKUP_KEY = "green-realm-save-backup-v1";
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
type ImportPreview = { state: GameState; exportedAt: string | null; name: string; backup: boolean };

function saveDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "旧版存档";
}

export function SettingsDialog({ game, onClose, onImport }: {
  game: GameState;
  onClose: () => void;
  onImport: (state: GameState) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backup, setBackup] = useState<ReturnType<typeof parseGameSave> | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const valuation = useMemo(() => saveValuation(game), [game]);
  const importValue = useMemo(() => preview ? saveValuation(preview.state).total : 0, [preview]);

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
      <section className="save-actions" aria-label="存档管理"><h3>存档管理</h3><p>进度会自动保存在当前浏览器。导出文件可用于备份或换设备继续。</p><div className="save-action-buttons"><button className="save-export" onClick={exportSave}>导出存档</button><button className="save-import" disabled={reading} onClick={() => inputRef.current?.click()}>{reading ? "读取中…" : "导入存档"}</button></div><input ref={inputRef} type="file" accept=".json,application/json" aria-label="选择存档文件" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readSave(file); }} /></section>
      {preview && <section className="save-import-preview" aria-label="导入存档预览"><h3>{preview.backup ? "恢复备份" : "确认导入"}</h3><p className="save-filename">{preview.name}</p><dl><div><dt>存档价值</dt><dd>{number.format(importValue)} 金币</dd></div><div><dt>持有金币</dt><dd>{number.format(preview.state.coins)}</dd></div><div><dt>工坊规模</dt><dd>{preview.state.workers.length} 人 · {preview.state.plots.length} 地块</dd></div><div><dt>导出时间</dt><dd>{saveDate(preview.exportedAt)}</dd></div></dl><p>将替换当前进度，并自动保留替换前的备份。</p><div className="save-action-buttons"><button className="save-export" onClick={confirmImport}>{preview.backup ? "确认恢复备份" : "导入并替换存档"}</button><button className="save-import" onClick={() => setPreview(null)}>取消</button></div></section>}
      {backup && !preview && <button className="restore-save" disabled={reading} onClick={() => { setError(""); setMessage(""); setPreview({ ...backup, name: "上一次替换前的存档", backup: true }); }}>恢复上一次备份<span>{saveDate(backup.exportedAt)}</span></button>}
      {message && <p className="save-message" role="status">{message}</p>}
      {error && <p className="save-error" role="alert">{error}</p>}
    </div>
  </dialog>;
}
