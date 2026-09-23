<script setup lang="ts">
import { computed, ref } from "vue";
import { useConsoleStore } from "../store/console";
import { regionLabel, stationLabel } from "../domain/constants";
import { tagStatusOf } from "../domain/rules";
import { TAG_STATUS_META, formatWindow } from "./labels";
import type { VersionKind } from "../domain/types";

const store = useConsoleStore();
const kindFilter = ref<VersionKind | "全部">("全部");

const KIND_OPTIONS: (VersionKind | "全部")[] = [
  "全部",
  "常规调价",
  "预案登记",
  "预案冻结",
  "限价内调价",
  "解除回落",
];

const versions = computed(() =>
  kindFilter.value === "全部"
    ? store.versions
    : store.versions.filter((item) => item.kind === kindFilter.value),
);

const kindType: Record<VersionKind, "primary" | "success" | "warning" | "danger" | "info"> = {
  常规调价: "primary",
  预案登记: "warning",
  预案冻结: "danger",
  限价内调价: "primary",
  解除回落: "success",
};

const allSnapshots = computed(() =>
  [...store.snapshots].sort((a, b) => b.frozenAt.localeCompare(a.frozenAt)),
);

function planOf(planId: string) {
  return store.plans.find((item) => item.id === planId);
}
</script>

<template>
  <div class="version-page">
    <section class="panel">
      <div class="panel-head">
        <h2>价格版本流水（只增不改）</h2>
        <el-select v-model="kindFilter" size="small" style="width: 160px">
          <el-option v-for="kind in KIND_OPTIONS" :key="kind" :label="kind" :value="kind" />
        </el-select>
      </div>
      <el-empty v-if="versions.length === 0" :image-size="60" description="暂无版本记录" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="item in versions"
          :key="item.id"
          :type="kindType[item.kind] === 'primary' ? 'primary' : kindType[item.kind]"
          :timestamp="new Date(item.createdAt).toLocaleString('zh-CN')"
        >
          <div class="version-line">
            <el-tag :type="kindType[item.kind]" size="small">{{ item.kind }}</el-tag>
            <span>{{ item.summary }}</span>
            <b v-if="item.price !== undefined" class="version-price">{{ item.price.toFixed(2) }} 元/升</b>
          </div>
        </el-timeline-item>
      </el-timeline>
    </section>

    <section class="panel">
      <h2>挂牌价与价签冻结快照归档</h2>
      <el-empty v-if="allSnapshots.length === 0" :image-size="60" description="预案生效后才会生成快照" />
      <el-table v-else :data="allSnapshots" size="small" stripe>
        <el-table-column label="预案" min-width="200">
          <template #default="{ row }">
            <template v-if="planOf(row.planId)">
              {{ regionLabel(planOf(row.planId).region) }} · {{ planOf(row.planId).fuel }}
              <p class="muted">{{ formatWindow(planOf(row.planId).startAt, planOf(row.planId).endAt) }}</p>
            </template>
            <span v-else>{{ row.planId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="站点" min-width="150">
          <template #default="{ row }">{{ stationLabel(store.stations, row.stationId) }}</template>
        </el-table-column>
        <el-table-column label="冻结价" width="90">
          <template #default="{ row }">{{ row.price.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="基线版本" width="90">
          <template #default="{ row }">{{ row.baselinePrice.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="回传价签" width="90">
          <template #default="{ row }">{{ row.tagPrice !== null ? row.tagPrice.toFixed(2) : "—" }}</template>
        </el-table-column>
        <el-table-column label="价签核对" width="110">
          <template #default="{ row }">
            <el-tag :type="TAG_STATUS_META[tagStatusOf(row)].type" size="small">
              {{ TAG_STATUS_META[tagStatusOf(row)].text }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="冻结时间" width="160">
          <template #default="{ row }">{{ new Date(row.frozenAt).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.releasedAt" type="success" size="small">已回落</el-tag>
            <el-tag v-else type="danger" size="small" effect="plain">冻结中</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.version-page { display: grid; gap: 14px; }
.panel h2 { margin: 0 0 12px; font-size: 18px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-head h2 { margin: 0; }
.version-line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.version-price { color: #176b87; }
.muted { margin: 2px 0 0; color: #93a0b5; font-size: 12px; }
</style>
