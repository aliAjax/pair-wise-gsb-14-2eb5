<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useConsoleStore } from "./store/console";
import { isWithinWindow, tagStatusOf } from "./domain/rules";
import { formatClock, toLocalInput } from "./components/labels";
import RegistryPage from "./components/RegistryPage.vue";
import ExecutionPage from "./components/ExecutionPage.vue";
import AdjustmentPage from "./components/AdjustmentPage.vue";
import VersionPage from "./components/VersionPage.vue";

const store = useConsoleStore();
const activeTab = ref("registry");
const clockDraft = ref(toLocalInput(store.nowMs));

onMounted(() => {
  // 刷新后按已持久化的模拟时钟推进窗口（到点冻结 / 满足条件自动解除回落）
  store.tick(0);
});

const metrics = computed(() => {
  const drafts = store.batches.filter((item) => item.status === "草稿").length;
  const active = store.plans.filter((plan) => plan.status !== "已解除").length;
  const frozen = store.snapshots.filter((snap) => snap.releasedAt === null).length;
  const tagPending = store.snapshots.filter(
    (snap) => snap.releasedAt === null && tagStatusOf(snap) !== "一致",
  ).length;
  const blockedOrders = store.adjustments.filter((order) => order.status === "拒单").length;
  const released = store.plans.filter((plan) => plan.status === "已解除").length;
  return { drafts, active, frozen, tagPending, blockedOrders, released };
});

const activeWindowNow = computed(() =>
  store.plans.some(
    (plan) => plan.status !== "已解除" && isWithinWindow(plan, store.nowMs),
  ),
);

function jump(hours: number) {
  store.tick(hours * 3600000);
  clockDraft.value = toLocalInput(store.nowMs);
}

function applyClock() {
  const ms = Date.parse(clockDraft.value);
  if (Number.isNaN(ms)) {
    ElMessage.warning("时间格式不正确");
    return;
  }
  store.setClock(ms);
  ElMessage.success("模拟时钟已推进，窗口状态已重新判定");
}

async function resetAll() {
  try {
    await ElMessageBox.confirm("将清空全部预案、执行、价签与版本数据，恢复初始挂牌价，是否继续？", "重置演示数据", {
      type: "warning",
    });
    store.resetAll();
    clockDraft.value = toLocalInput(store.nowMs);
    ElMessage.success("已恢复初始数据");
  } catch {
    // 用户取消
  }
}

function seedDemo() {
  store.seedDemoBatch();
  ElMessage.success("已生成一小时后生效的示例草稿批次");
}

const tabs = [
  { key: "registry", label: "预案登记" },
  { key: "execution", label: "执行台" },
  { key: "adjustment", label: "挂牌价与调价单" },
  { key: "version", label: "版本与快照" },
];
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 突发事件应急管控</p>
          <h1>突发限价预案执行台</h1>
          <p class="subtitle">
            登记区域 / 油品 / 限价上限 / 生效窗口 / 站点等级，整批判定冲突；生效即冻结挂牌价与价签快照，
            站点逐站上报执行并回传价签，价签不齐不允许关窗、调价单不生效，解除后按冻结前版本回落。
          </p>
        </div>
        <div class="clock-card">
          <p class="clock-label">模拟调度时钟</p>
          <strong class="clock-value">{{ formatClock(store.nowMs) }}</strong>
          <el-tag v-if="activeWindowNow" type="danger" effect="dark" size="small">当前有生效窗口</el-tag>
          <el-tag v-else type="info" effect="plain" size="small">无生效窗口</el-tag>
          <div class="clock-row">
            <el-input v-model="clockDraft" type="datetime-local" size="small" />
            <el-button size="small" type="primary" @click="applyClock">设定</el-button>
          </div>
          <div class="clock-row">
            <el-button size="small" @click="jump(1)">+1小时</el-button>
            <el-button size="small" @click="jump(6)">+6小时</el-button>
            <el-button size="small" @click="jump(24)">+24小时</el-button>
          </div>
          <div class="clock-row clock-tools">
            <el-button link type="primary" size="small" @click="seedDemo">生成示例批次</el-button>
            <el-button link type="danger" size="small" @click="resetAll">重置数据</el-button>
          </div>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>草稿批次（含冲突）</span>
          <strong>{{ metrics.drafts }}</strong>
        </article>
        <article class="metric">
          <span>未解除预案</span>
          <strong>{{ metrics.active }}</strong>
        </article>
        <article class="metric">
          <span>冻结中站点快照</span>
          <strong>{{ metrics.frozen }}</strong>
        </article>
        <article class="metric" :class="{ alert: metrics.tagPending > 0 }">
          <span>价签待核验</span>
          <strong>{{ metrics.tagPending }}</strong>
        </article>
        <article class="metric" :class="{ alert: metrics.blockedOrders > 0 }">
          <span>拒单调价单</span>
          <strong>{{ metrics.blockedOrders }}</strong>
        </article>
        <article class="metric">
          <span>已解除回落</span>
          <strong>{{ metrics.released }}</strong>
        </article>
      </section>

      <el-tabs v-model="activeTab" class="nav-tabs">
        <el-tab-pane v-for="tab in tabs" :key="tab.key" :label="tab.label" :name="tab.key" />
      </el-tabs>

      <section class="content">
        <RegistryPage v-if="activeTab === 'registry'" />
        <ExecutionPage v-else-if="activeTab === 'execution'" />
        <AdjustmentPage v-else-if="activeTab === 'adjustment'" />
        <VersionPage v-else />
      </section>

      <footer class="footnote">
        数据保存在浏览器 localStorage，刷新后预案、执行状态、价签、版本流水保持一致；
        判定规则（domain/rules）、存储（store/storage）与页面（components）完全分离。
      </footer>
    </div>
  </main>
</template>
