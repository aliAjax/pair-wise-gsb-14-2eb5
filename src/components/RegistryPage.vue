<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { useConsoleStore } from "../store/console";
import { FUELS, REGIONS, STATION_LEVELS, regionLabel } from "../domain/constants";
import { resolveStations } from "../domain/rules";
import type { RegistryRow, RowConflict, StationLevel } from "../domain/types";
import { CONFLICT_LABEL } from "./labels";

const store = useConsoleStore();

const draftBatches = computed(() => store.batches.filter((item) => item.status === "草稿"));
const submittedBatches = computed(() => store.batches.filter((item) => item.status === "已提交"));

const batch = computed(() => store.activeBatch);
const validations = computed(() => store.previewValidations());
const totalConflicts = computed(() =>
  [...validations.value.values()].reduce((sum, item) => sum + item.conflicts.length, 0),
);

function stationsOfRow(row: RegistryRow) {
  return store.stations
    .filter((item) => resolveStations(row, store.stations).some((station) => station.id === item.id))
    .map((item) => item.name);
}

function conflictsOf(rowId: string): RowConflict[] {
  return batch.value?.rows.find((item) => item.id === rowId)?.conflicts ?? [];
}

function createBatch() {
  const id = store.createBatch(`限价预案批次 ${store.batches.length + 1}`);
  store.openBatch(id);
}

function submitBatch() {
  const result = store.submitBatch();
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
}

function toggleLevel(row: RegistryRow, level: StationLevel) {
  const next = row.levels.includes(level)
    ? row.levels.filter((item) => item !== level)
    : [...row.levels, level];
  store.updateRow(row.id, { levels: next, stationIds: [] });
}

function toggleStation(row: RegistryRow, stationId: string) {
  const next = row.stationIds.includes(stationId)
    ? row.stationIds.filter((item) => item !== stationId)
    : [...row.stationIds, stationId];
  store.updateRow(row.id, { stationIds: next });
}

const LEVEL_HINT: Record<StationLevel, string> = {
  核心站: "核心商圈站",
  标准站: "城区标准站",
  便捷站: "社区/高速便捷站",
};
</script>

<template>
  <div class="page-grid">
    <section class="panel">
      <div class="panel-head">
        <h2>预案批次</h2>
        <el-button type="primary" size="small" @click="createBatch">新建登记批次</el-button>
      </div>

      <div v-if="batch" class="editor">
        <el-input
          :model-value="batch.title"
          placeholder="批次名称，如：国庆假期临时限价"
          @change="(value) => store.updateBatchTitle(String(value))"
        />
        <el-alert
          class="rule-hint"
          type="info"
          :closable="false"
          title="整批提交判定：同区同油品窗口不得交叠；任一行等级不符、超过限价或窗口交叠，整批只保留草稿并逐行标明冲突。"
        />

        <div v-for="(row, index) in batch.rows" :key="row.id" class="row-card" :class="{ blocked: conflictsOf(row.id).length > 0 }">
          <div class="row-card-head">
            <strong>预案行 {{ index + 1 }}</strong>
            <el-button link type="danger" size="small" @click="store.removeRow(row.id)">删除</el-button>
          </div>

          <div class="row-fields">
            <label>
              <span>区域</span>
              <el-select :model-value="row.region" placeholder="选择区域" @update:model-value="(v) => store.updateRow(row.id, { region: v, stationIds: [] })">
                <el-option v-for="item in REGIONS" :key="item.code" :label="item.label" :value="item.code" />
              </el-select>
            </label>
            <label>
              <span>油品</span>
              <el-select :model-value="row.fuel" placeholder="选择油品" @update:model-value="(v) => store.updateRow(row.id, { fuel: v })">
                <el-option v-for="fuel in FUELS" :key="fuel" :label="fuel" :value="fuel" />
              </el-select>
            </label>
            <label>
              <span>限价上限（元/升）</span>
              <el-input-number
                :model-value="row.capPrice ?? undefined"
                :min="0"
                :precision="2"
                :step="0.05"
                controls-position="right"
                @update:model-value="(v) => store.updateRow(row.id, { capPrice: v ?? null })"
              />
            </label>
            <label>
              <span>生效开始</span>
              <el-input
                type="datetime-local"
                :model-value="row.startAt"
                @update:model-value="(v: string) => store.updateRow(row.id, { startAt: v })"
              />
            </label>
            <label>
              <span>生效结束</span>
              <el-input
                type="datetime-local"
                :model-value="row.endAt"
                @update:model-value="(v: string) => store.updateRow(row.id, { endAt: v })"
              />
            </label>
          </div>

          <div class="level-box">
            <span class="field-hint">站点等级</span>
            <el-checkbox
              v-for="level in STATION_LEVELS"
              :key="level"
              :model-value="row.levels.includes(level)"
              @change="toggleLevel(row, level)"
            >
              {{ level }}<em class="level-hint">{{ LEVEL_HINT[level] }}</em>
            </el-checkbox>
          </div>

          <div v-if="row.region && store.stations.some((s) => s.region === row.region)" class="station-box">
            <span class="field-hint">
              适用站点（不勾选则按区域+等级全量覆盖，共 {{ stationsOfRow(row).length }} 站）
            </span>
            <div class="station-chips">
              <el-check-tag
                v-for="station in store.stations.filter((s) => s.region === row.region)"
                :key="station.id"
                :checked="row.stationIds.includes(station.id)"
                :class="{ 'level-mismatch': row.levels.length > 0 && !row.levels.includes(station.level) }"
                @change="toggleStation(row, station.id)"
              >
                {{ station.name }} · {{ station.level }}
              </el-check-tag>
            </div>
          </div>

          <div v-if="conflictsOf(row.id).length > 0" class="conflict-box">
            <el-tag v-for="conflict in conflictsOf(row.id)" :key="conflict" type="danger" effect="dark" class="conflict-tag">
              {{ CONFLICT_LABEL[conflict] }}
            </el-tag>
          </div>
        </div>

        <div class="editor-actions">
          <el-button @click="store.addRow">追加预案行</el-button>
          <el-button :type="totalConflicts > 0 ? 'warning' : 'primary'" @click="submitBatch">
            整批提交（实时冲突 {{ totalConflicts }} 处）
          </el-button>
          <el-button @click="store.closeBatchEditor()">收起</el-button>
        </div>
      </div>

      <template v-else>
        <div class="batch-section">
          <p class="section-label">草稿批次（冲突未消除，不可生效）</p>
          <el-empty v-if="draftBatches.length === 0" description="暂无草稿" :image-size="60" />
          <div v-for="item in draftBatches" :key="item.id" class="batch-item">
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.rows.length }} 行 · {{ new Date(item.updatedAt).toLocaleString("zh-CN") }}</p>
              <el-tag size="small" type="warning">草稿</el-tag>
            </div>
            <div class="batch-btns">
              <el-button size="small" @click="store.openBatch(item.id)">继续编辑</el-button>
              <el-button size="small" type="danger" plain @click="store.removeBatch(item.id)">删除</el-button>
            </div>
          </div>
        </div>

        <div class="batch-section">
          <p class="section-label">已提交批次</p>
          <el-empty v-if="submittedBatches.length === 0" description="暂无已提交批次" :image-size="60" />
          <div v-for="item in submittedBatches" :key="item.id" class="batch-item">
            <div>
              <strong>{{ item.title }}</strong>
              <p>
                {{ item.rows.length }} 行 ·
                <span v-for="(row, i) in item.rows" :key="row.id">
                  {{ i > 0 ? "、" : "" }}{{ regionLabel(row.region) }} {{ row.fuel }}≤{{ row.capPrice?.toFixed(2) }}
                </span>
              </p>
              <el-tag size="small" type="success">已生成预案</el-tag>
            </div>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.page-grid { display: grid; gap: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.panel-head h2 { margin: 0; }
.rule-hint { margin: 10px 0; }
.editor { display: grid; gap: 12px; }
.row-card {
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px;
  display: grid;
  gap: 12px;
  background: #fbfcfe;
}
.row-card.blocked { border-color: #f0b7ae; background: #fff7f6; }
.row-card-head { display: flex; justify-content: space-between; align-items: center; }
.row-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.row-fields label { display: grid; gap: 6px; color: #445069; font-size: 13px; }
.row-fields :deep(.el-select), .row-fields :deep(.el-input-number) { width: 100%; }
.level-box { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.field-hint { color: #69758c; font-size: 13px; display: block; margin-bottom: 6px; }
.level-hint { color: #93a0b5; font-style: normal; font-size: 12px; margin-left: 4px; }
.station-box { border-top: 1px dashed #d9e2ee; padding-top: 10px; }
.station-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.station-chips :deep(.level-mismatch) { text-decoration: line-through; opacity: 0.75; }
.conflict-box { display: flex; flex-wrap: wrap; gap: 6px; }
.editor-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.batch-section + .batch-section { margin-top: 18px; border-top: 1px solid #eef2f7; padding-top: 14px; }
.section-label { margin: 0 0 10px; font-weight: 700; color: #445069; }
.batch-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border: 1px solid #e3eaf3;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: #fbfcfe;
}
.batch-item p { margin: 4px 0; color: #69758c; font-size: 13px; }
.batch-btns { display: flex; gap: 8px; flex-shrink: 0; }
</style>
