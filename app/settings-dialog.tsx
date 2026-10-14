"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "./game-engine";
import { exportGameSave, MAX_SAVE_FILE_BYTES, parseGameSave } from "./save-file";
import { saveValuation } from "./save-valuation";
import { canFirstRebirth, FIRST_REBIRTH_ASSET_REQUIREMENT } from "./rebirth";
import { ForemanDescription } from "./foreman-description";
import { ForemanProfile } from "./foreman-profile";
import { SettingsPanel } from "./settings-panel";
import { SettingsDebug } from "./settings-debug";
import type { DebugAction } from "./debug-actions";
import panel from "./settings-panel.module.css";
import styles from "./settings-dialog.module.css";

export const SAVE_BACKUP_KEY = "green-realm-save-backup-v1";
const DEBUG_ACCESS_PASSWORD = "lazymice";
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
type ImportPreview = { state: GameState; exportedAt: string | null; name: string; backup: boolean };
type Page = "home" | "assets" | "rebirth" | "foreman" | "more" | "reset" | "import" | "debug-access" | "debug";

function assetAmount(value: number) {
  if (value >= 100_000_000) return `${decimal.format(value / 100_000_000)} 亿`;
  if (value >= 10_000) return `${decimal.format(value / 10_000)} 万`;
  return number.format(value);
}

function saveDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "旧版存档";
}

export function SettingsDialog({ game, backupKey = SAVE_BACKUP_KEY, onClose, onImport, onReset, onDebug, performanceEnabled, onPerformanceChange, resourceChangesEnabled, onResourceChangesChange, rebirth }: {
  game: GameState;
  backupKey?: string;
  onClose: () => void;
  onImport: (state: GameState) => void;
  onReset: () => void;
  onDebug: (action: DebugAction) => void;
  performanceEnabled: boolean;
  onPerformanceChange: (enabled: boolean) => void;
  resourceChangesEnabled: boolean;
  onResourceChangesChange: (enabled: boolean) => void;
  rebirth?: { completed: boolean; onRebirth: () => void };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [page, setPage] = useState<Page>("home");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backup, setBackup] = useState<ReturnType<typeof parseGameSave> | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [debugPassword, setDebugPassword] = useState("");
  const valuation = useMemo(() => saveValuation(game), [game]);
  const importValue = useMemo(() => preview ? saveValuation(preview.state).total : 0, [preview]);
  const threshold = FIRST_REBIRTH_ASSET_REQUIREMENT;
  const eligible = canFirstRebirth(game);
  const progress = Math.min(100, Math.max(0, valuation.total / threshold * 100));

  useEffect(() => {
    try {
      const stored = localStorage.getItem(backupKey);
      // Backup metadata is browser-only and optional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBackup(stored ? parseGameSave(stored) : null);
    } catch { /* An unavailable or obsolete backup must not block settings. */ }
    return () => { readId.current += 1; };
  }, [backupKey]);

  useEffect(() => {
    if (page === "debug-access") passwordRef.current?.focus({ preventScroll: true });
  }, [page]);

  function navigate(next: Page) {
    readId.current += 1;
    setReading(false);
    setPreview(null);
    setError("");
    setMessage("");
    setDebugPassword("");
    setPage(next);
  }

  function goBack() {
    navigate(page === "foreman" ? "rebirth" : page === "reset" ? "more" : "home");
  }

  function restartGame() {
    setError("");
    setMessage("");
    try { onReset(); }
    catch { setError("浏览器无法保存新存档，当前进度未替换，请重试。"); }
  }

  function exportSave() {
    setError("");
    setMessage("");
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
      if (id === readId.current) {
        setPreview({ ...loaded, name: file.name, backup: false });
        setPage("import");
      }
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，当前进度未替换，请重试。");
      return;
    }
    // Import has already succeeded; unavailable backup metadata is not an import failure.
    try {
      const stored = localStorage.getItem(backupKey);
      setBackup(stored ? parseGameSave(stored) : null);
    } catch { setBackup(null); }
    setMessage(preview.backup ? "已恢复备份，恢复前的进度已另存为备份。" : "导入成功，原来的进度已自动备份。");
    setPreview(null);
    setPage("home");
  }

  function restoreBackup() {
    if (!backup) return;
    navigate("import");
    setPreview({ ...backup, name: "上一次替换前的存档", backup: true });
  }

  const titles: Record<Page, string> = {
    home: "设置", assets: "总资产", rebirth: "转生", foreman: "包工头", more: "更多设置", reset: "重新开始", "debug-access": "调试", debug: "调试",
    import: preview?.backup ? "恢复备份" : "导入存档",
  };
  const back = page === "home" ? undefined : goBack;
  const row = (label: string, destination: Page, value?: string, asset = false) => <button data-feedback-size="wide" className={`${styles.row} ${asset ? styles.asset : ""}`} onClick={() => navigate(destination)}>
    <span>{label}</span>{value && <span className={styles.value}>{value}</span>}<span className={styles.chevron} aria-hidden="true">›</span>
  </button>;

  const actions = page === "rebirth" && rebirth
    ? <button className={`${panel.button} ${panel.solid}`} disabled={!eligible || rebirth.completed} onClick={() => { if (eligible && !rebirth.completed) rebirth.onRebirth(); }}>{rebirth.completed ? "首次转生已完成" : eligible ? "开始第一次转生" : "尚未达到条件"}</button>
    : page === "foreman" ? <button className={panel.button} onClick={goBack}>返回转生</button>
    : page === "reset" ? <><button className={panel.button} onClick={goBack}>取消</button><button className={`${panel.button} ${panel.danger}`} aria-describedby="reset-description" onClick={restartGame}>确认重新开始</button></>
    : page === "import" && preview ? <><button className={panel.button} onClick={goBack}>取消</button><button className={`${panel.button} ${panel.solid}`} onClick={confirmImport}>{preview.backup ? "确认恢复" : "确认导入"}</button></>
    : null;

  return <SettingsPanel title={titles[page]} page={page} onClose={onClose} onBack={back} actions={actions}
    feedback={error ? <p id="settings-error" className={panel.error} role="alert">{error}</p> : <p role="status">{message}</p>}
  >
    {page === "home" && <>
      {row("总资产", "assets", assetAmount(valuation.total), true)}
      <div className={styles.groupLabel}>存档<span>每 30 秒自动保存</span></div>
      <div className={styles.buttons}><button className={`${panel.button} ${panel.primary}`} onClick={exportSave}>导出存档</button><button className={panel.button} disabled={reading} onClick={() => inputRef.current?.click()}>{reading ? "读取中…" : "导入存档"}</button></div>
      {backup && <button className={styles.link} disabled={reading} onClick={restoreBackup}>恢复上次备份</button>}
      <div className={styles.links}>
        {rebirth && row("转生", "rebirth", rebirth.completed ? "已完成" : eligible ? "已达成条件" : "500 万资产解锁")}
        {row("更多设置", "more")}
        {row("调试", "debug-access")}
      </div>
    </>}
    {page === "assets" && <>
      <p className={styles.total}>{number.format(valuation.total)}<small>金币估值</small></p>
      <dl className={styles.stats}>{valuation.items.map((item) => <div key={item.id}><dt>{item.label}</dt><dd>{number.format(item.value)}</dd></div>)}</dl>
      <p className={styles.note}>按固定基准价估算全部资产。库存含生产中已预扣的材料；特殊物品暂未折价，未完成订单奖励不计入。</p>
    </>}
    {page === "rebirth" && rebirth && <>
      <h3 className={styles.title}>{rebirth.completed ? "包工头已加入工坊" : "开启新一轮工坊"}</h3>
      <p className={styles.intro}>{rebirth.completed ? "首次转生已完成。" : "总资产达到 500 万，即可首次转生。"}</p>
      {!rebirth.completed && <>
        <div className={styles.progressLabels}><span>{assetAmount(valuation.total)} / 500 万</span><span>{eligible ? "目标已达成" : `还差 ${assetAmount(threshold - valuation.total)}`}</span></div>
        <div className={styles.progress} role="progressbar" aria-label="首次转生资产进度" aria-valuemin={0} aria-valuemax={threshold} aria-valuenow={Math.min(threshold, Math.max(0, valuation.total))}><span style={{ width: `${progress}%` }} /></div>
      </>}
      <div className={styles.reward}>
        <div><strong>{rebirth.completed ? "专属伙伴 · 包工头" : "首次奖励 · 包工头"}</strong><p className={styles.description}><ForemanDescription /></p></div>
        <button className={styles.portrait} aria-label="查看包工头角色介绍" onClick={() => navigate("foreman")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/foreman.png" alt="戴金色安全帽的包工头" width={64} height={96} />
        </button>
      </div>
      <p className={styles.note}>{rebirth.completed ? "首次转生仅可进行一次。" : "金币、库存、地块、普通工人、机器人及升级将重置。包工头会加入新工坊。首次转生仅可进行一次。"}</p>
    </>}
    {page === "foreman" && <ForemanProfile />}
    {page === "debug-access" && <form className={styles.passwordForm} onSubmit={(event) => {
      event.preventDefault();
      if (debugPassword === DEBUG_ACCESS_PASSWORD) {
        navigate("debug");
      } else {
        setError("密码不正确，请重试。");
        setDebugPassword("");
        passwordRef.current?.focus({ preventScroll: true });
      }
    }}>
      <h3 className={styles.title}>请输入调试密码</h3>
      <p id="debug-access-description" className={styles.intro}>验证后可调整资源与研究。</p>
      <label className={styles.passwordField}>密码
        <input ref={passwordRef} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={debugPassword}
          aria-invalid={!!error} aria-describedby={error ? "debug-access-description settings-error" : "debug-access-description"}
          onChange={(event) => { setDebugPassword(event.target.value); setError(""); }} />
      </label>
      <div className={styles.buttons}>
        <button type="button" className={panel.button} onClick={goBack}>取消</button>
        <button type="submit" className={`${panel.button} ${panel.solid}`} disabled={!debugPassword}>进入调试</button>
      </div>
    </form>}
    {page === "debug" && <SettingsDebug game={game} onAction={(action, success) => {
      setError("");
      setMessage("");
      try {
        onDebug(action);
        setMessage(success);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "调试修改失败，请重试。");
      }
    }} />}
    {page === "more" && <>
      <label className={styles.row}><span>显示资源增减提示</span><input className={styles.switch} type="checkbox" role="switch" checked={resourceChangesEnabled} onChange={(event) => onResourceChangesChange(event.target.checked)} /></label>
      <label className={styles.row}><span>显示性能数据</span><input className={styles.switch} type="checkbox" role="switch" checked={performanceEnabled} onChange={(event) => onPerformanceChange(event.target.checked)} /></label>
      {row("重新开始", "reset")}
    </>}
    {page === "reset" && <>
      <h3 className={styles.title}>回到初始工坊？</h3>
      <p id="reset-description" className={styles.intro}>当前进度将被清空。</p>
      <p className={styles.note}>建议先导出存档，留住这一轮的成果。</p>
      <div className={`${styles.buttons} ${styles.space}`}><button className={panel.button} onClick={exportSave}>导出存档</button></div>
    </>}
    {page === "import" && preview && <>
      <h3 className={styles.title}>{preview.backup ? "恢复到上一次进度" : "替换当前工坊"}</h3>
      <p className={styles.intro}>{preview.name}</p>
      <dl className={styles.stats}>
        <div><dt>总资产</dt><dd>{number.format(importValue)}</dd></div>
        <div><dt>持有金币</dt><dd>{number.format(preview.state.coins)}</dd></div>
        <div><dt>工坊规模</dt><dd>{preview.state.workers.length} 人 · {preview.state.plots.length} 地块</dd></div>
        <div><dt>{preview.backup ? "备份时间" : "导出时间"}</dt><dd>{saveDate(preview.exportedAt)}</dd></div>
      </dl>
      <p className={styles.note}>将替换当前进度，并自动保留替换前的备份。</p>
    </>}
    <input ref={inputRef} type="file" accept=".json,application/json" aria-label="选择存档文件" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readSave(file); }} />
  </SettingsPanel>;
}
