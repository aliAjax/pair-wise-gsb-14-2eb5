<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useConsoleStore } from "../store/console";
import { FUELS, STATION_LEVELS, regionLabel } from "../domain/constants";
import { isWithinWindow } from "../domain/rules";
import type { FuelType, PriceLimitPlan } from "../domain/types";

const store = useConsoleStore();

const form = reactive({
  stationId: "" as string,
  fuel: FUELS[0] as FuelType,
  newPrice: undefined as number | undefined,
  reason: "",
});

const filterLevel = ref<string>("全部");

interface PriceRowView {
  stationId: string;
  stationName: string;
  regionLabel: string;
  level: string;
  fuel: FuelType;
  price: number;
  plan: PriceLimitPlan | null;
  snapshotPrice: number | null;
}

const priceRows = computed<PriceRowView[]>(() => {
  const rows: PriceRowView[] = [];
  for (const station of store.stations) {
    if (filterLevel.value !== "全部" && station.level !== filterLevel.value) continue;
    for (const fuel of FUELS) {
      const key = `${station.id}:${fuel}`;
      const activeSnap = store.snapshots.find(
        (snap) =>
          snap.stationId === station.id &&
          snap.fuel === fuel &&
          snap.releasedAt === null &&
          store.plans.some(
            (plan) => plan.id === snap.planId && plan.status !== "已解除" && isWithinWindow(plan, store.nowMs),
          ),
      );
      const plan = activeSnap
        ? (store.plans.find((item) => item.id === activeSnap.planId) ?? null)
        : null;
      rows.push({
        stationId: station.id,
        stationName: station.name,
        regionLabel: regionLabel(station.region),
        level: station.level,
        fuel,
        price: store.priceBook[key] ?? 0,
        plan,
        snapshotPrice: activeSnap ? activeSnap.price : null,
      });
    }
  }
  return rows;
});

function submit() {
  if (!form.stationId) {
    ElMessage.warning("请选择站点");
    return;
  }
  if (form.newPrice === undefined) {
    ElMessage.warning("请输入新挂牌价");
    return;
  }
  const result = store.submitAdjustment({
    stationId: form.stationId,
    fuel: form.fuel,
    newPrice: form.newPrice,
    reason: form.reason,
  });
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
  form.newPrice = undefined;
  form.reason = "";
}

function pick(row: PriceRowView) {
  form.stationId = row.stationId;
  form.fuel = row.fuel;
  form.newPrice = row.price;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const orderStatusType: Record<string, "success" | "danger" | "info"> = {
  已生效: "success",
  拒单: "danger",
  待生效: "info",
};
</script>

<template>
  <div class="adj-page">
    <section class="panel form-panel">
      <h2>挂牌价调价单</h2>
      <el-alert
        type="warning"
        :closable="false"
        title="冻结期规则：调价超过限价上限，或价签未回传 / 与冻结价不一致，调价单直接拒单不生效；限价内调价生效后冻结版本同步更新，需重新回传价签。"
        class="rule-banner"
      />
      <div class="adj-form">
        <label>
          <span>站点</span>
          <el-select v-model="form.stationId" filterable placeholder="选择站点">
            <el-option
              v-for="station in store.stations"
              :key="station.id"
              :label="`${station.name}（${regionLabel(station.region)} · ${station.level}）`"
              :value="station.id"
            />
          </el-select>
        </label>
        <label>
          <span>油品</span>
          <el-select v-model="form.fuel">
            <el-option v-for="fuel in FUELS" :key="fuel" :label="fuel" :value="fuel" />
          </el-select>
        </label>
        <label>
          <span>新挂牌价（元/升）</span>
          <el-input-number v-model="form.newPrice" :min="0" :precision="2" :step="0.05" controls-position="right" />
        </label>
        <label class="reason-field">
          <span>调价原因</span>
          <el-input v-model="form.reason" placeholder="例如：批发价变动 / 限价窗口内调整" />
        </label>
      </div>
      <el-button type="primary" @click="submit">提交调价单</el-button>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>挂牌价账本 <small>（冻结中的价格带红色标记）</small></h2>
        <el-select v-model="filterLevel" size="small" style="width: 140px">
          <el-option label="全部等级" value="全部" />
          <el-option v-for="level in STATION_LEVELS" :key="level" :label="level" :value="level" />
        </el-select>
      </div>
      <el-table :data="priceRows" size="small" stripe height="340">
        <el-table-column prop="stationName" label="站点" min-width="150" />
        <el-table-column prop="regionLabel" label="区域" width="100" />
        <el-table-column prop="level" label="等级" width="80" />
        <el-table-column prop="fuel" label="油品" width="110" />
        <el-table-column label="挂牌价" width="110">
          <template #default="{ row }">
            <span :class="{ frozen: row.plan }">{{ Number(row.price).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="限价状态" min-width="220">
          <template #default="{ row }">
            <el-tag v-if="row.plan" type="danger" size="small">
              冻结 ≤ {{ row.plan.capPrice.toFixed(2) }}
            </el-tag>
            <span v-else class="muted">常规价格</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="pick(row)">调价</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <h2>调价单流水</h2>
      <el-empty v-if="store.adjustments.length === 0" :image-size="60" description="暂无调价单" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="order in store.adjustments"
          :key="order.id"
          :type="order.status === '已生效' ? 'success' : 'danger'"
          :timestamp="`${new Date(order.createdAt).toLocaleString('zh-CN')} · ${order.fuel}`"
        >
          <div class="order-line">
            <el-tag :type="orderStatusType[order.status]" size="small">{{ order.status }}</el-tag>
            <strong>
              {{ store.stations.find((s) => s.id === order.stationId)?.name ?? order.stationId }}
            </strong>
            {{ order.oldPrice.toFixed(2) }} → {{ order.newPrice.toFixed(2) }} 元/升
          </div>
          <p class="order-reason">{{ order.reason }}</p>
        </el-timeline-item>
      </el-timeline>
    </section>
  </div>
</template>

<style scoped>
.adj-page { display: grid; gap: 14px; }
.panel h2 { margin: 0 0 12px; font-size: 18px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-head h2 { margin: 0; }
.rule-banner { margin-bottom: 14px; }
.adj-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.adj-form label { display: grid; gap: 6px; color: #445069; font-size: 13px; }
.adj-form :deep(.el-select), .adj-form :deep(.el-input-number) { width: 100%; }
.frozen { color: #c0392b; font-weight: 800; }
.muted { color: #93a0b5; font-size: 13px; }
.order-line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.order-reason { margin: 4px 0 0; color: #69758c; font-size: 13px; }
</style>
