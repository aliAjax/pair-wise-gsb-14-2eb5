// 判定层：纯函数规则引擎，不触碰 localStorage、Pinia 与 DOM
import { priceKey } from "./constants";
import type {
  FuelType,
  PlanStatus,
  PriceLimitPlan,
  PriceSnapshot,
  RegistryRow,
  RowConflict,
  SnapshotTagStatus,
  Station,
} from "./types";

/** 监管指导价上限：预案限价不得高于该指导价，否则判为「超过限价」 */
export const GUIDE_CEILING: Record<FuelType, number> = {
  "92号汽油": 8.0,
  "95号汽油": 8.6,
  "98号汽油": 9.6,
  "0号柴油": 7.5,
};

/** 解析一行预案实际覆盖的站点（区域 ∩ 等级，或显式勾选） */
export function resolveStations(
  row: Pick<RegistryRow, "region" | "levels" | "stationIds">,
  stations: Station[],
): Station[] {
  if (!row.region) return [];
  if (row.stationIds.length > 0) {
    return stations.filter(
      (item) => item.region === row.region && row.stationIds.includes(item.id),
    );
  }
  return stations.filter(
    (item) => item.region === row.region && row.levels.includes(item.level),
  );
}

function windowsOverlap(a: RegistryRow, b: RegistryRow): boolean {
  if (a.region !== b.region || a.fuel !== b.fuel) return false;
  // 行内为 datetime-local 本地时间，预案为 ISO 字符串，统一按毫秒比较
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
}

function planOverlaps(row: RegistryRow, plan: PriceLimitPlan): boolean {
  if (row.region !== plan.region || row.fuel !== plan.fuel) return false;
  if (plan.status === "已解除") return false;
  return Date.parse(row.startAt) < Date.parse(plan.endAt) && Date.parse(plan.startAt) < Date.parse(row.endAt);
}

export interface RowValidation {
  conflicts: RowConflict[];
  stationIds: string[];
}

/**
 * 整批校验单行：同一批次内同区域同油品窗口不得交叠；
 * 与已登记（未解除）预案交叠同样判冲突。
 * 返回冲突清单与解析后的覆盖站点。
 */
export function validateRow(
  row: RegistryRow,
  allRows: RegistryRow[],
  peers: PriceLimitPlan[],
  stations: Station[],
): RowValidation {
  const conflicts: RowConflict[] = [];

  if (!row.region || !row.fuel || row.capPrice === null || Number.isNaN(row.capPrice)) {
    conflicts.push("字段不完整");
  }
  if (!row.startAt || !row.endAt || row.startAt >= row.endAt) {
    conflicts.push("时间无效");
  }
  if (row.levels.length === 0) {
    if (!conflicts.includes("字段不完整")) conflicts.push("字段不完整");
  }

  const resolved = resolveStations(row, stations);
  if (row.region && row.levels.length > 0 && resolved.length === 0) {
    conflicts.push("无适用站点");
  }

  // 等级不符：显式勾选了不在预案等级内的站点
  if (row.stationIds.length > 0) {
    const mismatched = stations.filter(
      (item) =>
        row.stationIds.includes(item.id) &&
        (!row.levels.includes(item.level) || item.region !== row.region),
    );
    if (mismatched.length > 0) conflicts.push("等级不符");
  }

  if (row.fuel && row.capPrice !== null && !Number.isNaN(row.capPrice)) {
    if (row.capPrice > GUIDE_CEILING[row.fuel as FuelType]) {
      conflicts.push("超过限价");
    }
  }

  if (row.region && row.fuel && row.startAt && row.endAt && row.startAt < row.endAt) {
    const siblingOverlap = allRows.some(
      (other) => other.id !== row.id && windowsOverlap(row, other),
    );
    const planOverlap = peers.some((plan) => planOverlaps(row, plan));
    if (siblingOverlap || planOverlap) conflicts.push("窗口交叠");
  }

  return { conflicts, stationIds: resolved.map((item) => item.id) };
}

/** 整批判定：任一行存在冲突，则整批只能留草稿 */
export function validateBatch(
  rows: RegistryRow[],
  peers: PriceLimitPlan[],
  stations: Station[],
): Map<string, RowValidation> {
  const result = new Map<string, RowValidation>();
  for (const row of rows) {
    result.set(row.id, validateRow(row, rows, peers, stations));
  }
  return result;
}

export function batchHasConflict(validations: Map<string, RowValidation>): boolean {
  return [...validations.values()].some((item) => item.conflicts.length > 0);
}

// ---------- 生效窗口与冻结快照 ----------

export function isWithinWindow(plan: PriceLimitPlan, atMs: number): boolean {
  const start = Date.parse(plan.startAt);
  const end = Date.parse(plan.endAt);
  return atMs >= start && atMs < end;
}

export function tagStatusOf(snapshot: PriceSnapshot): SnapshotTagStatus {
  if (snapshot.tagUploadedAt === null || snapshot.tagPrice === null) return "未回传";
  return snapshot.tagPrice === snapshot.price ? "一致" : "不一致";
}

export function snapshotBlocked(snapshot: PriceSnapshot): string[] {
  const blockers: string[] = [];
  if (snapshot.execStatus !== "已完成") blockers.push("执行未完成");
  const tag = tagStatusOf(snapshot);
  if (tag === "未回传") blockers.push("价签未回传");
  if (tag === "不一致") blockers.push("价签与冻结价不一致");
  return blockers;
}

/** 窗口是否允许关闭：窗口已结束，且逐站执行完成、价签全部一致 */
export function canClosePlan(
  plan: PriceLimitPlan,
  snapshots: PriceSnapshot[],
  atMs: number,
): boolean {
  if (atMs < Date.parse(plan.endAt)) return false;
  if (snapshots.length === 0) return false;
  return snapshots.every((item) => snapshotBlocked(item).length === 0);
}

/** 执行台看板状态（由数据 + 当前时间推导，不入库） */
export function liveStatus(
  plan: PriceLimitPlan,
  snapshots: PriceSnapshot[],
  atMs: number,
): PlanStatus {
  if (plan.status === "已解除") return "已解除";
  if (atMs < Date.parse(plan.startAt)) return "待生效";
  if (isWithinWindow(plan, atMs)) return "生效中";
  return "待关闭";
}

export function planProgress(
  plan: PriceLimitPlan,
  snapshots: PriceSnapshot[],
): { total: number; executed: number; tagMatched: number } {
  const mine = snapshots.filter((item) => item.planId === plan.id);
  return {
    total: mine.length,
    executed: mine.filter((item) => item.execStatus === "已完成").length,
    tagMatched: mine.filter((item) => tagStatusOf(item) === "一致").length,
  };
}

/** 冻结价：生效瞬间挂牌价不得高于限价上限 */
export function freezePrice(currentPrice: number, capPrice: number): number {
  return Math.min(currentPrice, capPrice);
}

export function getPrice(
  book: Record<string, number>,
  stationId: string,
  fuel: FuelType,
): number {
  return book[priceKey(stationId, fuel)] ?? 0;
}

/**
 * 调价单核验：
 * - 无生效预案覆盖 → 常规调价，直接生效
 * - 限价内且价签已与当前冻结价一致 → 生效，冻结价同步更新
 * - 超过限价，或价签未回传/不一致 → 拒单，挂牌价不动
 */
export interface AdjustmentVerdict {
  accepted: boolean;
  reason: string;
  planId?: string;
}

export function judgeAdjustment(
  stationId: string,
  fuel: FuelType,
  newPrice: number,
  plans: PriceLimitPlan[],
  snapshots: PriceSnapshot[],
  atMs: number,
): AdjustmentVerdict {
  const activeSnap = snapshots.find(
    (snap) =>
      snap.stationId === stationId &&
      snap.fuel === fuel &&
      snap.releasedAt === null &&
      plans.some(
        (plan) => plan.id === snap.planId && plan.status !== "已解除" && isWithinWindow(plan, atMs),
      ),
  );
  if (!activeSnap) return { accepted: true, reason: "无生效限价窗口，按常规调价处理" };

  const covering = plans.find((plan) => plan.id === activeSnap.planId)!;
  if (newPrice > covering.capPrice) {
    return { accepted: false, planId: covering.id, reason: `超过限价上限 ${covering.capPrice.toFixed(2)} 元/升` };
  }
  if (tagStatusOf(activeSnap) !== "一致") {
    return { accepted: false, planId: covering.id, reason: "价签未回传或与冻结价不一致，调价单不生效" };
  }
  return { accepted: true, planId: covering.id, reason: "限价内核验通过" };
}
