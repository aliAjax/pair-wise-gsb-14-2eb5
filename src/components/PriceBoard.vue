<script setup lang="ts">
import { computed, reactive } from "vue";
import { FUELS } from "../types";
import type { Fuel } from "../types";
import { STATIONS } from "../data/catalog";
import { useConsoleStore } from "../store/console";

const store = useConsoleStore();
const emit = defineEmits<{ (event: "notify", kind: "success" | "warning" | "error", text: string): void }>();

const editing = reactive<Record<string, string>>({});

const rows = computed(() =>
  STATIONS.map((station) => ({
    station,
    cells: FUELS.map((fuel) => {
      const sold = station.fuels.includes(fuel);
      const view = store.effectivePrices(station.id, fuel);
      return {
        fuel,
        sold,
        price: view.price,
        frozen: view.frozen,
        key: `${station.id}__${fuel}`
      };
    })
  }))
);

function beginEdit(key: string, price: number) {
  editing[key] = price.toFixed(2);
}

function commit(key: string, fuel: Fuel) {
  const [stationId] = key.split("__");
  const value = Number(editing[key]);
  const result = store.updateBasePrice(stationId, fuel, value);
  emit("notify", result.ok ? "success" : "error", result.message);
  delete editing[key];
}
</script>

<template>
  <section class="panel price-panel">
    <div class="panel-head">
      <h2>挂牌价与价签快照</h2>
      <p class="hint">
        生效窗口内被冻结的站点-油品显示 <span class="locked">冻结价</span> 并锁定不可改；
        窗口关闭后调价单落价，解除后按冻结版本回落。所有快照随版本持久化，刷新后一致。
      </p>
    </div>

    <div class="price-grid-wrap">
      <table class="price-table">
        <thead>
          <tr>
            <th class="sticky-col">站点 / 区域 / 等级</th>
            <th v-for="fuel in FUELS" :key="fuel">{{ fuel }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.station.id">
            <td class="sticky-col station-cell">
              <strong>{{ row.station.name }}</strong>
              <span class="muted">{{ row.station.region }} · {{ row.station.grade }}</span>
            </td>
            <td v-for="cell in row.cells" :key="cell.key">
              <span v-if="!cell.sold" class="muted">—</span>
              <template v-else>
                <div v-if="cell.frozen" class="frozen-cell" :title="`版本 V${cell.frozen.versionNo} 已冻结挂牌价与价签快照`">
                  <b class="locked">{{ cell.price.toFixed(2) }}</b>
                  <span class="freeze-badge">冻结 V{{ cell.frozen.versionNo }}</span>
                </div>
                <div v-else-if="editing[cell.key] !== undefined" class="edit-cell">
                  <input v-model="editing[cell.key]" type="number" step="0.01" @keyup.enter="commit(cell.key, cell.fuel)" />
                  <button type="button" class="small" @click="commit(cell.key, cell.fuel)">保存</button>
                </div>
                <button v-else type="button" class="price-edit" @click="beginEdit(cell.key, cell.price)">
                  {{ cell.price.toFixed(2) }} ✎
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
