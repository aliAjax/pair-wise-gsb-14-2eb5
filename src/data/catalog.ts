import type { Fuel, Region, Station } from "../types";

/** 数据层：基础目录（区域、油品、等级见 types.ts），站点台账与参考限价 */

// 油品参考限价：登记的限价上限不得高于参考限价（判定“超限价”）
export const REFERENCE_CEILING: Record<Fuel, number> = {
  "92号汽油": 7.8,
  "95号汽油": 8.3,
  "98号汽油": 9.4,
  柴油: 7.5
};

// 各油品默认挂牌价（首次初始化价格表用）
export const DEFAULT_PRICE: Record<Fuel, number> = {
  "92号汽油": 7.62,
  "95号汽油": 8.12,
  "98号汽油": 9.05,
  柴油: 7.18
};

export const STATIONS: readonly Station[] = [
  { id: "st-01", name: "城东中心加油站", region: "城东区", grade: "一类站", fuels: ["92号汽油", "95号汽油", "98号汽油", "柴油"] },
  { id: "st-02", name: "城东三环加油站", region: "城东区", grade: "二类站", fuels: ["92号汽油", "95号汽油", "柴油"] },
  { id: "st-03", name: "城东支线加油站", region: "城东区", grade: "三类站", fuels: ["92号汽油", "柴油"] },
  { id: "st-04", name: "城西迎宾加油站", region: "城西区", grade: "一类站", fuels: ["92号汽油", "95号汽油", "98号汽油"] },
  { id: "st-05", name: "城西工业园加油站", region: "城西区", grade: "三类站", fuels: ["92号汽油", "95号汽油", "柴油"] },
  { id: "st-06", name: "高新科创加油站", region: "高新区", grade: "二类站", fuels: ["92号汽油", "95号汽油", "98号汽油", "柴油"] },
  { id: "st-07", name: "高新南站加油站", region: "高新区", grade: "一类站", fuels: ["92号汽油", "95号汽油"] },
  { id: "st-08", name: "临港港口加油站", region: "临港开发区", grade: "一类站", fuels: ["92号汽油", "95号汽油", "柴油"] }
] as const;

export function priceKey(stationId: string, fuel: Fuel | string): string {
  return `${stationId}__${fuel}`;
}

export function stationsInScope(region: Region, fuel: Fuel, grades: readonly string[]): Station[] {
  return STATIONS.filter(
    (station) => station.region === region && station.fuels.includes(fuel) && grades.includes(station.grade)
  );
}

export function stationName(id: string): string {
  return STATIONS.find((station) => station.id === id)?.name ?? id;
}

export function getRegionFuelRegions(): Region[] {
  return [...new Set(STATIONS.map((station) => station.region))] as Region[];
}
