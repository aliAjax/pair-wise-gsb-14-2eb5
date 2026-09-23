import assert from "node:assert";
import { validateBatch, batchHasConflict, freezePrice, canClosePlan, judgeAdjustment, tagStatusOf, isWithinWindow } from "../src/domain/rules";
import { createSeedState, priceKey } from "../src/domain/constants";
import type { RegistryRow, PriceLimitPlan, PriceSnapshot } from "../src/domain/types";

const state = createSeedState(Date.parse("2026-09-23T08:00:00"));
const stations = state.stations;

function row(partial: Partial<RegistryRow>): RegistryRow {
  return {
    id: Math.random().toString(36).slice(2),
    region: "east-1",
    fuel: "92号汽油",
    capPrice: 7.5,
    startAt: "2026-09-24T08:00Z",
    endAt: "2026-09-24T18:00Z",
    levels: ["核心站", "标准站"],
    stationIds: [],
    conflicts: [],
    ...partial,
  } as RegistryRow;
}

// 1. 窗口交叠：同区同油品
const overlap = validateBatch(
  [row({ id: "a" }), row({ id: "b", startAt: "2026-09-24T12:00Z", endAt: "2026-09-24T20:00Z" })],
  [],
  stations,
);
assert.deepStrictEqual(overlap.get("a")!.conflicts, ["窗口交叠"]);
assert.deepStrictEqual(overlap.get("b")!.conflicts, ["窗口交叠"]);

// 相接窗口（首尾相接）不算交叠；不同油品不算交叠
const adjacent = validateBatch(
  [row({ id: "a" }), row({ id: "b", fuel: "95号汽油", startAt: "2026-09-24T18:00Z", endAt: "2026-09-24T20:00Z" })],
  [],
  stations,
);
assert.strictEqual(batchHasConflict(adjacent), false);

// 2. 等级不符：勾选便捷站但等级只含核心/标准
const mismatched = validateBatch(
  [row({ stationIds: ["ST-03"] })],
  [],
  stations,
);
assert.ok(mismatched.values().next().value.conflicts.includes("等级不符"));

// 3. 超过限价：92号汽油指导价上限 8.0
const overCap = validateBatch([row({ capPrice: 8.5 })], [], stations);
assert.ok([...overCap.values()][0].conflicts.includes("超过限价"));

// 4. 与已登记未解除预案交叠
const existingPlan: PriceLimitPlan = {
  id: "p1", batchId: "x", region: "east-1", fuel: "92号汽油", capPrice: 7.5,
  startAt: "2026-09-25T08:00:00.000Z", endAt: "2026-09-25T18:00:00.000Z",
  levels: ["核心站"], stationIds: ["ST-01"], status: "待生效", createdAt: "",
};
const clash = validateBatch(
  [row({ startAt: "2026-09-25T10:00Z", endAt: "2026-09-25T12:00Z" })],
  [existingPlan],
  stations,
);
assert.ok([...clash.values()][0].conflicts.includes("窗口交叠"));
// 已解除预案不阻挡
const released = { ...existingPlan, status: "已解除" as const };
const noClash = validateBatch(
  [row({ startAt: "2026-09-25T10:00Z", endAt: "2026-09-25T12:00Z" })],
  [released],
  stations,
);
assert.strictEqual(batchHasConflict(noClash), false);

// 5. 冻结价不高于限价
assert.strictEqual(freezePrice(7.62, 7.5), 7.5);
assert.strictEqual(freezePrice(7.4, 7.5), 7.4);

// 6. 快照与关闭条件
const startMs = Date.parse("2026-09-24T08:00:00");
const endMs = Date.parse("2026-09-24T18:00:00");
const plan: PriceLimitPlan = {
  id: "p2", batchId: "x", region: "east-1", fuel: "92号汽油", capPrice: 7.5,
  startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
  levels: ["核心站"], stationIds: ["ST-01", "ST-02"], status: "生效中", createdAt: "",
};
function snap(id: string, overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    id, planId: plan.id, stationId: id, fuel: "92号汽油", capPrice: 7.5,
    baselinePrice: 7.67, price: 7.5, frozenAt: new Date(startMs).toISOString(),
    releasedAt: null, execStatus: "未上报", execReportedAt: null,
    tagPrice: null, tagUploadedAt: null, ...overrides,
  };
}
const snaps = [snap("ST-01"), snap("ST-02")];
// 窗口未结束 → 不能关
assert.strictEqual(canClosePlan(plan, snaps, startMs + 3600000), false);
// 窗口结束但未上报、未回传 → 不能关
assert.strictEqual(canClosePlan(plan, snaps, endMs + 1), false);
snaps[0].execStatus = "已完成";
snaps[0].tagPrice = 7.5; snaps[0].tagUploadedAt = new Date().toISOString();
// 第二站仍缺 → 不能关
assert.strictEqual(canClosePlan(plan, snaps, endMs + 1), false);
// 第二站价签不一致 → 不能关
snaps[1].execStatus = "已完成";
snaps[1].tagPrice = 7.6; snaps[1].tagUploadedAt = new Date().toISOString();
assert.strictEqual(tagStatusOf(snaps[1]), "不一致");
assert.strictEqual(canClosePlan(plan, snaps, endMs + 1), false);
// 改回一致 → 可以关
snaps[1].tagPrice = 7.5;
assert.strictEqual(tagStatusOf(snaps[1]), "一致");
assert.strictEqual(canClosePlan(plan, snaps, endMs + 1), true);

// 7. 调价单判定
const plan3: PriceLimitPlan = {
  ...plan, id: "p3", status: "生效中",
  startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
};
const snap3: PriceSnapshot = {
  id: "s3", planId: "p3", stationId: "ST-01", fuel: "92号汽油", capPrice: 7.5,
  baselinePrice: 7.67, price: 7.5, frozenAt: new Date(startMs).toISOString(),
  releasedAt: null, execStatus: "已完成", execReportedAt: null, tagPrice: null, tagUploadedAt: null,
};
const at = startMs + 3600000;
assert.ok(isWithinWindow(plan3, at));
// 超过限价 → 拒单
assert.strictEqual(judgeAdjustment("ST-01", "92号汽油", 7.9, [plan3], [snap3], at).accepted, false);
// 价签未回传 → 即使限价内也拒单
assert.strictEqual(judgeAdjustment("ST-01", "92号汽油", 7.4, [plan3], [snap3], at).accepted, false);
// 价签一致且限价内 → 通过
snap3.tagPrice = 7.5; snap3.tagUploadedAt = new Date().toISOString();
assert.strictEqual(judgeAdjustment("ST-01", "92号汽油", 7.4, [plan3], [snap3], at).accepted, true);
// 无窗口覆盖 → 常规调价直接通过
assert.strictEqual(judgeAdjustment("ST-06", "0号柴油", 7.0, [plan3], [snap3], at).accepted, true);

// 8. 基线价存在（解除回落依据）
assert.ok(state.priceBook[priceKey("ST-01", "92号汽油")] > 0);

console.log("all rule smoke tests passed");
