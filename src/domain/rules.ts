import { REFERENCE_CEILING, stationsInScope } from "../data/catalog";
import type {
  Batch,
  Conflict,
  DraftRow,
  FreezeItem,
  FreezeVersion,
  Fuel,
  Grade,
  Plan,
  Region,
  TagResult,
  ValidatedRow
} from "../types";

/**
 * 判定层：全部为纯函数，不接触存储与页面。
 * 规则：
 *  1. 生效窗口必须合法（开始早于结束）；
 *  2. 同区同油品的生效窗口不得交叠（含批次内、与既有预案）；
 *  3. 等级不符：区域内该油品下没有任何所选等级站点；
 *  4. 超限价：限价上限高于该油品参考限价。
 * 任一行存在冲突，整批只留“草稿”，并逐行标明冲突。
 */

function timeValue(value: string): number {
  return value ? Date.parse(value.replace(" ", "T")) : NaN;
}

export function windowValid(start: string, end: string): boolean {
  const s = timeValue(start);
  const e = timeValue(end);
  return Number.isFinite(s) && Number.isFinite(e) && s < e;
}

/** 两个闭区间是否交叠（首尾相接不算交叠） */
export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [as, ae, bs, be] = [timeValue(aStart), timeValue(aEnd), timeValue(bStart), timeValue(bEnd)];
  return as < be && bs < ae;
}

/** 窗口与当前时刻的相对状态，用于页面与后台自动生效判定 */
export function windowPhase(
  plan: Pick<Plan, "start" | "end"> & { status?: Plan["status"] },
  now: number = Date.now()
):
  | "before"
  | "active"
  | "after" {
  if (plan.status === "已关闭" || plan.status === "已解除") return "after";
  const s = timeValue(plan.start);
  const e = timeValue(plan.end);
  if (now < s) return "before";
  if (now >= e) return "after";
  return "active";
}

function validateRow(
  row: DraftRow,
  rowId: string,
  otherRows: DraftRow[],
  existingPlans: Plan[]
): ValidatedRow {
  const conflicts: Conflict[] = [];
  const region = row.region as Region;
  const fuel = row.fuel as Fuel;

  if (!windowValid(row.start, row.end)) {
    conflicts.push({ code: "WINDOW_INVALID", message: "生效窗口非法：开始时间必须早于结束时间" });
  }

  if (region && fuel && windowValid(row.start, row.end)) {
    // 批次内同区同油品交叠
    const innerHit = otherRows.some(
      (other) =>
        other !== row &&
        other.region === region &&
        other.fuel === fuel &&
        windowValid(other.start, other.end) &&
        windowsOverlap(row.start, row.end, other.start, other.end)
    );
    // 与已登记预案（待生效/生效中）交叠；草稿不占用窗口
    const outerHit = existingPlans
      .filter((plan) => plan.status === "待生效" || plan.status === "生效中")
      .some(
        (plan) =>
          plan.region === region &&
          plan.fuel === fuel &&
          windowsOverlap(row.start, row.end, plan.start, plan.end)
      );
    if (innerHit || outerHit) {
      conflicts.push({
        code: "WINDOW_OVERLAP",
        message: `同区同油品窗口交叠：${region} / ${fuel} 已存在重叠的生效窗口`
      });
    }
  }

  if (!region || !fuel || row.grades.length === 0) {
    if (row.grades.length === 0) {
      conflicts.push({ code: "GRADE_MISMATCH", message: "等级不符：未选择任何站点等级" });
    }
  } else {
    const scope = stationsInScope(region, fuel, row.grades);
    if (scope.length === 0) {
      conflicts.push({
        code: "GRADE_MISMATCH",
        message: `等级不符：${region}销售${fuel}的站点中没有“${row.grades.join("、")}”站点`
      });
    }
  }

  const cap = Number(row.cap);
  if (!Number.isFinite(cap) || cap <= 0) {
    conflicts.push({ code: "CAP_EXCEEDED", message: "超限价：限价上限必须为大于 0 的数字" });
  } else if (fuel && cap > REFERENCE_CEILING[fuel] + 1e-9) {
    conflicts.push({
      code: "CAP_EXCEEDED",
      message: `超限价：${fuel}限价上限 ${cap.toFixed(2)} 元高于参考限价 ${REFERENCE_CEILING[fuel].toFixed(2)} 元`
    });
  }

  return { ...row, rowId, conflicts };
}

/** 校验整批：返回逐行结果；hasConflict=true 时整批只能落草稿 */
export function validateBatch(
  rows: DraftRow[],
  existingPlans: Plan[]
): { rows: ValidatedRow[]; hasConflict: boolean } {
  const validated = rows.map((row, index) =>
    validateRow(row, `row-${index + 1}`, rows, existingPlans)
  );
  return { rows: validated, hasConflict: validated.some((row) => row.conflicts.length > 0) };
}

/** 校验通过的行转为可持久化预案 */
export function toPlan(row: ValidatedRow): Omit<Plan, "id"> {
  return {
    batchCode: "",
    region: row.region as Region,
    fuel: row.fuel as Fuel,
    cap: Number(row.cap),
    start: row.start,
    end: row.end,
    grades: row.grades as Grade[],
    status: "待生效",
    versionId: null
  };
}

export function isPlanReady(plan: Plan, now: number = Date.now()): boolean {
  return plan.status === "待生效" && windowPhase(plan, now) === "active";
}

/** 价签判定：未回传 / 与冻结价不一致 / 一致 */
export function evaluateTag(lockedPrice: number, tagPrice: number | null): TagResult {
  if (tagPrice === null || Number.isNaN(tagPrice)) return "pending";
  return Math.abs(tagPrice - lockedPrice) < 1e-9 ? "matched" : "mismatch";
}

export interface TagSummary {
  total: number;
  reported: number;
  matched: number;
  mismatch: number;
  pending: number;
  allMatched: boolean;
}

export function summarizeTags(items: readonly FreezeItem[]): TagSummary {
  const total = items.length;
  const reported = items.filter((item) => item.tagResult !== "pending").length;
  const matched = items.filter((item) => item.tagResult === "matched").length;
  const mismatch = items.filter((item) => item.tagResult === "mismatch").length;
  return { total, reported, matched, mismatch, pending: total - reported, allMatched: total > 0 && matched === total };
}

/** 窗口关闭闸门：价签未全部回传或存在不一致，均不得关闭（调价单不生效） */
export function canCloseWindow(version: Pick<FreezeVersion, "items">): { ok: boolean; reason: string } {
  const summary = summarizeTags(version.items);
  if (summary.total === 0) return { ok: false, reason: "冻结版本内没有执行站点" };
  if (summary.pending > 0) return { ok: false, reason: `仍有 ${summary.pending} 个站点价签未回传，窗口不得关闭` };
  if (summary.mismatch > 0) {
    return { ok: false, reason: `${summary.mismatch} 个站点价签与冻结价不一致，窗口不得关闭` };
  }
  return { ok: true, reason: "" };
}

/** 冻结价：生效前挂牌价与限价上限取低 */
export function lockPrice(beforePrice: number, cap: number): number {
  return Math.min(Number(beforePrice), Number(cap));
}

export function isVersionFrozen(version: FreezeVersion, now: number = Date.now()): boolean {
  return version.closedAt === null && timeValue(version.start) <= now && now < timeValue(version.end);
}

/** 生效中的预案 → 对该站点该油品生效（区域、油品、等级匹配） */
export function matchingVersions(
  versions: readonly FreezeVersion[],
  stationId: string,
  stationGrade: Grade,
  fuel: Fuel,
  now: number = Date.now()
): FreezeVersion[] {
  return versions.filter(
    (version) =>
      version.releasedAt === null &&
      isVersionFrozen(version, now) &&
      version.fuel === fuel &&
      version.items.some((item) => item.stationId === stationId && item.grade === stationGrade)
  );
}
