<script setup lang="ts">
import { displayModel } from "#shared/model";
import { findColumn, INVENTORY_COLUMNS, sortDisks } from "./columns";
import InventoryCell from "./InventoryCell.vue";
import type { InventoryDisk, SortingState } from "./types";

const props = defineProps<{ disks: InventoryDisk[] }>();

const sorting = defineModel<SortingState>("sorting", {
  default: () => [{ id: "alias", desc: false }],
});

const sortItems = INVENTORY_COLUMNS.map(({ id, label }) => ({
  value: id,
  label,
}));

const CARD_HEADER_COLUMNS = ["status", "state"];

const CARD_FIELD_COLUMNS = [
  "capacity",
  "host",
  "pool",
  "temp",
  "powerOn",
  "warranty",
  "media",
  "interface",
  "recording",
  "usage",
];

const columnsById = (ids: string[]) =>
  ids.flatMap((id) => findColumn(id) ?? []);

const headerColumns = columnsById(CARD_HEADER_COLUMNS);
const fieldColumns = columnsById(CARD_FIELD_COLUMNS);

const sortId = computed({
  get: () => sorting.value[0]?.id ?? "alias",
  set: (id: string) => {
    sorting.value = [{ id, desc: sorting.value[0]?.desc ?? false }];
  },
});

const descending = computed(() => sorting.value[0]?.desc ?? false);

const toggleDirection = () => {
  sorting.value = [{ id: sortId.value, desc: !descending.value }];
};

const sortedDisks = computed(() => sortDisks(props.disks, sorting.value));
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="inventory-cards">
    <div class="flex items-center gap-2">
      <span class="text-muted text-sm">Sort by</span>
      <USelect
        v-model="sortId"
        :items="sortItems"
        size="sm"
        class="w-36"
        aria-label="Sort disks by"
      />
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        :icon="descending ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
        :aria-label="descending ? 'Sort ascending' : 'Sort descending'"
        @click="toggleDirection"
      />
    </div>

    <p v-if="sortedDisks.length === 0" class="text-muted py-6 text-center text-sm">
      No disks match the filters.
    </p>

    <ul v-else class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <li v-for="disk in sortedDisks" :key="disk.id">
        <NuxtLink
          :to="`/disks/${disk.id}`"
          class="bg-elevated border-default hover:border-accented flex h-full flex-col gap-3 rounded-md border p-3 transition-colors"
          data-testid="inventory-card"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col">
              <span class="text-highlighted font-semibold">
                {{ disk.alias ?? disk.serial ?? "—" }}
              </span>
              <span class="text-muted truncate text-sm">{{ displayModel(disk.model, disk.vendor) ?? "—" }}</span>
              <span
                v-if="disk.alias"
                class="text-dimmed truncate font-mono text-xs"
              >
                {{ disk.serial ?? "—" }}
              </span>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1 text-sm">
              <InventoryCell
                v-for="column in headerColumns"
                :key="column.id"
                :column="column"
                :disk="disk"
                :linked="false"
              />
            </div>
          </div>

          <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <div
              v-for="column in fieldColumns"
              :key="column.id"
              class="flex min-w-0 flex-col items-start"
              :class="{ 'col-span-3': column.id === 'usage' }"
              :data-testid="`inventory-card-${column.id}`"
            >
              <dt class="text-dimmed text-xs">{{ column.label }}</dt>
              <dd class="max-w-full truncate">
                <InventoryCell :column="column" :disk="disk" :linked="false" />
              </dd>
            </div>
          </dl>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
