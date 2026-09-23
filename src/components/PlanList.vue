<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useConsoleStore } from "../store/console";
import { windowPhase } from "../domain/rules";
import type { Plan } from "../types";

const store = useConsoleStore();
const emit = defineEmits<{ (event: "notify", kind: "success" | "warning" | "error", text: string): void }>();

const filter = ref<"全部" | "待生效" | "生效中" | "已关闭" | "已解除">("全部");
const now = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => clearInterval(timer));

const filtered = computed(() => {
  const sorted = [...store.plans].sort((a, b) => (a.start < b.start ? 1 : -1));
  return filter.value === "全部" ? sorted : sorted.filter((plan) => plan.status === filter.value);
});

function phaseLabel(plan: Plan): string {
  const phase = windowPhase(plan, now.value);
  if (plan.status === "已关闭") return "窗口已关闭";
  if (plan.status === "已解除") return "已解除回落";
  if (plan.status === "待生效") {
    if (phase === "active") return "已进入窗口，可立即生效";
    if (phase === "after") return "窗口已过（需人工处理）";
    return "尚未进入生效窗口";
  }
  if (plan.status === "生效中") return phase === "active" ? "限价执行中" : "窗口已到期待关闭";
  return "";
}

function canActivate(plan: Plan): boolean {
  return plan.status === "待生效" && windowPhase(plan, now.value) === "active";
}

function activate(plan: Plan) {
  const result = store.activatePlan(plan);
  emit("notify", result.ok ? "success" : "error", result.message);
}

function revoke(plan: Plan) {
  const result = store.revokePlan(plan.id);
  emit("notify", result.ok ? "success" : "warning", result.message);
}

function statusClass(status: Plan["status"]): string {
  return `plan-status status-${status}`;
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>限价预案</h2>
      <div class="filter-tabs">
        <button
          v-for="item in ['全部', '待生效', '生效中', '已关闭', '已解除']"
          :key="item"
          type="button"
          class="tab"
          :class="{ active: filter === item }"
          @click="filter = item as typeof filter"
        >
          {{ item }}
        </button>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="empty">暂无预案</div>
    <article v-for="plan in filtered" :key="plan.id" class="plan-card">
      <div class="plan-main">
        <div class="plan-title-line">
          <strong>{{ plan.region }} · {{ plan.fuel }}</strong>
          <span :class="statusClass(plan.status)">{{ plan.status }}</span>
        </div>
        <div class="plan-meta">
          <span>限价上限 <b>{{ plan.cap.toFixed(2) }} 元/升</b></span>
          <span>站点等级：{{ plan.grades.join("、") }}</span>
          <span>窗口：{{ plan.start.replace("T", " ") }} — {{ plan.end.replace("T", " ") }}</span>
          <span>批次：{{ plan.batchCode }}</span>
        </div>
        <p class="phase" :class="{ ready: canActivate(plan) }">{{ phaseLabel(plan) }}</p>
      </div>
      <div class="plan-side">
        <button type="button" :disabled="!canActivate(plan)" @click="activate(plan)">立即生效并冻结</button>
        <button type="button" class="secondary" :disabled="plan.status !== '待生效'" @click="revoke(plan)">撤销</button>
      </div>
    </article>
  </section>
</template>
