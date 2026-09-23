import { DEFAULT_PRICE, STATIONS, stationsInScope } from "../data/catalog";
import { evaluateTag, lockPrice, validateBatch } from "../domain/rules";
import type {
  Batch,
  FreezeItem,
  FreezeVersion,
  Plan,
  RootState
} from "../types";

/**
 * 存储层：负责 RootState 的序列化、反序列化与初始化种子数据。
 * 页面与判定层不直接访问 localStorage。
 */

export const STORAGE_KEY = "dfwlfront-9-limit-console-v1";

function seedPrices(): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const station of STATIONS) {
    for (const fuel of station.fuels) {
      let price = DEFAULT_PRICE[fuel];
      if (station.id === "st-02" && fuel === "92号汽油") price = 7.6;
      if (station.id === "st-04" && fuel === "95号汽油") price = 8.15;
      prices[`${station.id}__${fuel}`] = price;
    }
  }
  return prices;
}

function seedState(): RootState {
  const prices = seedPrices();

  const plan1: Plan = {
    id: "plan-seed-1",
    batchCode: "BATCH-001",
    region: "城东区",
    fuel: "92号汽油",
    cap: 7.5,
    start: "2026-09-21T08:00",
    end: "2026-09-25T20:00",
    grades: ["一类站", "二类站"],
    status: "生效中",
    versionId: "ver-seed-1"
  };

  const plan2: Plan = {
    id: "plan-seed-2",
    batchCode: "BATCH-002",
    region: "城西区",
    fuel: "95号汽油",
    cap: 8.0,
    start: "2026-09-26T08:00",
    end: "2026-09-28T20:00",
    grades: ["一类站"],
    status: "待生效",
    versionId: null
  };

  const scope1 = stationsInScope(plan1.region, plan1.fuel, plan1.grades);
  const items: FreezeItem[] = scope1.map((station, index) => {
    const beforePrice = prices[`${station.id}__${plan1.fuel}`];
    const lockedPrice = lockPrice(beforePrice, plan1.cap);
    // 演示数据：城东中心已回传一致价签；城东三环回传了高于冻结价的价签 → 窗口被卡住
    const tagPrice = station.id === "st-01" ? 7.5 : station.id === "st-02" ? 7.55 : null;
    const tagReportedAt = tagPrice === null ? null : "2026-09-21T09:12";
    return {
      id: `vi-seed-${index + 1}`,
      stationId: station.id,
      stationName: station.name,
      grade: station.grade,
      cap: plan1.cap,
      beforePrice,
      lockedPrice,
      execStatus: station.id === "st-01" ? "已执行" : "异常",
      tagPrice,
      tagReportedAt,
      tagResult: evaluateTag(lockedPrice, tagPrice)
    };
  });

  const version1: FreezeVersion = {
    id: "ver-seed-1",
    versionNo: 1,
    planId: plan1.id,
    batchCode: plan1.batchCode,
    region: plan1.region,
    fuel: plan1.fuel,
    cap: plan1.cap,
    start: plan1.start,
    end: plan1.end,
    createdAt: "2026-09-21T08:00",
    closedAt: null,
    releasedAt: null,
    orderStatus: "待生效",
    items
  };

  const { rows: registeredRows1 } = validateBatch(
    [
      {
        region: plan1.region,
        fuel: plan1.fuel,
        cap: plan1.cap,
        start: plan1.start,
        end: plan1.end,
        grades: [...plan1.grades]
      }
    ],
    []
  );
  const { rows: registeredRows2 } = validateBatch(
    [
      {
        region: plan2.region,
        fuel: plan2.fuel,
        cap: plan2.cap,
        start: plan2.start,
        end: plan2.end,
        grades: [...plan2.grades]
      }
    ],
    [plan1]
  );

  const batch1: Batch = {
    id: "batch-seed-1",
    code: "BATCH-001",
    createdAt: "2026-09-20T15:30",
    status: "已登记",
    rows: registeredRows1
  };
  const batch2: Batch = {
    id: "batch-seed-2",
    code: "BATCH-002",
    createdAt: "2026-09-22T10:05",
    status: "已登记",
    rows: registeredRows2
  };

  // 草稿批次：覆盖四类冲突（窗口非法、窗口交叠、等级不符、超限价）
  const draftRaw = [
    {
      region: "高新区",
      fuel: "98号汽油",
      cap: 9.1,
      start: "2026-09-27T08:00",
      end: "2026-09-29T20:00",
      grades: ["三类站"]
    },
    {
      region: "城西区",
      fuel: "柴油",
      cap: 7.6,
      start: "2026-09-27T08:00",
      end: "2026-09-29T20:00",
      grades: ["三类站"]
    },
    {
      region: "城东区",
      fuel: "92号汽油",
      cap: 7.4,
      start: "2026-09-23T00:00",
      end: "2026-09-24T00:00",
      grades: ["一类站"]
    },
    {
      region: "临港开发区",
      fuel: "95号汽油",
      cap: 8.0,
      start: "2026-09-29T20:00",
      end: "2026-09-27T08:00",
      grades: ["一类站"]
    }
  ];
  const { rows: draftRows } = validateBatch(draftRaw, [plan1, plan2]);
  const batch3: Batch = {
    id: "batch-seed-3",
    code: "BATCH-003",
    createdAt: "2026-09-22T16:40",
    status: "草稿",
    rows: draftRows
  };

  return {
    schemaVersion: 1,
    prices,
    batches: [batch3, batch2, batch1],
    plans: [plan2, plan1],
    versions: [version1]
  };
}

export function loadState(): RootState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RootState;
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.plans) && Array.isArray(parsed.versions)) {
        return parsed;
      }
    } catch {
      // 数据损坏时回落到种子数据
    }
  }
  return seedState();
}

export function saveState(state: RootState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): RootState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
