<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { FUELS, GRADES, REGIONS } from "../types";
import type { Batch, DraftRow } from "../types";
import { REFERENCE_CEILING } from "../data/catalog";
import { useConsoleStore } from "../store/console";

const store = useConsoleStore();
const emit = defineEmits<{ (event: "notify", kind: "success" | "warning" | "error", text: string): void }>();

function blankRow(): DraftRow {
  return { region: "", fuel: "", cap: 0, start: "", end: "", grades: [] };
}

const editingDraftId = ref<string | null>(null);
const formTitle = ref("登记限价预案（整批）");
const rows = reactive<DraftRow[]>([blankRow()]);

const drafts = computed<Batch[]>(() => store.batches.filter((batch) => batch.status === "草稿"));

const conflictCount = computed(() =>
  drafts.value.reduce((acc, batch) => acc + batch.rows.reduce((sum, row) => sum + row.conflicts.length, 0), 0)
);

function addRow() {
  rows.push(blankRow());
}

function removeRow(index: number) {
  if (rows.length === 1) {
    Object.assign(rows[0], blankRow());
    return;
  }
  rows.splice(index, 1);
}

function toggleGrade(row: DraftRow, grade: string) {
  const index = row.grades.indexOf(grade);
  if (index >= 0) row.grades.splice(index, 1);
  else row.grades.push(grade);
}

function submit() {
  const result = store.submitBatch([...rows], editingDraftId.value ?? undefined);
  emit("notify", result.ok ? "success" : "warning", result.message);
  if (result.ok) resetForm();
}

function saveAsDraft() {
  const result = store.submitBatch([...rows], editingDraftId.value ?? undefined, true);
  emit("notify", result.ok ? "success" : "warning", result.message);
  resetForm();
}

function resetForm() {
  rows.splice(0, rows.length, blankRow());
  editingDraftId.value = null;
  formTitle.value = "登记限价预案（整批）";
}

function editDraft(batch: Batch) {
  rows.splice(
    0,
    rows.length,
    ...batch.rows.map((row) => ({
      region: row.region,
      fuel: row.fuel,
      cap: Number(row.cap),
      start: row.start,
      end: row.end,
      grades: [...row.grades]
    }))
  );
  editingDraftId.value = batch.id;
  formTitle.value = `修改草稿批次 ${batch.code}`;
}

function removeDraft(batch: Batch) {
  const result = store.discardDraft(batch.id);
  emit("notify", result.ok ? "success" : "error", result.message);
  if (editingDraftId.value === batch.id) resetForm();
}
</script>

<template>
  <div class="register">
    <section class="panel">
      <div class="panel-head">
        <h2>{{ formTitle }}</h2>
        <p class="hint">同区同油品窗口不得交叠；等级不符或超限价时整批只留草稿并标明冲突。</p>
      </div>

      <div class="batch-table-wrap">
        <table class="batch-table">
          <thead>
            <tr>
              <th style="width: 130px">区域</th>
              <th style="width: 130px">油品</th>
              <th style="width: 120px">限价上限(元/升)</th>
              <th style="width: 190px">生效开始</th>
              <th style="width: 190px">生效结束</th>
              <th>站点等级</th>
              <th style="width: 46px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="index">
              <td>
                <select v-model="row.region">
                  <option value="">请选择</option>
                  <option v-for="region in REGIONS" :key="region" :value="region">{{ region }}</option>
                </select>
              </td>
              <td>
                <select v-model="row.fuel">
                  <option value="">请选择</option>
                  <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
                </select>
              </td>
              <td>
                <input v-model.number="row.cap" type="number" min="0" step="0.01" placeholder="≤ 参考限价" />
                <span v-if="row.fuel" class="cell-hint">参考 {{ REFERENCE_CEILING[row.fuel as keyof typeof REFERENCE_CEILING]?.toFixed(2) }}</span>
              </td>
              <td><input v-model="row.start" type="datetime-local" /></td>
              <td><input v-model="row.end" type="datetime-local" /></td>
              <td>
                <div class="grade-pick">
                  <label v-for="grade in GRADES" :key="grade" class="check">
                    <input type="checkbox" :checked="row.grades.includes(grade)" @change="toggleGrade(row, grade)" />
                    <span>{{ grade }}</span>
                  </label>
                </div>
              </td>
              <td>
                <button type="button" class="danger icon-btn" title="删除该行" @click="removeRow(index)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-actions">
        <button type="button" class="secondary" @click="addRow">+ 增加一行</button>
        <button v-if="editingDraftId" type="button" class="secondary" @click="resetForm">放弃编辑</button>
        <button type="button" class="secondary" @click="saveAsDraft">先存草稿</button>
        <button type="button" @click="submit">校验并登记整批</button>
      </div>
    </section>

    <section v-if="drafts.length" class="panel draft-panel">
      <div class="panel-head">
        <h2>草稿批次（含冲突标注）</h2>
        <span class="pill pill-warn">{{ drafts.length }} 批 / {{ conflictCount }} 处冲突</span>
      </div>
      <article v-for="batch in drafts" :key="batch.id" class="draft-card">
        <header>
          <strong>{{ batch.code }}</strong>
          <span class="muted">登记于 {{ batch.createdAt.replace("T", " ") }}</span>
          <span class="actions">
            <button type="button" class="secondary small" @click="editDraft(batch)">修改后重交</button>
            <button type="button" class="danger small" @click="removeDraft(batch)">删除草稿</button>
          </span>
        </header>
        <ul class="conflict-list">
          <li v-for="row in batch.rows" :key="row.rowId">
            <p class="row-title">
              <span>{{ row.region || "未选区域" }} / {{ row.fuel || "未选油品" }}</span>
              <span class="muted">上限 {{ Number(row.cap).toFixed(2) }} 元 · {{ row.grades.join("、") || "未选等级" }}</span>
            </p>
            <ul v-if="row.conflicts.length" class="conflicts">
              <li v-for="conflict in row.conflicts" :key="conflict.code" :class="`conflict conflict-${conflict.code}`">
                {{ conflict.message }}
              </li>
            </ul>
            <p v-else class="okline">本行无冲突（整批通过后即可登记）</p>
          </li>
        </ul>
      </article>
    </section>
  </div>
</template>
