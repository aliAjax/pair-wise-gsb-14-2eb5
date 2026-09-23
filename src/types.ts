// 领域模型：预案批次、限价预案、冻结版本、价签回传等全部类型定义

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;
export type Fuel = (typeof FUELS)[number];

export const REGIONS = ["城东区", "城西区", "高新区", "临港开发区"] as const;
export type Region = (typeof REGIONS)[number];

export const GRADES = ["一类站", "二类站", "三类站"] as const;
export type Grade = (typeof GRADES)[number];

export const EXEC_STATUSES = ["未上报", "执行中", "已执行", "异常"] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];

export interface Station {
  id: string;
  name: string;
  region: Region;
  grade: Grade;
  fuels: Fuel[];
}

/** 登记区提交的一行原始数据（批量登记表的一行） */
export interface DraftRow {
  region: string;
  fuel: string;
  cap: number;
  start: string;
  end: string;
  grades: string[];
}

/** 冲突类型：窗口非法、同区同油品窗口交叠、站点等级不符、限价超限 */
export type ConflictCode =
  | "WINDOW_INVALID"
  | "WINDOW_OVERLAP"
  | "GRADE_MISMATCH"
  | "CAP_EXCEEDED";

export interface Conflict {
  code: ConflictCode;
  message: string;
}

/** 经过判定层校验后的预案行（携带冲突标注） */
export interface ValidatedRow extends DraftRow {
  rowId: string;
  conflicts: Conflict[];
}

/** 预案批次：整批登记，任一冲突则整批只留草稿 */
export interface Batch {
  id: string;
  code: string;
  createdAt: string;
  status: "草稿" | "已登记";
  rows: ValidatedRow[];
}

export type PlanStatus = "待生效" | "生效中" | "已关闭" | "已解除";

/** 一条已登记预案（批次校验通过后按行生成，独立生命周期） */
export interface Plan {
  id: string;
  batchCode: string;
  region: Region;
  fuel: Fuel;
  cap: number;
  start: string;
  end: string;
  grades: Grade[];
  status: PlanStatus;
  versionId: string | null;
}

export type TagResult = "pending" | "matched" | "mismatch";

/** 冻结版本中的一个站点执行项（含挂牌价快照与价签回传状态） */
export interface FreezeItem {
  id: string;
  stationId: string;
  stationName: string;
  grade: Grade;
  cap: number;
  beforePrice: number; // 生效前挂牌价（解除回落依据）
  lockedPrice: number; // 冻结挂牌价 = min(生效前价, 限价上限)
  execStatus: ExecStatus;
  tagPrice: number | null;
  tagReportedAt: string | null;
  tagResult: TagResult;
}

export type OrderStatus = "待生效" | "已生效" | "已回落";

/** 生效瞬间生成的冻结版本，同时也是一张限价调价单 */
export interface FreezeVersion {
  id: string;
  versionNo: number;
  planId: string;
  batchCode: string;
  region: Region;
  fuel: Fuel;
  cap: number;
  start: string;
  end: string;
  createdAt: string;
  closedAt: string | null;
  releasedAt: string | null;
  orderStatus: OrderStatus;
  items: FreezeItem[];
}

/** 单一持久化根对象：预案、执行、价签、版本、挂牌价全部在一起，保证刷新一致 */
export interface RootState {
  schemaVersion: 1;
  prices: Record<string, number>;
  batches: Batch[];
  plans: Plan[];
  versions: FreezeVersion[];
}
