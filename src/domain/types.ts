// 领域模型：突发限价预案执行台
// 仅描述数据结构，不包含任何存储与页面逻辑

export type FuelType = "92号汽油" | "95号汽油" | "98号汽油" | "0号柴油";

export type StationLevel = "核心站" | "标准站" | "便捷站";

export type RegionCode = "east-1" | "east-2" | "south-1";

/** 站点主数据 */
export interface Station {
  id: string;
  name: string;
  region: RegionCode;
  level: StationLevel;
}

/** 挂牌价账本：stationId + fuel -> 当前挂牌价 */
export type PriceBook = Record<string, number>;

export type PlanStatus = "待生效" | "生效中" | "待关闭" | "已解除";

/** 已登记预案（只有整批校验通过的批次才会生成预案） */
export interface PriceLimitPlan {
  id: string;
  batchId: string;
  region: RegionCode;
  fuel: FuelType;
  /** 限价上限（元/升） */
  capPrice: number;
  startAt: string;
  endAt: string;
  levels: StationLevel[];
  stationIds: string[];
  status: PlanStatus;
  createdAt: string;
}

export type RowConflict =
  | "窗口交叠"
  | "等级不符"
  | "超过限价"
  | "时间无效"
  | "无适用站点"
  | "字段不完整";

/** 预案登记批次中的一行 */
export interface RegistryRow {
  id: string;
  region: RegionCode | "";
  fuel: FuelType | "";
  capPrice: number | null;
  startAt: string;
  endAt: string;
  levels: StationLevel[];
  /** 显式勾选的站点；为空表示按区域+等级自动覆盖全部适用站点 */
  stationIds: string[];
  /** 最近一次整批判定时标注的冲突，草稿行也要带着冲突标记 */
  conflicts: RowConflict[];
}

export type BatchStatus = "草稿" | "已提交";

export interface RegistryBatch {
  id: string;
  title: string;
  status: BatchStatus;
  rows: RegistryRow[];
  createdAt: string;
  updatedAt: string;
}

export type SnapshotTagStatus = "未回传" | "一致" | "不一致";
export type ExecStatus = "未上报" | "执行中" | "已完成" | "异常";

/**
 * 冻结快照：预案生效时，对「覆盖站点 × 油品」逐站冻结。
 * baselinePrice 为生效前挂牌价（解除回落依据，永不改动）；
 * price 为当前冻结挂牌价（限价内调价单生效后会更新）。
 */
export interface PriceSnapshot {
  id: string;
  planId: string;
  stationId: string;
  fuel: FuelType;
  capPrice: number;
  baselinePrice: number;
  price: number;
  frozenAt: string;
  releasedAt: string | null;
  // 站点执行上报
  execStatus: ExecStatus;
  execReportedAt: string | null;
  // 价签回传
  tagPrice: number | null;
  tagUploadedAt: string | null;
}

export type AdjustStatus = "待生效" | "已生效" | "拒单";

/** 调价单：冻结期间任何挂牌价调整必须挂单核验 */
export interface PriceAdjustment {
  id: string;
  stationId: string;
  fuel: FuelType;
  planId: string;
  oldPrice: number;
  newPrice: number;
  status: AdjustStatus;
  reason: string;
  createdAt: string;
  effectiveAt: string | null;
}

export type VersionKind =
  | "常规调价"
  | "预案登记"
  | "预案冻结"
  | "限价内调价"
  | "解除回落";

/** 只增不改的版本流水 */
export interface VersionRecord {
  id: string;
  kind: VersionKind;
  planId?: string;
  stationId?: string;
  fuel?: FuelType;
  summary: string;
  /** 版本对应的挂牌价快照（站点油品维度） */
  price?: number;
  createdAt: string;
}

/** 整体持久化状态 */
export interface ConsoleState {
  stations: Station[];
  priceBook: PriceBook;
  plans: PriceLimitPlan[];
  batches: RegistryBatch[];
  snapshots: PriceSnapshot[];
  adjustments: PriceAdjustment[];
  versions: VersionRecord[];
  /** 模拟时钟（毫秒），驱动生效窗口判定 */
  nowMs: number;
  schemaVersion: 1;
}
