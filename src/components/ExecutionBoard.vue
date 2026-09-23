<script setup lang="ts">
import { computed, reactive } from "vue";
import { useConsoleStore } from "../store/console";
import { canCloseWindow, summarizeTags, windowPhase } from "../domain/rules";
import { EXEC_STATUSES } from "../types";
import type { ExecStatus, FreezeVersion } from "../types";

const store = useConsoleStore();
const emit = defineEmits<{ (event: "notify", kind: "success" | "warning" | "error", text: string): void }>();

// 每个版本展开/折叠、价签输入缓存都属于页面态，不进存储
const expanded = reactive<Record<string, boolean>>({});
const tagInputs = reactive<Record<string, string>>({});

const orderedVersions = computed(() =>
  [...store.versions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
);

function summary(version: FreezeVersion) {
  return summarizeTags(version.items);
}

function guard(version: FreezeVersion) {
  return canCloseWindow(version);
}

function toggle(version: FreezeVersion) {
  expanded[version.id] = !expanded[version.id];
  if (expanded[version.id]) {
    for (const item of version.items) {
      if (tagInputs[item.id] === undefined) {
        tagInputs[item.id] = item.tagPrice === null ? "" : String(item.tagPrice);
      }
    }
  }
}

function reportExec(version: FreezeVersion, itemId: string, status: ExecStatus) {
  const result = store.reportExec(version.id, itemId, status);
  emit("notify", result.ok ? "success" : "warning", result.message);
}

function submitTag(version: FreezeVersion, itemId: string) {
  const raw = tagInputs[itemId];
  const price = raw === "" || raw === undefined ? null : Number(raw);
  const result = store.reportTag(version.id, itemId, price);
  emit("notify", result.ok ? "success" : "error", result.message);
}

function closeWindow(version: FreezeVersion) {
  const result = store.closeWindow(version.id);
  emit("notify", result.ok ? "success" : "error", result.message);
}

function release(version: FreezeVersion) {
  const result = store.releasePlan(version.id);
  emit("notify", result.ok ? "success" : "warning", result.message);
}

function versionBadge(version: FreezeVersion): { text: string; cls: string } {
  if (version.releasedAt) return { text: "已解除 · 价格已回落", cls: "badge-released" };
  if (version.closedAt) return { text: "窗口已关闭 · 调价单已生效", cls: "badge-closed" };
  const phase = windowPhase(version);
  if (phase === "active") return { text: "冻结执行中 · 调价单待生效", cls: "badge-active" };
  if (phase === "before") return { text: "版本已建 · 未到窗口", cls: "badge-wait" };
  return { text: "窗口到期 · 价签核验未通过，无法关闭", cls: "badge-blocked" };
}

function inputDisabled(version: FreezeVersion): boolean {
  return version.closedAt !== null;
}
</script>

<template>
  <div class="execution">
    <article v-for="version in orderedVersions" :key="version.id" class="version-card">
      <header class="version-head" @click="toggle(version)">
        <div class="version-id">
          <strong>V{{ version.versionNo }}</strong>
          <span class="badge" :class="versionBadge(version).cls">{{ versionBadge(version).text }}</span>
        </div>
        <div class="version-info">
          <span>{{ version.region }} · {{ version.fuel }}</span>
          <span class="muted">{{ version.start.replace("T", " ") }} — {{ version.end.replace("T", " ") }}</span>
          <span class="muted">批次 {{ version.batchCode }}</span>
        </div>
        <div class="version-stat">
          <span>价签 {{ summary(version).matched }}/{{ summary(version).total }} 一致</span>
          <span v-if="summary(version).mismatch" class="stat-bad">不一致 {{ summary(version).mismatch }}</span>
          <span v-if="summary(version).pending" class="stat-warn">未回传 {{ summary(version).pending }}</span>
          <span class="caret">{{ expanded[version.id] ? "收起 ▲" : "展开 ▼" }}</span>
        </div>
      </header>

      <div v-if="expanded[version.id]" class="version-body">
        <div class="gate" :class="{ blocked: !guard(version).ok && !version.closedAt && !version.releasedAt, pass: version.closedAt }">
          <template v-if="version.releasedAt">
            ✅ 已解除：全部站点按冻结版本回落至生效前挂牌价（{{ version.releasedAt.replace("T", " ") }}）。
          </template>
          <template v-else-if="version.closedAt">
            ✅ 闸门通过：全部价签与冻结价一致，窗口于 {{ version.closedAt.replace("T", " ") }} 关闭，调价单已生效。
          </template>
          <template v-else>
            <span>⛔ 关闭闸门：{{ guard(version).ok ? "全部站点价签一致，可以关闭窗口" : guard(version).reason }}</span>
          </template>
        </div>

        <table class="station-table">
          <thead>
            <tr>
              <th>站点</th>
              <th>等级</th>
              <th>生效前挂牌价</th>
              <th>冻结挂牌价</th>
              <th>执行状态上报</th>
              <th>价签回传（元/升）</th>
              <th>核验</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in version.items" :key="item.id" :class="{ 'row-mismatch': item.tagResult === 'mismatch' }">
              <td>{{ item.stationName }}</td>
              <td>{{ item.grade }}</td>
              <td class="muted">{{ item.beforePrice.toFixed(2) }}</td>
              <td><b class="locked">{{ item.lockedPrice.toFixed(2) }}</b></td>
              <td>
                <select
                  :value="item.execStatus"
                  :disabled="inputDisabled(version)"
                  @change="reportExec(version, item.id, ($event.target as HTMLSelectElement).value as ExecStatus)"
                >
                  <option v-for="status in EXEC_STATUSES" :key="status" :value="status">{{ status }}</option>
                </select>
              </td>
              <td>
                <div class="tag-input">
                  <input
                    v-model="tagInputs[item.id]"
                    type="number"
                    step="0.01"
                    :placeholder="`冻结价 ${item.lockedPrice.toFixed(2)}`"
                    :disabled="inputDisabled(version)"
                  />
                  <button type="button" class="small" :disabled="inputDisabled(version)" @click="submitTag(version, item.id)">
                    回传
                  </button>
                </div>
                <span v-if="item.tagReportedAt" class="cell-hint">回传于 {{ item.tagReportedAt.replace("T", " ") }}</span>
              </td>
              <td>
                <span v-if="item.tagResult === 'matched'" class="tag-ok">一致</span>
                <span v-else-if="item.tagResult === 'mismatch'" class="tag-bad">
                  不一致（{{ item.tagPrice?.toFixed(2) }}）
                </span>
                <span v-else class="tag-pending">未回传</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="version-actions">
          <button
            type="button"
            :disabled="version.closedAt !== null || !guard(version).ok"
            @click="closeWindow(version)"
          >
            关闭窗口并使调价单生效
          </button>
          <button
            type="button"
            class="secondary"
            :disabled="version.closedAt === null || version.releasedAt !== null"
            @click="release(version)"
          >
            解除并按冻结版本回落
          </button>
        </div>
      </div>
    </article>

    <div v-if="orderedVersions.length === 0" class="empty">暂无冻结版本，待生效预案进入窗口后在此执行。</div>
  </div>
</template>
