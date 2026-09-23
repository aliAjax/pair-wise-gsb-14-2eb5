<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useConsoleStore } from "../store/console";
import { regionLabel, stationLabel } from "../domain/constants";
import { liveStatus, snapshotBlocked, tagStatusOf, isWithinWindow } from "../domain/rules";
import type { ExecStatus, PriceLimitPlan, PriceSnapshot } from "../domain/types";
import { EXEC_STATUS_META, PLAN_STATUS_META, TAG_STATUS_META, formatWindow } from "./labels";

const store = useConsoleStore();

const expanded = ref<Record<string, boolean>>({});

function snapshotsOf(plan: PriceLimitPlan): PriceSnapshot[] {
  return store.snapshots.filter((item) => item.planId === plan.id);
}

function statusOf(plan: PriceLimitPlan) {
  return PLAN_STATUS_META[liveStatus(plan, snapshotsOf(plan), store.nowMs)];
}

function tag(snap: PriceSnapshot) {
  return TAG_STATUS_META[tagStatusOf(snap)];
}

function execMeta(status: ExecStatus) {
  return EXEC_STATUS_META[status];
}

function blockers(plan: PriceLimitPlan): string[] {
  const blockers: string[] = [];
  if (store.nowMs < Date.parse(plan.endAt)) blockers.push("生效窗口尚未结束");
  for (const snap of snapshotsOf(plan)) {
    for (const reason of snapshotBlocked(snap)) {
      blockers.push(`${stationLabel(store.stations, snap.stationId)}：${reason}`);
    }
  }
  return blockers;
}

function release(plan: PriceLimitPlan) {
  const result = store.releasePlanManually(plan.id);
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.warning(result.message);
}

function report(snap: PriceSnapshot, status: ExecStatus) {
  store.reportExec(snap.id, status);
}

const tagDraft = ref<Record<string, number>>({});
function upload(snap: PriceSnapshot) {
  const value = tagDraft.value[snap.id];
  if (value === undefined || Number.isNaN(value)) {
    ElMessage.warning("请输入价签拍照价格");
    return;
  }
  store.uploadTag(snap.id, value);
  ElMessage.success("价签已回传");
}

const activePlans = computed(() => store.plans.filter((plan) => plan.status !== "已解除"));
const releasedPlans = computed(() => store.plans.filter((plan) => plan.status === "已解除"));
</script>

<template>
  <div class="exec-page">
    <el-alert
      type="info"
      :closable="false"
      title="窗口关闭铁律：窗口到期后，必须所有覆盖站点执行完成且回传价签与冻结价一致，窗口才能关闭、预案才能解除；解除后挂牌价按冻结前版本回落。"
      class="rule-banner"
    />

    <el-empty v-if="store.plans.length === 0" description="暂无预案：请先到「预案登记」提交批次" />

    <div v-for="plan in [...activePlans, ...releasedPlans]" :key="plan.id" class="plan-card">
      <div class="plan-head">
        <div>
          <div class="plan-title-row">
            <h3>{{ regionLabel(plan.region) }} · {{ plan.fuel }} 限价 {{ plan.capPrice.toFixed(2) }} 元/升</h3>
            <el-tag :type="statusOf(plan).type" effect="dark">{{ statusOf(plan).text }}</el-tag>
            <el-tag v-if="plan.status === '已解除'" type="success" effect="plain">已回落</el-tag>
          </div>
          <p class="plan-meta">
            {{ formatWindow(plan.startAt, plan.endAt) }} ·
            适用等级 {{ plan.levels.join("、") }} ·
            覆盖 {{ plan.stationIds.length }} 站
            <span v-if="plan.status !== '已解除' && !isWithinWindow(plan, store.nowMs)" class="freeze-note">
              （到点自动冻结挂牌价与价签快照）
            </span>
          </p>
        </div>
        <div class="plan-actions">
          <el-button size="small" @click="expanded[plan.id] = !expanded[plan.id]">
            {{ expanded[plan.id] ? "收起站点" : `展开 ${plan.stationIds.length} 个站点` }}
          </el-button>
          <el-button
            v-if="plan.status !== '已解除'"
            size="small"
            type="success"
            @click="release(plan)"
          >
            解除并回落
          </el-button>
        </div>
      </div>

      <div v-if="plan.status !== '已解除'" class="blocker-line">
        <el-tag v-if="blockers(plan).length === 0" type="success">关闭条件已满足，可解除</el-tag>
        <template v-else>
          <el-tag type="danger" effect="plain">窗口不得关闭</el-tag>
          <span v-for="(text, i) in blockers(plan)" :key="i" class="blocker-item">⚠ {{ text }}</span>
        </template>
      </div>

      <el-collapse-transition>
        <div v-show="expanded[plan.id] || snapshotsOf(plan).length === 0" class="snap-grid">
          <el-empty
            v-if="snapshotsOf(plan).length === 0"
            :image-size="50"
            description="预案尚未到生效时间，暂无冻结快照"
          />
          <div v-for="snap in snapshotsOf(plan)" :key="snap.id" class="snap-card" :class="{ released: snap.releasedAt !== null }">
            <div class="snap-title">
              <strong>{{ stationLabel(store.stations, snap.stationId) }}</strong>
              <el-tag :type="tag(snap).type" size="small">{{ tag(snap).text }}</el-tag>
            </div>
            <div class="price-line">
              <span>冻结价 <b>{{ snap.price.toFixed(2) }}</b></span>
              <span>生效前基线 <b>{{ snap.baselinePrice.toFixed(2) }}</b></span>
              <span v-if="snap.tagPrice !== null">价签回传 <b>{{ snap.tagPrice.toFixed(2) }}</b></span>
            </div>
            <div class="snap-controls" v-if="snap.releasedAt === null">
              <div class="exec-row">
                <span class="field-hint">站点执行状态</span>
                <el-radio-group :model-value="snap.execStatus" size="small" @update:model-value="(v) => report(snap, v as ExecStatus)">
                  <el-radio-button value="未上报">未上报</el-radio-button>
                  <el-radio-button value="执行中">执行中</el-radio-button>
                  <el-radio-button value="已完成">已完成</el-radio-button>
                  <el-radio-button value="异常">异常</el-radio-button>
                </el-radio-group>
                <el-tag :type="execMeta(snap.execStatus).type" size="small" effect="plain">
                  {{ execMeta(snap.execStatus).text }}
                </el-tag>
              </div>
              <div class="tag-row">
                <span class="field-hint">价签拍照回传</span>
                <el-input-number
                  :model-value="tagDraft[snap.id] ?? undefined"
                  :min="0"
                  :precision="2"
                  :step="0.05"
                  size="small"
                  controls-position="right"
                  placeholder="价签价格"
                  @update:model-value="(v) => (tagDraft[snap.id] = Number(v))"
                />
                <el-button size="small" @click="upload(snap)">回传价签</el-button>
                <span v-if="snap.tagUploadedAt" class="upload-time">
                  回传于 {{ new Date(snap.tagUploadedAt).toLocaleString("zh-CN") }}
                </span>
              </div>
            </div>
            <p v-else class="released-note">
              已于 {{ new Date(snap.releasedAt).toLocaleString("zh-CN") }} 解除，挂牌价回落至 {{ snap.baselinePrice.toFixed(2) }}
            </p>
          </div>
        </div>
      </el-collapse-transition>
    </div>
  </div>
</template>

<style scoped>
.rule-banner { margin-bottom: 14px; }
.plan-card {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 14px;
}
.plan-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.plan-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.plan-title-row h3 { margin: 0; font-size: 17px; }
.plan-meta { margin: 8px 0 0; color: #69758c; font-size: 13px; }
.freeze-note { color: #b7791f; }
.plan-actions { display: flex; gap: 8px; flex-shrink: 0; }
.blocker-line {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e3eaf3;
  font-size: 13px;
  color: #c0392b;
}
.blocker-item { color: #a33a2a; }
.snap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.snap-card {
  border: 1px solid #e3eaf3;
  border-radius: 10px;
  padding: 12px;
  background: #fbfcfe;
  display: grid;
  gap: 10px;
}
.snap-card.released { background: #f3f9f4; }
.snap-title { display: flex; justify-content: space-between; align-items: center; }
.price-line { display: flex; gap: 14px; flex-wrap: wrap; color: #536078; font-size: 13px; }
.price-line b { color: #172033; }
.field-hint { color: #69758c; font-size: 13px; }
.exec-row, .tag-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.upload-time { color: #93a0b5; font-size: 12px; }
.released-note { margin: 0; color: #14724f; font-size: 13px; }
</style>
