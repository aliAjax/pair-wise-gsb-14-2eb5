<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useConsoleStore } from "./store/console";
import PlanRegister from "./components/PlanRegister.vue";
import PlanList from "./components/PlanList.vue";
import ExecutionBoard from "./components/ExecutionBoard.vue";
import PriceBoard from "./components/PriceBoard.vue";

const store = useConsoleStore();
const tab = ref<"register" | "execute" | "price">("register");

onMounted(() => {
  // 刷新/重开后补偿：已进入窗口的待生效预案立即补做冻结
  const activated = store.tick();
  if (activated > 0) store.notify("success", `已自动生效 ${activated} 条进入窗口的预案，并补全冻结快照。`);
});

const draftCount = computed(() => store.batches.filter((batch) => batch.status === "草稿").length);
const draftConflicts = computed(() =>
  store.batches
    .filter((batch) => batch.status === "草稿")
    .reduce((acc, batch) => acc + batch.rows.reduce((sum, row) => sum + row.conflicts.length, 0), 0)
);
const pendingCount = computed(() => store.plans.filter((plan) => plan.status === "待生效").length);
const activeCount = computed(() => store.plans.filter((plan) => plan.status === "生效中").length);

const tagSummary = computed(() => store.globalTagSummary);
const matchRate = computed(() =>
  tagSummary.value.total === 0
    ? "—"
    : `${Math.round((tagSummary.value.matched / tagSummary.value.total) * 100)}%`
);

const tabs = [
  { key: "register", label: "预案登记" },
  { key: "execute", label: "执行与价签" },
  { key: "price", label: "挂牌价快照" }
] as const;

function onNotify(kind: "success" | "warning" | "error", text: string) {
  store.notify(kind, text);
}

function resetDemo() {
  const result = store.resetAll();
  store.notify("success", result.message);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 突发应急管控</p>
          <h1>突发限价预案执行台</h1>
          <p class="subtitle">
            登记区域、油品、限价上限、生效窗口与站点等级；同区同油品窗口不得交叠，等级不符或超限价时整批只留草稿。
            生效即冻结挂牌价与价签快照，价签未回传或与冻结价不一致时窗口不得关闭、调价单不生效，解除后按冻结版本回落。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">数据/判定/存储/页面分层</span>
          <button type="button" class="secondary small" @click="resetDemo">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>待生效 / 生效中预案</span>
          <strong>{{ pendingCount }} / {{ activeCount }}</strong>
        </article>
        <article class="metric">
          <span>草稿批次（冲突处数）</span>
          <strong :class="{ alert: draftConflicts > 0 }">{{ draftCount }}（{{ draftConflicts }}）</strong>
        </article>
        <article class="metric">
          <span>开放窗口价签一致率</span>
          <strong>{{ matchRate }}</strong>
        </article>
        <article class="metric">
          <span>未回传 / 不一致站点</span>
          <strong :class="{ alert: tagSummary.pending + tagSummary.mismatch > 0 }">
            {{ tagSummary.pending }} / {{ tagSummary.mismatch }}
          </strong>
        </article>
      </section>

      <nav class="tabs">
        <button
          v-for="item in tabs"
          :key="item.key"
          type="button"
          class="tab main-tab"
          :class="{ active: tab === item.key }"
          @click="tab = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <Transition name="fade">
        <div v-if="store.flash" class="flash" :class="store.flash.type">
          <span>{{ store.flash.text }}</span>
          <button type="button" class="flash-close" @click="store.clearFlash()">×</button>
        </div>
      </Transition>

      <section class="tab-body">
        <div v-if="tab === 'register'" class="register-layout">
          <PlanRegister @notify="onNotify" />
          <PlanList @notify="onNotify" />
        </div>
        <ExecutionBoard v-else-if="tab === 'execute'" @notify="onNotify" />
        <PriceBoard v-else @notify="onNotify" />
      </section>
    </div>
  </main>
</template>
