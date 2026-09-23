import { defineStore } from "pinia";
import { STATIONS, stationsInScope } from "../data/catalog";
import { loadState, resetState, saveState } from "../data/repository";
import {
  canCloseWindow,
  evaluateTag,
  isPlanReady,
  lockPrice,
  summarizeTags,
  toPlan,
  validateBatch,
  windowPhase
} from "../domain/rules";
import type {
  Batch,
  DraftRow,
  ExecStatus,
  FreezeItem,
  FreezeVersion,
  Fuel,
  Grade,
  Plan,
  Region,
  RootState
} from "../types";

interface ActionResult {
  ok: boolean;
  message: string;
}

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

function nowText(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const useConsoleStore = defineStore("limit-console", {
  state: (): RootState & {
    flash: { type: "success" | "warning" | "error"; text: string } | null;
  } => ({ ...loadState(), flash: null }),

  getters: {
    activeVersions(state): FreezeVersion[] {
      const now = Date.now();
      return state.versions.filter(
        (version) => version.closedAt === null && version.releasedAt === null && windowPhase(version, now) === "active"
      );
    },

    globalTagSummary(state) {
      const open = state.versions.filter((version) => version.closedAt === null);
      const items = open.flatMap((version) => version.items);
      return summarizeTags(items);
    },

    // 站点-油品 → 当前应展示的挂牌价（版本未关闭/未解除即处于冻结，即使窗口时刻已过）
    effectivePrices(state): (stationId: string, fuel: Fuel) => { price: number; frozen: FreezeVersion | null } {
      const open = state.versions.filter((version) => version.closedAt === null && version.releasedAt === null);
      return (stationId: string, fuel: Fuel) => {
        const hit = open.find(
          (version) => version.fuel === fuel && version.items.some((item) => item.stationId === stationId)
        );
        const item = hit?.items.find((entry) => entry.stationId === stationId);
        if (hit && item) return { price: item.lockedPrice, frozen: hit };
        return { price: state.prices[`${stationId}__${fuel}`] ?? 0, frozen: null };
      };
    },

    plansWithBatch(state): Array<Plan & { batchCode: string }> {
      return state.plans.map((plan) => ({ ...plan, batchCode: plan.batchCode }));
    }
  },

  actions: {
    persist() {
      saveState({
        schemaVersion: 1,
        prices: this.prices,
        batches: this.batches,
        plans: this.plans,
        versions: this.versions
      });
    },

    notify(type: "success" | "warning" | "error", text: string) {
      this.flash = { type, text };
    },

    clearFlash() {
      this.flash = null;
    },

    // —— 预案登记：整批校验，冲突则整批只留草稿并逐行标明冲突 ——
    submitBatch(rows: DraftRow[], draftId?: string, forceDraft = false): ActionResult {
      const { rows: validated, hasConflict } = validateBatch(rows, this.plans);
      const existing = draftId ? this.batches.find((batch) => batch.id === draftId) : undefined;
      const maxSeq = this.batches.reduce((acc, batch) => {
        const match = /^BATCH-(\d+)$/.exec(batch.code);
        return match ? Math.max(acc, Number(match[1])) : acc;
      }, 0);
      const code = existing?.code ?? `BATCH-${String(Math.max(maxSeq, this.batches.length) + 1).padStart(3, "0")}`;

      const keepDraft = hasConflict || forceDraft;

      const batch: Batch = {
        id: existing?.id ?? uid("batch"),
        code,
        createdAt: existing?.createdAt ?? nowText(),
        status: keepDraft ? "草稿" : "已登记",
        rows: validated
      };

      if (existing) {
        this.batches = this.batches.map((item) => (item.id === batch.id ? batch : item));
      } else {
        this.batches = [batch, ...this.batches];
      }

      if (keepDraft) {
        this.persist();
        if (forceDraft && !hasConflict) {
          return { ok: true, message: `批次 ${code} 校验无冲突，已按要求先存为草稿；可在草稿区“修改后重交”正式登记。` };
        }
        const count = validated.reduce((acc, row) => acc + row.conflicts.length, 0);
        return {
          ok: false,
          message: `批次 ${code} 存在 ${count} 处冲突，整批仅保存为草稿，未生成生效预案。`
        };
      }

      // 无冲突：逐行生成待生效预案
      const newPlans: Plan[] = validated.map((row) => ({
        ...toPlan(row),
        id: uid("plan"),
        batchCode: code
      }));
      this.plans = [...newPlans, ...this.plans];
      this.persist();
      return { ok: true, message: `批次 ${code} 登记成功，已生成 ${newPlans.length} 条待生效预案。` };
    },

    discardDraft(batchId: string): ActionResult {
      const batch = this.batches.find((item) => item.id === batchId);
      if (!batch || batch.status !== "草稿") return { ok: false, message: "只能删除草稿批次" };
      this.batches = this.batches.filter((item) => item.id !== batchId);
      this.persist();
      return { ok: true, message: `草稿批次 ${batch.code} 已删除` };
    },

    revokePlan(planId: string): ActionResult {
      const plan = this.plans.find((item) => item.id === planId);
      if (!plan || plan.status !== "待生效") return { ok: false, message: "只有待生效预案可以撤销" };
      this.plans = this.plans.filter((item) => item.id !== planId);
      this.persist();
      return { ok: true, message: `预案已撤销（${plan.region} / ${plan.fuel}）` };
    },

    // —— 生效：冻结挂牌价与价签快照，生成版本（调价单） ——
    activatePlan(plan: Plan): ActionResult {
      if (plan.status !== "待生效") return { ok: false, message: "预案不是待生效状态" };
      if (!isPlanReady(plan)) return { ok: false, message: "当前不在生效窗口内，无法生效" };

      const scope = stationsInScope(plan.region, plan.fuel, plan.grades);
      if (scope.length === 0) return { ok: false, message: "适用范围内没有站点，无法冻结" };

      const items: FreezeItem[] = scope.map((station) => {
        const beforePrice = this.prices[`${station.id}__${plan.fuel}`] ?? 0;
        const lockedPrice = lockPrice(beforePrice, plan.cap);
        return {
          id: uid("vi"),
          stationId: station.id,
          stationName: station.name,
          grade: station.grade as Grade,
          cap: plan.cap,
          beforePrice,
          lockedPrice,
          execStatus: "未上报",
          tagPrice: null,
          tagReportedAt: null,
          tagResult: "pending"
        };
      });

      const version: FreezeVersion = {
        id: uid("ver"),
        versionNo: this.versions.length + 1,
        planId: plan.id,
        batchCode: plan.batchCode,
        region: plan.region,
        fuel: plan.fuel,
        cap: plan.cap,
        start: plan.start,
        end: plan.end,
        createdAt: nowText(),
        closedAt: null,
        releasedAt: null,
        orderStatus: "待生效",
        items
      };

      this.versions = [version, ...this.versions];
      this.plans = this.plans.map((item) =>
        item.id === plan.id ? { ...item, status: "生效中", versionId: version.id } : item
      );
      this.persist();
      return {
        ok: true,
        message: `已冻结 ${items.length} 个站点的挂牌价与价签快照，版本 V${version.versionNo}（调价单待生效）。`
      };
    },

    // 后台/刷新后补偿：进入窗口的待生效预案自动生效；到期窗口不自动关闭（受价签闸门约束）
    tick() {
      let activated = 0;
      for (const plan of [...this.plans]) {
        if (isPlanReady(plan)) {
          const result = this.activatePlan(plan);
          if (result.ok) activated += 1;
        }
      }
      return activated;
    },

    // —— 站点上报执行状态 ——
    reportExec(versionId: string, itemId: string, status: ExecStatus): ActionResult {
      const version = this.versions.find((item) => item.id === versionId);
      if (!version) return { ok: false, message: "版本不存在" };
      if (version.closedAt !== null) return { ok: false, message: "窗口已关闭，无需上报" };
      version.items = version.items.map((item) => (item.id === itemId ? { ...item, execStatus: status } : item));
      this.persist();
      return { ok: true, message: "执行状态已上报" };
    },

    // —— 价签回传：与冻结价比对，不一致标红 ——
    reportTag(versionId: string, itemId: string, rawPrice: number | null): ActionResult {
      const version = this.versions.find((item) => item.id === versionId);
      if (!version) return { ok: false, message: "版本不存在" };
      if (version.closedAt !== null) return { ok: false, message: "窗口已关闭，价签已锁定" };
      const target = version.items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "执行站点不存在" };

      const tagPrice = rawPrice === null || Number.isNaN(rawPrice) ? null : Number(rawPrice);
      version.items = version.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              tagPrice,
              tagReportedAt: tagPrice === null ? null : nowText(),
              tagResult: evaluateTag(target.lockedPrice, tagPrice)
            }
          : item
      );
      this.persist();
      const updated = version.items.find((entry) => entry.id === itemId)!;
      if (updated.tagResult === "matched") return { ok: true, message: `${target.stationName} 价签与冻结价一致` };
      return {
        ok: false,
        message: `${target.stationName} 价签 ${tagPrice?.toFixed(2)} 元与冻结价 ${target.lockedPrice.toFixed(2)} 元不一致`
      };
    },

    // —— 关闭窗口：价签未全部回传或不一致时拒绝（调价单不生效） ——
    closeWindow(versionId: string): ActionResult {
      const version = this.versions.find((item) => item.id === versionId);
      if (!version) return { ok: false, message: "版本不存在" };
      if (version.closedAt !== null) return { ok: false, message: "窗口已经关闭" };

      const guard = canCloseWindow(version);
      if (!guard.ok) return { ok: false, message: guard.reason };

      // 闸门通过：窗口关闭，调价单生效，挂牌价正式落为冻结价
      for (const item of version.items) {
        this.prices[`${item.stationId}__${version.fuel}`] = item.lockedPrice;
      }
      version.closedAt = nowText();
      version.orderStatus = "已生效";
      const plan = this.plans.find((item) => item.id === version.planId);
      if (plan) plan.status = "已关闭";
      this.persist();
      return { ok: true, message: `窗口已关闭，版本 V${version.versionNo} 调价单生效，挂牌价已落定。` };
    },

    // —— 解除：按冻结版本回落到生效前挂牌价 ——
    releasePlan(versionId: string): ActionResult {
      const version = this.versions.find((item) => item.id === versionId);
      if (!version) return { ok: false, message: "版本不存在" };
      if (version.closedAt === null) {
        return { ok: false, message: "窗口尚未关闭（价签未核验通过），不能解除" };
      }
      if (version.releasedAt !== null) return { ok: false, message: "该版本已解除回落" };

      for (const item of version.items) {
        this.prices[`${item.stationId}__${version.fuel}`] = item.beforePrice;
      }
      version.releasedAt = nowText();
      version.orderStatus = "已回落";
      const plan = this.plans.find((item) => item.id === version.planId);
      if (plan) plan.status = "已解除";
      this.persist();
      return {
        ok: true,
        message: `版本 V${version.versionNo} 已解除，${version.items.length} 个站点按冻结版本回落至生效前挂牌价。`
      };
    },

    // 常规挂牌价维护：冻结中的站点-油品不允许手改
    updateBasePrice(stationId: string, fuel: Fuel, price: number): ActionResult {
      const { frozen } = this.effectivePrices(stationId, fuel);
      if (frozen) {
        return {
          ok: false,
          message: `该挂牌价正被版本 V${frozen.versionNo} 冻结，窗口关闭前不可手动调整`
        };
      }
      if (!Number.isFinite(price) || price <= 0) return { ok: false, message: "价格必须为大于 0 的数字" };
      this.prices[`${stationId}__${fuel}`] = Number(price);
      this.persist();
      return { ok: true, message: "挂牌价已更新" };
    },

    resetAll(): ActionResult {
      const seeded = resetState();
      this.prices = seeded.prices;
      this.batches = seeded.batches;
      this.plans = seeded.plans;
      this.versions = seeded.versions;
      return { ok: true, message: "已恢复演示数据" };
    },

    stationGrade(stationId: string): Grade {
      return (STATIONS.find((station) => station.id === stationId)?.grade ?? "三类站") as Grade;
    }
  }
});
