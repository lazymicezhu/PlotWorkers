import { RESEARCH, SCHEDULER_EFFICIENCY_MAX, SPECIAL_ITEM_IDS, orderCoinReward, parseSavedState } from "./game-engine.ts";
import type { GameState } from "./game-engine.ts";
import { isValidFishingPlotState, isValidFishingProgress } from "./fishing.ts";

export const MAX_SAVE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COLLECTION_SIZE = 10_000;
const SAVE_FORMAT = "plot-workers-save";
const INVALID_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ZONE_TYPES = ["gather", "process", "synthesis", "living", "fishing"];
const WORKER_STATUSES = ["idle", "gathering", "processing", "synthesizing", "waiting", "slacking", "exhausted", "resting", "ready", "fishing"];
type ObjectValue = Record<string, unknown>;

function invalid(field: string): never {
  throw new Error(`存档中的“${field}”无效或不完整，请选择完整的游戏存档。`);
}

function object(value: unknown, field: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as ObjectValue;
}

function number(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) invalid(field);
  return value;
}

function id(value: unknown, field: string): string {
  const result = text(value, field);
  if (INVALID_KEYS.has(result)) invalid(field);
  return result;
}

function choice(value: unknown, choices: readonly string[], field: string) {
  if (typeof value !== "string" || !choices.includes(value)) invalid(field);
}

function boolean(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field);
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE) invalid(field);
  return value;
}

function checkHolyLight(value: unknown): ObjectValue {
  const holyLight = object(value, "圣光洗礼");
  number(holyLight.x, "圣光位置", -Number.MAX_SAFE_INTEGER);
  number(holyLight.y, "圣光位置", -Number.MAX_SAFE_INTEGER);
  number(holyLight.remaining, "圣光剩余时间");
  return holyLight;
}

function checkHolyLights(value: unknown) {
  const holyLightIds = new Set<string>();
  for (const rawHolyLight of list(value, "圣光洗礼")) {
    const holyLight = checkHolyLight(rawHolyLight);
    const holyLightId = id(holyLight.id, "圣光编号");
    if (holyLightIds.has(holyLightId)) invalid("重复圣光编号");
    holyLightIds.add(holyLightId);
  }
}

function checkFishing(state: GameState) {
  const plots = state.plots.filter((plot) => plot.type === "fishing");
  if (plots.length > 1) invalid("摸鱼池数量");
  const fishingPlots = object(state.fishingPlots, "摸鱼池收获");
  for (const [plotId, value] of Object.entries(fishingPlots)) {
    id(plotId, "摸鱼池编号");
    if (!plots.some((plot) => plot.id === plotId)) invalid("摸鱼池收获引用");
    if (!isValidFishingPlotState(value)) invalid("摸鱼池收获记录");
  }
  for (const plot of plots) {
    if (state.research.fishing !== 1) invalid("摸鱼池研究");
    if (plot.cols !== 4 || plot.rows !== 4) invalid("摸鱼池大小");
    if (!isValidFishingPlotState(fishingPlots[plot.id])) invalid("摸鱼池收获记录");
    const occupied = new Set<string>();
    for (const worker of state.workers.filter((worker) => worker.zoneId === plot.id)) {
      if (!isValidFishingProgress(worker.fishing)) invalid("人物垂钓进度");
      if (occupied.has(worker.fishing.seat)) invalid("重复垂钓位置");
      occupied.add(worker.fishing.seat);
    }
    if (occupied.size > 3) invalid("垂钓人数");
  }
  for (const worker of state.workers) {
    if (worker.fishing !== undefined && !isValidFishingProgress(worker.fishing)) invalid("人物垂钓进度");
    if (worker.status === "fishing" && !plots.some((plot) => plot.id === worker.zoneId)) invalid("人物垂钓地块");
  }
}

function checkProductionPlan(value: unknown, state?: GameState) {
  if (value === null) return;
  const plan = object(value, "生产计划");
  const orderId = id(plan.orderId, "追踪订单编号");
  choice(plan.phase, ["tracking", "restoring"], "生产计划状态");
  const managed = new Set<string>();
  for (const [key, recipes, type] of [
    ["process", ["rough", "refined"], "process"],
    ["synthesis", ["cans", "screws", "rebar"], "synthesis"],
  ] as const) {
    for (const [plotId, recipe] of Object.entries(object(plan[key], "原生产配方"))) {
      id(plotId, "托管地块编号");
      choice(recipe, recipes, "原生产配方");
      if (managed.has(plotId)) invalid("重复托管地块");
      managed.add(plotId);
      if (state && !state.plots.some((plot) => plot.id === plotId && plot.type === type)) invalid("托管地块引用");
    }
  }
  const paused = new Set<string>();
  for (const plotId of list(plan.pausedPlotIds, "暂停生产地块")) {
    const key = id(plotId, "暂停生产地块编号");
    if (!managed.has(key) || paused.has(key)) invalid("暂停生产地块引用");
    paused.add(key);
  }
  if (state && state.research.planning < 1) invalid("生产计划研究");
  if (state && plan.phase === "tracking" && !state.orders.some((order) => order.id === orderId)) invalid("追踪订单引用");
}

// The legacy migrator allocates schedulerBots entries. Bound untrusted input
// before migration, and also reject non-finite JSON numbers such as 1e400.
function checkInputBounds(value: unknown, depth = 0) {
  if (depth > 40) throw new Error("存档内容层级过多，无法读取。");
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) invalid("数值范围");
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTION_SIZE) throw new Error("存档中的项目数量过多，无法读取。");
  for (const [key, item] of entries) {
    if (INVALID_KEYS.has(key)) invalid("字段名称");
    checkInputBounds(item, depth + 1);
  }
}

function checkState(state: GameState) {
  number(state.rebirthCount, "转生次数", 0, 1, true);
  if (state.workers.filter((worker) => worker.role === "foreman").length !== state.rebirthCount) invalid("转生奖励记录");
  number(state.coins, "金币");
  const inventory = object(state.inventory, "库存");
  for (const key of ["raw", "cans", "rough", "refined", "screws", "rebar"]) number(inventory[key], `库存.${key}`);
  const specials = object(inventory.specials, "特殊物品");
  for (const key of SPECIAL_ITEM_IDS) number(specials[key], `特殊物品.${key}`, 0, Number.MAX_SAFE_INTEGER, true);

  const plotIds = new Set<string>();
  for (const rawPlot of list(state.plots, "地块")) {
    const plot = object(rawPlot, "地块");
    const plotId = id(plot.id, "地块编号");
    if (plotIds.has(plotId)) invalid("重复地块编号");
    plotIds.add(plotId);
    text(plot.name, "地块名称");
    choice(plot.type, ZONE_TYPES, "地块类型");
    for (const key of ["x", "y"]) number(plot[key], `地块位置.${key}`, -Number.MAX_SAFE_INTEGER);
    if (![4, 8].includes(plot.cols as number) || ![4, 8].includes(plot.rows as number)) invalid("地块大小");
    number(plot.purchasePrice, "地块购买价");
    boolean(plot.enabled, "地块启用状态");
  }

  const workerIds = new Set<string>();
  for (const rawWorker of list(state.workers, "人物")) {
    const worker = object(rawWorker, "人物");
    const workerId = id(worker.id, "人物编号");
    if (workerIds.has(workerId)) invalid("重复人物编号");
    workerIds.add(workerId);
    text(worker.name, "人物名称");
    if (worker.role !== undefined) choice(worker.role, ["foreman"], "人物身份");
    number(worker.mood, "人物心情", 0, 100);
    for (const key of ["stamina", "efficiency", "spirit"]) number(worker[key], `人物属性.${key}`, 1, 10, true);
    for (const key of ["u", "v", "x", "y"]) number(worker[key], `人物位置.${key}`, -Number.MAX_SAFE_INTEGER);
    for (const key of ["duration", "continuousWork", "lazyElapsed", "slowStacks"]) number(worker[key], `人物状态.${key}`);
    if (worker.lazyCheckInterval !== undefined) number(worker.lazyCheckInterval, "人物摸鱼检查间隔", 18, 22);
    choice(worker.personality, ["leader", "slowBurn", "lazy"], "人物性格");
    choice(worker.status, WORKER_STATUSES, "人物状态");
    choice(worker.facing, ["left", "right"], "人物朝向");
    if (worker.zoneId !== null && !plotIds.has(id(worker.zoneId, "人物所在地块"))) invalid("人物所在地块");
    // A recycled plot may still be recorded as the worker's previous workplace.
    if (worker.lastWorkZoneId !== null) id(worker.lastWorkZoneId, "人物上次工作地块");
  }

  for (const plot of state.plots) {
    if (plot.type !== "process" && plot.type !== "synthesis") continue;
    const synthesis = plot.type === "synthesis";
    const production = object((synthesis ? state.synthesisPlots : state.processPlots)[plot.id], "生产地块");
    choice(production.recipe, synthesis ? ["cans", "screws", "rebar"] : ["rough", "refined"], "生产配方");
    number(production.produced, "地块产量", 0, Number.MAX_SAFE_INTEGER, true);
    const batch = object(production.batch, "生产批次");
    boolean(batch.active, "生产批次状态");
    number(batch.progress, "生产批次进度", 0, 1);
    if (synthesis) {
      for (const [key, value] of Object.entries(object(batch.reserved, "合成预扣材料"))) {
        choice(key, ["rough", "refined", "screws"], "合成预扣材料类型");
        number(value, "合成预扣材料数量");
      }
    } else number(batch.reservedRaw, "加工预扣材料");
  }

  const market = object(state.market, "市场");
  for (const key of ["roughPrice", "refinedPrice", "elapsed"]) number(market[key], `市场.${key}`);
  for (const key of ["schedulerSeconds", "canOpenerSeconds", "canOpenerCooldown", "orderElapsed", "orderSerial"] as const) number(state[key], key);
  number(state.schedulerBots, "机器人数量", 1, MAX_COLLECTION_SIZE, true);
  const robots = list(state.schedulerRobots, "机器人");
  if (robots.length !== state.schedulerBots) invalid("机器人数量");
  for (const rawRobot of robots) {
    const robot = object(rawRobot, "机器人");
    number(robot.efficiency, "机器人效率", 1, SCHEDULER_EFFICIENCY_MAX);
    number(robot.intervalSeconds, "机器人间隔", .1, 3);
    const duties = object(robot.duties, "机器人职责");
    for (const key of ["rest", "work", "wake"]) boolean(duties[key], `机器人职责.${key}`);
  }
  for (const key of ["autoCanSupply", "autoSchedulerSupply", "schedulerServiceUnlocked"] as const) boolean(state[key], key);
  const research = object(state.research, "研究");
  for (const [key, info] of Object.entries(RESEARCH)) number(research[key], `研究.${key}`, 0, info.costs.length, true);
  checkFishing(state);
  number(state.researchInvestment, "研究投入");
  number(state.orderRefreshCooldown, "换单冷却", 0, 300);
  checkProductionPlan(state.productionPlan, state);
  for (const key of ZONE_TYPES) number(object(state.plotPurchases, "地块购买记录")[key], "地块购买次数", 0, Number.MAX_SAFE_INTEGER, true);
  const effects = object(state.effects, "道具效果");
  number(effects.canOpener, "罐头起子时间");
  number(effects.smartLeader, "智械领袖时间");
  checkHolyLights(effects.holyLight);

  const orderIds = new Set<string>();
  for (const order of state.orders) {
    const orderId = id(order.id, "订单编号");
    if (orderIds.has(orderId)) invalid("重复订单编号");
    orderIds.add(orderId);
    number(order.remaining, "订单时间");
    number(order.duration, "订单总时长", Math.max(Number.MIN_VALUE, order.remaining));
    const processed = object(order.processed, "订单加工品");
    const synthesized = object(order.synthesized, "订单合成品");
    choice(processed.kind, ["rough", "refined"], "订单加工品类型");
    choice(synthesized.kind, ["screws", "rebar"], "订单合成品类型");
    number(processed.amount, "订单加工品数量", 1, Number.MAX_SAFE_INTEGER, true);
    number(synthesized.amount, "订单合成品数量", 1, Number.MAX_SAFE_INTEGER, true);
    choice(order.reward, ["coins", "special"], "订单奖励");
    if (order.rerolled !== undefined) boolean(order.rerolled, "订单已换单");
    if (!Number.isFinite(orderCoinReward(state, order))) invalid("订单奖励金额");
  }
}

function checkProvidedValues(raw: ObjectValue) {
  const inventory = object(raw.inventory, "库存");
  for (const key of ["screws", "rebar"]) if (inventory[key] !== undefined) number(inventory[key], `库存.${key}`);
  if (inventory.specials !== undefined) {
    const specials = object(inventory.specials, "特殊物品");
    for (const key of SPECIAL_ITEM_IDS) if (specials[key] !== undefined) number(specials[key], `特殊物品.${key}`, 0, Number.MAX_SAFE_INTEGER, true);
  }
  if (raw.effects !== undefined) {
    const effects = object(raw.effects, "道具效果");
    if (effects.holyLight !== undefined && effects.holyLight !== null) {
      if (Array.isArray(effects.holyLight)) checkHolyLights(effects.holyLight);
      else checkHolyLight(effects.holyLight);
    }
  }
  for (const key of ["schedulerSeconds", "canOpenerSeconds", "canOpenerCooldown", "orderElapsed", "orderSerial"]) if (raw[key] !== undefined) number(raw[key], key);
  for (const key of ["autoCanSupply", "autoSchedulerSupply", "schedulerServiceUnlocked"]) if (raw[key] !== undefined) boolean(raw[key], key);
  if (raw.research !== undefined) {
    const research = object(raw.research, "研究");
    for (const [key, info] of Object.entries(RESEARCH)) {
      const introducedVersion = key === "fishing" ? 11 : 10;
      if (research[key] !== undefined || Number(raw.version) >= introducedVersion) number(research[key], `研究.${key}`, 0, info.costs.length, true);
    }
  }
  if (raw.researchInvestment !== undefined || Number(raw.version) >= 10) number(raw.researchInvestment, "研究投入");
  if (raw.orderRefreshCooldown !== undefined || Number(raw.version) >= 10) number(raw.orderRefreshCooldown, "换单冷却", 0, 300);
  if (raw.productionPlan !== undefined || Number(raw.version) >= 10) checkProductionPlan(raw.productionPlan);
  if (Number(raw.version) >= 10) object(raw.research, "研究");
  if (raw.fishingPlots !== undefined || Number(raw.version) >= 11) {
    for (const [plotId, value] of Object.entries(object(raw.fishingPlots, "摸鱼池收获"))) {
      id(plotId, "摸鱼池编号");
      if (!isValidFishingPlotState(value)) invalid("摸鱼池收获记录");
    }
  }
  if (Number(raw.version) >= 11) number(object(raw.plotPurchases, "地块购买记录").fishing, "摸鱼池购买次数", 0, Number.MAX_SAFE_INTEGER, true);
  for (const rawWorker of list(raw.workers, "人物")) {
    const worker = object(rawWorker, "人物");
    if (worker.fishing !== undefined) {
      if (!isValidFishingProgress(worker.fishing)) invalid("人物垂钓进度");
      choice(worker.status, [...WORKER_STATUSES, "dragging"], "人物状态");
      for (const key of ["u", "v", "x", "y"]) number(worker[key], `人物位置.${key}`, -Number.MAX_SAFE_INTEGER);
    }
  }
  if (raw.schedulerRobots !== undefined) {
    const robots = list(raw.schedulerRobots, "机器人");
    if (raw.schedulerBots !== undefined && robots.length !== raw.schedulerBots) invalid("机器人数量");
    for (const value of robots) {
      const robot = object(value, "机器人");
      number(robot.efficiency, "机器人效率", 1);
      number(robot.intervalSeconds, "机器人间隔", .1, 3);
      if (robot.duties !== undefined) {
        const duties = object(robot.duties, "机器人职责");
        for (const key of ["rest", "work", "wake"]) if (duties[key] !== undefined) boolean(duties[key], `机器人职责.${key}`);
      }
    }
  }
  if (raw.orders !== undefined) {
    const orders = list(raw.orders, "订单");
    if (orders.length > 2) invalid("订单数量");
    for (const value of orders) {
      const order = object(value, "订单");
      id(order.id, "订单编号");
      number(order.remaining, "订单时间");
      if (order.duration !== undefined) number(order.duration, "订单总时长", Math.max(Number.MIN_VALUE, order.remaining as number));
      choice(order.reward, ["coins", "special"], "订单奖励");
      if (order.rerolled !== undefined) boolean(order.rerolled, "订单已换单");
      const processed = object(order.processed, "订单加工品");
      const synthesized = object(order.synthesized, "订单合成品");
      choice(processed.kind, ["rough", "refined"], "订单加工品类型");
      choice(synthesized.kind, ["screws", "rebar"], "订单合成品类型");
      number(processed.amount, "订单加工品数量", 1, Number.MAX_SAFE_INTEGER, true);
      number(synthesized.amount, "订单合成品数量", 1, Number.MAX_SAFE_INTEGER, true);
    }
  }
}

function normalizeState(source: unknown): GameState {
  const raw = object(source, "游戏数据");
  if (typeof raw.version === "number" && raw.version > 11) throw new Error("这是较新版本的存档，请更新游戏后再导入。");
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > 11) invalid("存档版本");
  checkInputBounds(raw);
  if (Number(raw.version) >= 9 || raw.rebirthCount !== undefined) number(raw.rebirthCount, "转生次数", 0, 1, true);
  if (raw.schedulerBots !== undefined) number(raw.schedulerBots, "机器人数量", 1, MAX_COLLECTION_SIZE, true);
  const state = parseSavedState(JSON.stringify(raw));
  if (!state) invalid("游戏数据");
  // Fractional can consumption can leave a sub-picounit negative remainder
  // (for example -5e-20). Preserve ordinary saves without accepting real debt.
  if (typeof state.inventory.cans === "number" && state.inventory.cans < 0 && state.inventory.cans >= -1e-12) state.inventory.cans = 0;
  checkState(state);
  checkProvidedValues(raw);
  if (raw.fishingPlots !== undefined) {
    for (const plotId of Object.keys(object(raw.fishingPlots, "摸鱼池收获"))) {
      if (!state.plots.some((plot) => plot.id === plotId && plot.type === "fishing")) invalid("摸鱼池收获引用");
    }
  }
  if (raw.productionPlan !== undefined) checkProductionPlan(raw.productionPlan, state);
  // Migration supplies fields introduced in later versions. Existing production
  // data must still be valid: a misspelled recipe must not silently become rough.
  for (const [key, synthesis] of [["processPlots", false], ["synthesisPlots", true]] as const) {
    if (raw[key] === undefined) continue;
    for (const [plotId, value] of Object.entries(object(raw[key], "生产地块"))) {
      id(plotId, "生产地块编号");
      if (!state.plots.some((plot) => plot.id === plotId && plot.type === (synthesis ? "synthesis" : "process"))) invalid("生产地块引用");
      const production = object(value, "生产地块");
      choice(production.recipe, synthesis ? ["cans", "screws", "rebar"] : ["rough", "refined"], "生产配方");
      number(production.produced, "地块产量", 0, Number.MAX_SAFE_INTEGER, true);
      const batch = object(production.batch, "生产批次");
      boolean(batch.active, "生产批次状态");
      number(batch.progress, "生产批次进度", 0, 1);
      if (synthesis) {
        for (const [material, amount] of Object.entries(object(batch.reserved, "合成预扣材料"))) {
          choice(material, ["rough", "refined", "screws"], "合成预扣材料类型");
          number(amount, "合成预扣材料数量");
        }
      } else number(batch.reservedRaw, "加工预扣材料");
    }
  }
  return state;
}

export function exportGameSave(state: GameState, now = new Date()): string {
  if (!Number.isFinite(now.getTime())) invalid("导出时间");
  const normalized = normalizeState(state);
  const serialized = JSON.stringify({ format: SAVE_FORMAT, formatVersion: 1, exportedAt: now.toISOString(), state: normalized }, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_FILE_BYTES) throw new Error("存档超过 5 MB，暂时无法导出。");
  return serialized;
}

export function parseGameSave(serialized: string): { state: GameState; exportedAt: string | null } {
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_FILE_BYTES) throw new Error("存档文件超过 5 MB，请选择较小的存档文件。");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized.replace(/^\uFEFF/, "")); }
  catch { throw new Error("无法读取存档，请选择游戏导出的 JSON 文件。"); }
  const data = object(parsed, "存档内容");
  let source: unknown = data;
  let exportedAt: string | null = null;
  if ("format" in data) {
    if (data.format !== SAVE_FORMAT) throw new Error("这不是 Plot Workers 的存档文件。");
    if (data.formatVersion !== 1) throw new Error("暂不支持这个存档文件版本，请更新游戏后再导入。");
    if (typeof data.exportedAt !== "string" || !Number.isFinite(Date.parse(data.exportedAt))) invalid("导出时间");
    exportedAt = data.exportedAt;
    source = data.state;
  }
  return { state: normalizeState(source), exportedAt };
}
