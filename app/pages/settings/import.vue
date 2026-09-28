<script setup lang="ts">
import {
  COLUMN_SYNONYMS,
  type ImportTarget,
  mapColumns,
  parseTable,
} from "#shared/importers/obsidianTable";
import { INVENTORY_FIELDS } from "#shared/inventory-fields";

const TARGET_LABELS: Record<ImportTarget, string> = {
  alias: "Alias",
  model: "Model",
  serial: "Serial",
  capacity: "Capacity",
  pool: "Pool",
  status: "Status",
  ...(Object.fromEntries(
    INVENTORY_FIELDS.map((field) => [field.key, field.label]),
  ) as Record<(typeof INVENTORY_FIELDS)[number]["key"], string>),
};

const text = ref("");
const toast = useToast();

const requestImport = (dryRun: boolean) =>
  $fetch("/api/import/obsidian", {
    method: "POST",
    body: { text: text.value, dryRun },
  });

type ImportResult = Awaited<ReturnType<typeof requestImport>>;

const result = ref<ImportResult | null>(null);
const previewedText = ref<string | null>(null);
const pending = ref<"preview" | "import" | null>(null);

const table = computed(() => parseTable(text.value));
const detectedColumns = computed(() => {
  const mapping = mapColumns(table.value.headers);
  return (Object.keys(TARGET_LABELS) as ImportTarget[]).flatMap((target) => {
    const index = mapping[target];
    return index === null
      ? []
      : [{ target, label: TARGET_LABELS[target], header: table.value.headers[index] }];
  });
});

const canImport = computed(
  () =>
    result.value?.dryRun === true &&
    previewedText.value === text.value &&
    pending.value === null,
);

const errorMessage = (error: unknown) =>
  (error as { data?: { message?: string } }).data?.message ??
  "The server rejected the table";

const run = async (dryRun: boolean) => {
  pending.value = dryRun ? "preview" : "import";
  try {
    result.value = await requestImport(dryRun);
    previewedText.value = dryRun ? text.value : null;
    if (!dryRun) {
      const { matched, created, skipped } = result.value;
      toast.add({
        title: "Import complete",
        description: `${matched.length} matched, ${created.length} created, ${skipped.length} skipped`,
        color: "success",
      });
    }
  } catch (error) {
    result.value = null;
    toast.add({
      title: dryRun ? "Could not preview the import" : "Could not import",
      description: errorMessage(error),
      color: "error",
    });
  } finally {
    pending.value = null;
  }
};

const sections = computed(() => {
  if (!result.value) return [];
  const { matched, created, dryRun } = result.value;
  return [
    {
      key: "matched",
      title: dryRun ? "Will update" : "Matched",
      rows: matched,
      linkable: true,
    },
    {
      key: "created",
      title: dryRun ? "Will create" : "Created",
      rows: created,
      linkable: !dryRun,
    },
  ];
});
</script>

<template>
  <section class="flex flex-col gap-6">
    <div class="flex flex-col gap-1">
      <h2 class="text-highlighted text-lg font-semibold">Import from Obsidian</h2>
      <p class="text-muted text-sm">
        Paste a markdown table or CSV. Rows join to disks by serial, then alias;
        unmatched rows become inventory-only disks, shown as unseen until a
        collector reports them.
      </p>
    </div>

    <UFormField
      label="Table"
      name="table"
      :description="`Headers are matched by name, e.g. ${COLUMN_SYNONYMS.purchaseDate.slice(0, 2).join(', ')} or ${COLUMN_SYNONYMS.pin33Taped[0]}.`"
    >
      <UTextarea
        v-model="text"
        class="w-full"
        :ui="{ base: 'font-mono text-xs' }"
        :rows="12"
        placeholder="| Alias | Serial | Purchased | 3.3 V pin |"
        data-testid="import-text"
      />
    </UFormField>

    <div v-if="table.headers.length" class="flex flex-col gap-2">
      <h3 class="text-highlighted text-sm font-semibold">
        Detected columns
        <span class="text-muted font-normal">
          · {{ table.rows.length }} rows
        </span>
      </h3>
      <div class="flex flex-wrap gap-1" data-testid="detected-columns">
        <UBadge
          v-for="column in detectedColumns"
          :key="column.target"
          color="neutral"
          variant="subtle"
        >
          {{ column.label }} ← {{ column.header }}
        </UBadge>
        <span v-if="!detectedColumns.length" class="text-muted text-sm">
          None of the headers are recognised.
        </span>
      </div>
    </div>

    <div class="flex gap-2">
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-eye"
        label="Preview"
        :loading="pending === 'preview'"
        :disabled="!text.trim() || pending !== null"
        @click="run(true)"
      />
      <UButton
        color="primary"
        icon="i-lucide-import"
        label="Import"
        :loading="pending === 'import'"
        :disabled="!canImport"
        @click="run(false)"
      />
    </div>

    <div v-if="result" class="flex flex-col gap-6" data-testid="import-result">
      <p v-if="result.ignoredColumns.length" class="text-muted text-sm">
        Ignored columns: {{ result.ignoredColumns.join(", ") }}
      </p>

      <section
        v-for="section in sections"
        :key="section.key"
        class="flex flex-col gap-2"
      >
        <h3 class="text-highlighted text-sm font-semibold">
          {{ section.title }}
          <span class="text-muted font-normal">· {{ section.rows.length }}</span>
        </h3>
        <ul
          v-if="section.rows.length"
          class="divide-default border-default divide-y rounded-md border"
        >
          <li
            v-for="entry in section.rows"
            :key="entry.row"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span class="text-dimmed w-10 tabular-nums">#{{ entry.row }}</span>
            <NuxtLink
              v-if="section.linkable"
              :to="`/disks/${entry.diskId}`"
              class="text-highlighted font-medium hover:text-primary"
            >
              {{ entry.alias ?? `disk ${entry.diskId}` }}
            </NuxtLink>
            <span v-else class="text-highlighted font-medium">
              {{ entry.alias ?? "—" }}
            </span>
            <span class="text-dimmed font-mono text-xs">
              {{ entry.serial ?? "" }}
            </span>
            <span v-if="section.key === 'matched'" class="text-muted">
              {{ entry.changes.length ? entry.changes.join(", ") : "no changes" }}
            </span>
            <span
              v-for="warning in entry.warnings"
              :key="warning"
              class="text-warning"
            >
              {{ warning }}
            </span>
          </li>
        </ul>
        <p v-else class="text-muted text-sm">None.</p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-highlighted text-sm font-semibold">
          Skipped
          <span class="text-muted font-normal">
            · {{ result.skipped.length }}
          </span>
        </h3>
        <ul
          v-if="result.skipped.length"
          class="divide-default border-default divide-y rounded-md border"
        >
          <li
            v-for="entry in result.skipped"
            :key="entry.row"
            class="flex gap-3 px-3 py-2 text-sm"
          >
            <span class="text-dimmed w-10 tabular-nums">#{{ entry.row }}</span>
            <span class="text-muted">{{ entry.reason }}</span>
          </li>
        </ul>
        <p v-else class="text-muted text-sm">None.</p>
      </section>
    </div>
  </section>
</template>
