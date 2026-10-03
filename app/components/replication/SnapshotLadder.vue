<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { ReplicationLadderRow } from "#shared/replications";
import { formatTimestamp } from "../pool/timestamp";

const PAGE_SIZE = 50;

const props = defineProps<{
  ladder: ReplicationLadderRow[];
  sourceMonitored: boolean;
}>();

const shownCount = ref(PAGE_SIZE);
const shown = computed(() => props.ladder.slice(0, shownCount.value));
const remaining = computed(() => props.ladder.length - shownCount.value);

const columns = computed<TableColumn<ReplicationLadderRow>[]>(() => [
  ...(props.sourceMonitored ? [{ id: "source", header: "Source" }] : []),
  { id: "link", header: "", meta: { class: { th: "w-8" } } },
  { id: "target", header: "Target" },
  { id: "created", header: "Created" },
]);
</script>

<template>
  <div class="flex flex-col gap-2">
    <UTable
      :data="shown"
      :columns="columns"
      empty="No snapshots on either side."
      data-testid="snapshot-ladder"
    >
      <template #source-cell="{ row }">
        <span
          v-if="row.original.source"
          class="text-highlighted font-mono text-sm"
        >
          {{ row.original.source.name }}
        </span>
        <span v-else class="text-dimmed">—</span>
      </template>
      <template #link-cell="{ row }">
        <UIcon
          v-if="row.original.source && row.original.target"
          name="i-lucide-arrow-right"
          class="text-dimmed size-4"
          :title="`Same snapshot, guid ${row.original.guid}`"
          data-testid="ladder-shared"
        />
      </template>
      <template #target-cell="{ row }">
        <span
          v-if="row.original.target"
          class="text-highlighted font-mono text-sm"
        >
          {{ row.original.target.name }}
        </span>
        <span v-else class="text-dimmed">—</span>
      </template>
      <template #created-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatTimestamp(row.original.creation) }}
        </span>
      </template>
    </UTable>
    <UButton
      v-if="remaining > 0"
      color="neutral"
      variant="soft"
      size="sm"
      class="self-start"
      :label="`Show ${Math.min(remaining, PAGE_SIZE)} more of ${remaining}`"
      @click="shownCount += PAGE_SIZE"
    />
  </div>
</template>
