<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { BayDisk } from "#shared/bays";
import type { InlineValue } from "~/components/inline/InlineField.vue";

export interface BayRow {
  locationKey: string;
  label: string | null;
  defaultLabel: string;
  disk: BayDisk | null;
  status: string | null;
  fault: boolean | null;
}

const props = withDefaults(
  defineProps<{
    rows: BayRow[];
    saving: Record<string, boolean>;
    errors: Record<string, string | null>;
    withStatus?: boolean;
  }>(),
  { withStatus: true },
);

const emit = defineEmits<{ commit: [locationKey: string, value: InlineValue] }>();

const columns = computed<TableColumn<BayRow>[]>(() => [
  { id: "label", header: "Bay", meta: { class: { td: "w-56" } } },
  { id: "location", header: "Location" },
  { id: "disk", header: "Disk" },
  ...(props.withStatus ? [{ id: "status", header: "SES status" }] : []),
]);

</script>

<template>
  <UTable :data="rows" :columns="columns" :ui="{ td: 'py-1.5' }">
    <template #label-cell="{ row }">
      <InlineField
        type="text"
        compact
        :value="row.original.label"
        :aria-label="`Label for ${row.original.defaultLabel}`"
        :placeholder="row.original.defaultLabel"
        :saving="saving[row.original.locationKey]"
        :error="errors[row.original.locationKey]"
        :data-location="row.original.locationKey"
        @commit="emit('commit', row.original.locationKey, $event)"
      >
        <template #display="{ text }">
          <span v-if="text" class="truncate">{{ text }}</span>
          <span v-else class="text-dimmed truncate">—</span>
        </template>
      </InlineField>
    </template>
    <template #location-cell="{ row }">
      <span class="text-muted" :title="row.original.locationKey">{{
        row.original.defaultLabel
      }}</span>
    </template>
    <template #disk-cell="{ row }">
      <NuxtLink
        v-if="row.original.disk"
        :to="`/disks/${row.original.disk.id}`"
        class="hover:underline"
        :class="row.original.disk.present ? 'text-default' : 'text-dimmed'"
        :title="row.original.disk.present ? undefined : 'last known'"
        >{{ row.original.disk.label }}</NuxtLink
      >
      <span v-else class="text-dimmed">—</span>
    </template>
    <template #status-cell="{ row }">
      <span
        :class="row.original.fault ? 'text-error' : 'text-muted'"
        >{{ row.original.status ?? "—"
        }}<template v-if="row.original.fault"> · fault</template></span
      >
    </template>
  </UTable>
</template>
