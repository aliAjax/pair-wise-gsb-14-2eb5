// 存储层：只负责 localStorage 的序列化、读取与种子数据兜底
import { createSeedState } from "../domain/constants";
import type { ConsoleState } from "../domain/types";

export const STORAGE_KEY = "dfwlfront-9-limit-console";

export function loadState(): ConsoleState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ConsoleState;
      if (parsed && parsed.schemaVersion === 1) return parsed;
    } catch {
      // 数据损坏时回落到种子数据
    }
  }
  return createSeedState(Date.now());
}

export function saveState(state: ConsoleState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): ConsoleState {
  const seed = createSeedState(Date.now());
  saveState(seed);
  return seed;
}
