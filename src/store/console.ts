import { defineStore } from "pinia";
import { FUELS, createSeedState, priceKey } from "../domain/constants";
import {
  canClosePlan,
  freezePrice,
  getPrice,
  judgeAdjustment,
  tagStatusOf,
  validateBatch,
  batchHasConflict,
  type RowValidation,
} from "../domain/rules";
import { loadState, resetState, saveState } from "./storage";
import type {
  AdjustStatus,
  ConsoleState,
  ExecStatus,
  PriceAdjustment,
  PriceLimitPlan,
  PriceSnapshot,
  RegistryBatch,
  RegistryRow,
  RowConflict,
  StationLevel,
  VersionKind,
  VersionRecord,
} from "../domain/types";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRow(): RegistryRow {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 24 * 3600000);
  const toLocalInput = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  return {
    id: uid("row"),
    region: "",
    fuel: "",
    capPrice: null,
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    levels: [...([] as StationLevel[])],
    stationIds: [],
    conflicts: [],
  };
}

export interface SubmitResult {
  ok: boolean;
  message: string;
}

export const useConsoleStore = defineStore("limit-console", {
  state: (): ConsoleState & { activeBatchId: string | null } => {
    const initial = loadState();
    return { ...initial, activeBatchId: null };
  },

  getters: {
    activeBatch(state): RegistryBatch | null {
      return state.batches.find((item) => item.id === state.activeBatchId) ?? null;
    },
  },

  actions: {
    persist() {
      saveState({
        stations: this.stations,
        priceBook: this.priceBook,
        plans: this.plans,
        batches: this.batches,
        snapshots: this.snapshots,
        adjustments: this.adjustments,
        versions: this.versions,
        nowMs: this.nowMs,
        schemaVersion: 1,
      });
    },

    logVersion(entry: Omit<VersionRecord, "id" | "createdAt"> & { createdAt?: string }) {
      this.versions.unshift({
        id: uid("v"),
        createdAt: entry.createdAt ?? new Date(this.nowMs).toISOString(),
        ...entry,
      });
    },

    // ---------- 登记批次 ----------

    createBatch(title: string): string {
      const batch: RegistryBatch = {
        id: uid("batch"),
        title: title || "未命名限价预案批次",
        status: "草稿",
        rows: [emptyRow()],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.batches.unshift(batch);
      this.activeBatchId = batch.id;
      this.persist();
      return batch.id;
    },

    openBatch(id: string) {
      this.activeBatchId = id;
    },

    closeBatchEditor() {
      this.activeBatchId = null;
    },

    updateBatchTitle(title: string) {
      const batch = this.activeBatch;
      if (!batch) return;
      batch.title = title;
      batch.updatedAt = nowIso();
      this.persist();
    },

    addRow() {
      this.activeBatch?.rows.push(emptyRow());
      this.persist();
    },

    updateRow(id: string, patch: Partial<RegistryRow>) {
      const batch = this.activeBatch;
      if (!batch) return;
      const row = batch.rows.find((item) => item.id === id);
      if (!row) return;
      Object.assign(row, patch);
      batch.updatedAt = nowIso();
      this.persist();
    },

    removeRow(id: string) {
      const batch = this.activeBatch;
      if (!batch) return;
      batch.rows = batch.rows.filter((item) => item.id !== id);
      if (batch.rows.length === 0) batch.rows.push(emptyRow());
      this.persist();
    },

    removeBatch(id: string) {
      const batch = this.batches.find((item) => item.id === id);
      if (batch && batch.status === "已提交") return;
      this.batches = this.batches.filter((item) => item.id !== id);
      if (this.activeBatchId === id) this.activeBatchId = null;
      this.persist();
    },

    /** 实时预览整批判定（不修改数据） */
    previewValidations(): Map<string, RowValidation> {
      const batch = this.activeBatch;
      if (!batch) return new Map();
      const peers = this.plans.filter((plan) => plan.status !== "已解除");
      return validateBatch(batch.rows, peers, this.stations);
    },

    /**
     * 整批提交：等级不符、超过限价、窗口交叠……
     * 只要有一行冲突，整批只保留为草稿，并在每一行标明冲突原因。
     */
    submitBatch(): SubmitResult {
      const batch = this.activeBatch;
      if (!batch) return { ok: false, message: "未选择批次" };

      const peers = this.plans.filter((plan) => plan.status !== "已解除");
      const validations = validateBatch(batch.rows, peers, this.stations);
      let conflictCount = 0;
      for (const row of batch.rows) {
        const validation = validations.get(row.id);
        row.conflicts = validation ? [...validation.conflicts] : [];
        conflictCount += row.conflicts.length;
      }
      batch.updatedAt = nowIso();

      if (conflictCount > 0 || batchHasConflict(validations)) {
        batch.status = "草稿";
        this.persist();
        return {
          ok: false,
          message: `整批校验未通过：${conflictCount} 处冲突，批次保留为草稿并已逐行标明`,
        };
      }

      const stamp = new Date(this.nowMs).toISOString();
      for (const row of batch.rows) {
        const validation = validations.get(row.id)!;
        const plan: PriceLimitPlan = {
          id: uid("plan"),
          batchId: batch.id,
          region: row.region as PriceLimitPlan["region"],
          fuel: row.fuel as PriceLimitPlan["fuel"],
          capPrice: Number(row.capPrice),
          startAt: new Date(row.startAt).toISOString(),
          endAt: new Date(row.endAt).toISOString(),
          levels: [...row.levels],
          stationIds: validation.stationIds,
          status: "待生效",
          createdAt: stamp,
        };
        this.plans.unshift(plan);
        this.logVersion({
          kind: "预案登记",
          planId: plan.id,
          summary: `登记预案：${plan.fuel} 限价 ${plan.capPrice.toFixed(2)} 元/升，覆盖 ${plan.stationIds.length} 站`,
        });
      }
      batch.status = "已提交";
      this.activeBatchId = null;
      this.persist();
      // 登记后立即按当前时钟尝试激活，保证刷新后状态一致
      this.tick(0);
      return { ok: true, message: `整批校验通过，已生成 ${batch.rows.length} 条预案` };
    },

    // ---------- 时钟驱动的窗口推进 ----------

    /**
     * 推进模拟时钟（毫秒）。统一处理：
     * 1) 预案到点生效 → 逐站冻结挂牌价与价签快照
     * 2) 窗口到期 → 满足关闭条件则自动解除，按冻结前基线版本回落
     */
    tick(deltaMs: number) {
      this.nowMs += deltaMs;
      this.activateDuePlans();
      this.closeReadyPlans();
      this.persist();
    },

    setClock(ms: number) {
      this.nowMs = ms;
      this.activateDuePlans();
      this.closeReadyPlans();
      this.persist();
    },

    activateDuePlans() {
      for (const plan of this.plans) {
        if (plan.status !== "待生效") continue;
        if (this.nowMs < Date.parse(plan.startAt)) continue;

        const stamp = new Date(this.nowMs).toISOString();
        for (const stationId of plan.stationIds) {
          const current = getPrice(this.priceBook, stationId, plan.fuel);
          const frozen = freezePrice(current, plan.capPrice);
          const snapshot: PriceSnapshot = {
            id: uid("snap"),
            planId: plan.id,
            stationId,
            fuel: plan.fuel,
            capPrice: plan.capPrice,
            baselinePrice: current,
            price: frozen,
            frozenAt: stamp,
            releasedAt: null,
            execStatus: "未上报",
            execReportedAt: null,
            tagPrice: null,
            tagUploadedAt: null,
          };
          this.snapshots.push(snapshot);
          // 生效瞬间，高于限价的挂牌价被冻结到限价
          this.priceBook[priceKey(stationId, plan.fuel)] = frozen;
        }
        plan.status = "生效中";
        this.logVersion({
          kind: "预案冻结",
          planId: plan.id,
          summary: `预案生效，冻结 ${plan.stationIds.length} 站 ${plan.fuel} 挂牌价与价签快照`,
          createdAt: stamp,
        });
      }
    },

    closeReadyPlans() {
      for (const plan of this.plans) {
        if (plan.status !== "生效中" && plan.status !== "待关闭") continue;
        const mine = this.snapshots.filter(
          (item) => item.planId === plan.id && item.releasedAt === null,
        );
        if (!canClosePlan(plan, mine, this.nowMs)) continue;
        this.releasePlan(plan);
      }
    },

    // ---------- 站点执行与价签回传 ----------

    reportExec(snapshotId: string, status: ExecStatus) {
      const snap = this.snapshots.find((item) => item.id === snapshotId);
      if (!snap) return;
      if (snap.releasedAt) return;
      snap.execStatus = status;
      snap.execReportedAt = new Date(this.nowMs).toISOString();
      this.persist();
      this.tick(0);
    },

    /** 价签回传：记录拍照价；与冻结价不一致时仅标记，不允许任何放行 */
    uploadTag(snapshotId: string, tagPrice: number | null) {
      const snap = this.snapshots.find((item) => item.id === snapshotId);
      if (!snap || snap.releasedAt) return;
      if (tagPrice === null || Number.isNaN(tagPrice)) return;
      snap.tagPrice = Number(tagPrice);
      snap.tagUploadedAt = new Date(this.nowMs).toISOString();
      this.persist();
      this.tick(0);
    },

    // ---------- 调价单 ----------

    submitAdjustment(input: {
      stationId: string;
      fuel: PriceAdjustment["fuel"];
      newPrice: number;
      reason: string;
    }): SubmitResult {
      if (!input.stationId || Number.isNaN(input.newPrice)) {
        return { ok: false, message: "请填写站点、油品与新价格" };
      }
      const oldPrice = getPrice(this.priceBook, input.stationId, input.fuel);
      const verdict = judgeAdjustment(
        input.stationId,
        input.fuel,
        input.newPrice,
        this.plans,
        this.snapshots,
        this.nowMs,
      );
      const stamp = new Date(this.nowMs).toISOString();
      const order: PriceAdjustment = {
        id: uid("adj"),
        stationId: input.stationId,
        fuel: input.fuel,
        planId: verdict.planId ?? "",
        oldPrice,
        newPrice: input.newPrice,
        status: "待生效" as AdjustStatus,
        reason: input.reason || verdict.reason,
        createdAt: stamp,
        effectiveAt: null,
      };

      if (verdict.accepted) {
        order.status = "已生效";
        order.effectiveAt = stamp;
        this.priceBook[priceKey(input.stationId, input.fuel)] = input.newPrice;
        if (verdict.planId) {
          // 限价内调价：冻结快照价格同步，价签须重新与新冻结价核对
          const snap = this.snapshots.find(
            (item) =>
              item.planId === verdict.planId &&
              item.stationId === input.stationId &&
              item.fuel === input.fuel &&
              item.releasedAt === null,
          );
          if (snap) {
            snap.price = input.newPrice;
            snap.tagPrice = null;
            snap.tagUploadedAt = null;
          }
          this.logVersion({
            kind: "限价内调价",
            planId: verdict.planId,
            stationId: input.stationId,
            fuel: input.fuel,
            price: input.newPrice,
            summary: `${input.fuel} 限价内调价 ${oldPrice.toFixed(2)} → ${input.newPrice.toFixed(2)}，需重新回传价签`,
          });
        } else {
          this.logVersion({
            kind: "常规调价",
            stationId: input.stationId,
            fuel: input.fuel,
            price: input.newPrice,
            summary: `${input.fuel} 常规调价 ${oldPrice.toFixed(2)} → ${input.newPrice.toFixed(2)}`,
          });
        }
      } else {
        order.status = "拒单";
        order.reason = verdict.reason;
      }

      this.adjustments.unshift(order);
      this.persist();
      this.tick(0);
      return {
        ok: verdict.accepted,
        message: verdict.accepted
          ? `调价单已生效：${verdict.reason}`
          : `调价单拒单：${verdict.reason}`,
      };
    },

    // ---------- 解除回落 ----------

    /** 解除预案：逐站按冻结前基线版本回落挂牌价；条件不足时拒绝 */
    releasePlanManually(planId: string): SubmitResult {
      const plan = this.plans.find((item) => item.id === planId);
      if (!plan) return { ok: false, message: "预案不存在" };
      if (plan.status === "已解除") return { ok: false, message: "预案已解除" };
      const mine = this.snapshots.filter(
        (item) => item.planId === plan.id && item.releasedAt === null,
      );
      if (this.nowMs < Date.parse(plan.endAt)) {
        return { ok: false, message: "生效窗口尚未结束，不能关闭" };
      }
      if (!canClosePlan(plan, mine, this.nowMs)) {
        const blockers = mine.flatMap((snap) => {
          const list: string[] = [];
          if (snap.execStatus !== "已完成") list.push(`${snap.stationId} 执行未完成`);
          const tag = tagStatusOf(snap);
          if (tag !== "一致") list.push(`${snap.stationId} 价签${tag}`);
          return list;
        });
        return { ok: false, message: `窗口不得关闭：${blockers.join("；")}` };
      }
      this.releasePlan(plan);
      this.persist();
      return { ok: true, message: "预案解除，挂牌价已按冻结前版本回落" };
    },

    releasePlan(plan: PriceLimitPlan) {
      const stamp = new Date(this.nowMs).toISOString();
      const mine = this.snapshots.filter(
        (item) => item.planId === plan.id && item.releasedAt === null,
      );
      for (const snap of mine) {
        // 按冻结版本（生效前基线）回落
        this.priceBook[priceKey(snap.stationId, snap.fuel)] = snap.baselinePrice;
        snap.releasedAt = stamp;
      }
      plan.status = "已解除";
      this.logVersion({
        kind: "解除回落",
        planId: plan.id,
        summary: `预案解除，${mine.length} 站 ${plan.fuel} 按冻结前版本回落挂牌价`,
        createdAt: stamp,
      });
    },

    // ---------- 维护 ----------

    resetAll() {
      const seed = resetState();
      Object.assign(this, { ...seed, activeBatchId: null });
    },

    seedDemoBatch() {
      // 便于演示：生成一个一小时后生效的两小时窗口批次
      if (this.batches.some((item) => item.id === "batch-demo")) return;
      const start = new Date(this.nowMs + 3600000);
      const end = new Date(this.nowMs + 3 * 3600000);
      const toLocalInput = (date: Date) => {
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      };
      const row: RegistryRow = {
        id: uid("row"),
        region: "east-1",
        fuel: FUELS[0],
        capPrice: 7.55,
        startAt: toLocalInput(start),
        endAt: toLocalInput(end),
        levels: ["核心站", "标准站"],
        stationIds: [],
        conflicts: [],
      };
      const batch: RegistryBatch = {
        id: "batch-demo",
        title: "示例：城东一区92号汽油临时限价",
        status: "草稿",
        rows: [row],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.batches.unshift(batch);
      this.persist();
    },
  },
});

// 供页面使用的辅助类型再导出
export type { RowConflict };
