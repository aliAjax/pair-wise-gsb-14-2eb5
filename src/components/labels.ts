import type { ExecStatus, PlanStatus, RowConflict, SnapshotTagStatus } from "../domain/types";

export const CONFLICT_LABEL: Record<RowConflict, string> = {
  窗口交叠: "同区同油品窗口交叠",
  等级不符: "勾选站点与等级不符",
  超过限价: "限价超过监管指导价上限",
  时间无效: "生效窗口时间无效",
  无适用站点: "区域内无适用等级站点",
  字段不完整: "登记字段不完整",
};

export const PLAN_STATUS_META: Record<PlanStatus, { type: "info" | "warning" | "success" | "danger"; text: string }> = {
  待生效: { type: "info", text: "待生效" },
  生效中: { type: "danger", text: "生效中·价格冻结" },
  待关闭: { type: "warning", text: "窗口到期·核验中" },
  已解除: { type: "success", text: "已解除·价格回落" },
};

export const TAG_STATUS_META: Record<SnapshotTagStatus, { type: "info" | "success" | "danger"; text: string }> = {
  未回传: { type: "info", text: "价签未回传" },
  一致: { type: "success", text: "价签一致" },
  不一致: { type: "danger", text: "价签不一致" },
};

export const EXEC_STATUS_META: Record<ExecStatus, { type: "info" | "warning" | "success" | "danger"; text: string }> = {
  未上报: { type: "info", text: "未上报" },
  执行中: { type: "warning", text: "执行中" },
  已完成: { type: "success", text: "已完成" },
  异常: { type: "danger", text: "执行异常" },
};

export function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const date = new Date(iso);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  return `${fmt(startIso)} ~ ${fmt(endIso)}`;
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 模拟时钟转 datetime-local 输入值 */
export function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
