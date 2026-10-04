<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { diskLabel } from "~/components/disk/displayName";
import type { DiskDetail } from "~/components/disk/types";
import { sortDisks } from "~/components/inventory/columns";
import {
  disksInScope,
  filterDisks,
} from "~/components/inventory/filterDisks";
import { groupDisks } from "~/components/inventory/groupDisks";

useSeoMeta({ title: getPageTitle("Disks") });

const POLL_MS = 60_000;

const { data: disks, refresh } = await useFetch("/api/disks");

let pollHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  pollHandle = setInterval(refresh, POLL_MS);
});
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const { filters, sorting, groupBy } = useInventoryQuery();

const { visibleColumns, setColumnVisible, resetColumns, isCustomised, view } =
  useInventoryPreferences();

const allDisks = computed(() => disks.value ?? []);

const visibleDisks = computed(() =>
  filterDisks(allDisks.value, filters.value),
);

const scopedCount = computed(
  () => disksInScope(allDisks.value, filters.value).length,
);

const countLabel = computed(() =>
  visibleDisks.value.length === scopedCount.value
    ? `${scopedCount.value}`
    : `${visibleDisks.value.length} of ${scopedCount.value}`,
);

const diskLabels = computed(
  () =>
    new Map(
      allDisks.value.map((disk) => [disk.id, diskLabel(disk)]),
    ),
);

const shownOrder = computed(() => {
  const ordered = groupBy.value
    ? groupDisks(visibleDisks.value, groupBy.value, sorting.value).flatMap(
        (group) => group.disks,
      )
    : sortDisks(visibleDisks.value, sorting.value);
  return ordered.map(({ id }) => id);
});

const editingId = ref<number | null>(null);
const editOrder = ref<number[]>([]);

const openEditor = (diskId: number) => {
  editOrder.value = shownOrder.value;
  editingId.value = diskId;
};

const replaceDisk = (updated: DiskDetail) => {
  if (!disks.value) return;
  disks.value = disks.value.map((candidate) =>
    candidate.id === updated.id ? updated : candidate,
  );
};
</script>

<template>
  <AppPanel title="Disks" class="flex flex-col gap-6">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Disks
      <span class="text-muted font-normal tabular-nums" data-testid="disk-count">
        · {{ countLabel }}
      </span>
    </h1>

    <div
      v-if="allDisks.length === 0"
      class="border-default flex flex-col items-start gap-2 rounded-md border border-dashed p-6"
    >
      <p class="text-highlighted font-medium">No disks yet.</p>
      <p class="text-muted text-sm">
        Disks appear once a collector reports.
        <NuxtLink to="/hosts/add" class="text-highlighted hover:text-primary underline">
          Add a host
        </NuxtLink>
        to install one.
      </p>
    </div>

    <template v-else>
      <div class="flex items-start gap-2">
        <InventoryFilters
          v-model="filters"
          :disks="allDisks"
          class="min-w-0 flex-1"
        />
        <div class="hidden shrink-0 items-center gap-2 md:flex">
          <InventoryGroupBySelect v-if="view === 'table'" v-model="groupBy" />
          <InventoryColumnPicker
            v-if="view === 'table'"
            :visible-columns="visibleColumns"
            :customised="isCustomised"
            @toggle="setColumnVisible"
            @reset="resetColumns"
          />
          <UFieldGroup>
            <UButton
              color="neutral"
              :variant="view === 'table' ? 'subtle' : 'outline'"
              icon="i-lucide-table-2"
              aria-label="Table view"
              :aria-pressed="view === 'table'"
              data-testid="view-table"
              @click="view = 'table'"
            />
            <UButton
              color="neutral"
              :variant="view === 'cards' ? 'subtle' : 'outline'"
              icon="i-lucide-layout-grid"
              aria-label="Card view"
              :aria-pressed="view === 'cards'"
              data-testid="view-cards"
              @click="view = 'cards'"
            />
          </UFieldGroup>
        </div>
      </div>
      <InventoryTable
        v-if="view === 'table'"
        v-model:sorting="sorting"
        :disks="visibleDisks"
        :group-by="groupBy"
        :visible-columns="visibleColumns"
        :disk-labels="diskLabels"
        class="hidden md:block"
        @edit="openEditor"
      />
      <InventoryCards
        v-model:sorting="sorting"
        v-model:group-by="groupBy"
        :disks="visibleDisks"
        :disk-labels="diskLabels"
        :class="{ 'md:hidden': view === 'table' }"
        @edit="openEditor"
      />
      <DiskEditDrawer
        v-model:disk-id="editingId"
        :order="editOrder"
        :disks="allDisks"
        @updated="replaceDisk"
      />
    </template>
  </AppPanel>
</template>
