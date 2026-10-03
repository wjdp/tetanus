<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { filterDisks } from "~/components/inventory/filterDisks";

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

const { filters, sorting } = useInventoryQuery();

const { visibleColumns, setColumnVisible, resetColumns, isCustomised, view } =
  useInventoryPreferences();

const allDisks = computed(() => disks.value ?? []);

const visibleDisks = computed(() =>
  filterDisks(allDisks.value, filters.value),
);

const countLabel = computed(() =>
  visibleDisks.value.length === allDisks.value.length
    ? `${allDisks.value.length}`
    : `${visibleDisks.value.length} of ${allDisks.value.length}`,
);
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
        <NuxtLink to="/settings/hosts" class="text-highlighted hover:text-primary underline">
          Settings › Hosts
        </NuxtLink>
        has the install command.
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
        :visible-columns="visibleColumns"
        class="hidden md:block"
      />
      <InventoryCards
        v-model:sorting="sorting"
        :disks="visibleDisks"
        :class="{ 'md:hidden': view === 'table' }"
      />
    </template>
  </AppPanel>
</template>
