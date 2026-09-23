import type {
  ConsoleState,
  FuelType,
  PriceBook,
  Station,
  StationLevel,
} from "./types";

export const FUELS: readonly FuelType[] = [
  "92号汽油",
  "95号汽油",
  "98号汽油",
  "0号柴油",
];

export const STATION_LEVELS: readonly StationLevel[] = [
  "核心站",
  "标准站",
  "便捷站",
];

export const REGIONS = [
  { code: "east-1", label: "城东一区" },
  { code: "east-2", label: "城东二区" },
  { code: "south-1", label: "城南一区" },
] as const;

export function regionLabel(code: string): string {
  return REGIONS.find((item) => item.code === code)?.label ?? code;
}

export function stationLabel(stations: Station[], id: string): string {
  return stations.find((item) => item.id === id)?.name ?? id;
}

const BASE_STATIONS: Station[] = [
  { id: "ST-01", name: "城东中心加油站", region: "east-1", level: "核心站" },
  { id: "ST-02", name: "湖滨东路加油站", region: "east-1", level: "标准站" },
  { id: "ST-03", name: "望江路便捷站", region: "east-1", level: "便捷站" },
  { id: "ST-04", name: "高新园加油站", region: "east-2", level: "标准站" },
  { id: "ST-05", name: "会展中心加油站", region: "east-2", level: "核心站" },
  { id: "ST-06", name: "城南枢纽加油站", region: "south-1", level: "核心站" },
  { id: "ST-07", name: "大学城加油站", region: "south-1", level: "标准站" },
  { id: "ST-08", name: "南站便捷站", region: "south-1", level: "便捷站" },
];

const BASE_PRICES: Record<FuelType, number> = {
  "92号汽油": 7.62,
  "95号汽油": 8.14,
  "98号汽油": 9.06,
  "0号柴油": 7.18,
};

function buildPriceBook(): PriceBook {
  const book: PriceBook = {};
  for (const station of BASE_STATIONS) {
    // 站点间微小差价，作为回落基线
    const delta = station.level === "核心站" ? 0.05 : station.level === "便捷站" ? -0.03 : 0;
    for (const fuel of FUELS) {
      book[`${station.id}:${fuel}`] = Number((BASE_PRICES[fuel] + delta).toFixed(2));
    }
  }
  return book;
}

export function priceKey(stationId: string, fuel: FuelType): string {
  return `${stationId}:${fuel}`;
}

export function createSeedState(nowMs: number): ConsoleState {
  return {
    stations: BASE_STATIONS,
    priceBook: buildPriceBook(),
    plans: [],
    batches: [],
    snapshots: [],
    adjustments: [],
    versions: [
      {
        id: "v-seed",
        kind: "常规调价",
        summary: "初始挂牌价导入",
        createdAt: new Date(nowMs - 3 * 86400000).toISOString(),
      },
    ],
    nowMs,
    schemaVersion: 1,
  };
}
