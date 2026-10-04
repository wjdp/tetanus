<script setup lang="ts">
import { displayModel } from "#shared/model";
import { diskLabel } from "~/components/disk/displayName";
import { PURPOSE_BADGE } from "~/utils/vocabulary";
import { findColumn, INVENTORY_COLUMNS, sortDisks } from "./columns";
import { type DiskGroup, type GroupBy, groupDisks } from "./groupDisks";
import InventoryCardAttention from "./InventoryCardAttention.vue";
import InventoryCell from "./InventoryCell.vue";
import InventoryGroupBySelect from "./InventoryGroupBySelect.vue";
import InventoryGroupHeader from "./InventoryGroupHeader.vue";
import type { InventoryDisk, SortingState } from "./types";
import { useCollapsedGroups } from "./useCollapsedGroups";

const props = withDefaults(
  defineProps<{
    disks: InventoryDisk[];
    diskLabels?: ReadonlyMap<number, string>;
  }>(),
  { diskLabels: () => new Map() },
);

const emit = defineEmits<{ edit: [diskId: number] }>();

const sorting = defineModel<SortingState>("sorting", {
  default: () => [{ id: "alias", desc: false }],
});

const groupBy = defineModel<GroupBy | null>("groupBy", { default: null });

const currency = useCurrency();

const sortItems = INVENTORY_COLUMNS.map(({ id, label }) => ({
  value: id,
  label,
}));

const CARD_HEADER_COLUMNS = ["status", "state"];

const CARD_FIELD_COLUMNS = [
  "capacity",
  "media",
  "host",
  "pool",
  "temp",
  "powerOn",
];

const columnsById = (ids: string[]) =>
  ids.flatMap((id) => findColumn(id) ?? []);

const headerColumns = columnsById(CARD_HEADER_COLUMNS);
const fieldColumns = columnsById(CARD_FIELD_COLUMNS);
const usageColumn = findColumn("usage");

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

const { isCollapsed, toggle } = useCollapsedGroups(() => groupBy.value);

interface CardSection {
  key: string;
  group: DiskGroup | null;
  disks: InventoryDisk[];
}

const sections = computed<CardSection[]>(() =>
  groupBy.value
    ? groupDisks(props.disks, groupBy.value, sorting.value).map((group) => ({
        key: group.key,
        group,
        disks: group.disks,
      }))
    : [{ key: "", group: null, disks: sortDisks(props.disks, sorting.value) }],
);

const isEmpty = computed(() => props.disks.length === 0);
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
      <InventoryGroupBySelect v-model="groupBy" class="ml-auto" />
    </div>

    <p v-if="isEmpty" class="text-muted py-6 text-center text-sm">
      No disks match the filters.
    </p>

    <section
      v-for="section in isEmpty ? [] : sections"
      :key="section.key"
      class="flex flex-col gap-2"
      data-testid="inventory-card-section"
    >
      <button
        v-if="section.group"
        type="button"
        class="hover:bg-elevated/50 -mx-1 rounded-md px-1 py-1 text-left text-sm"
        :aria-expanded="!isCollapsed(section.key)"
        @click="toggle(section.key)"
      >
        <InventoryGroupHeader
          :group="section.group"
          :collapsed="isCollapsed(section.key)"
          :currency="currency"
        />
      </button>
      <ul
        v-if="!isCollapsed(section.key)"
        class="grid gap-2 md:grid-cols-2 xl:grid-cols-3"
      >
        <li v-for="disk in section.disks" :key="disk.id">
          <div
            class="bg-elevated border-default hover:border-accented relative flex h-full flex-col gap-3 rounded-md border p-3 transition-colors"
            :class="{ 'opacity-60': disk.disposal }"
            :data-disposed="disk.disposal ? true : undefined"
            data-testid="inventory-card"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 flex-col">
                <NuxtLink
                  :to="`/disks/${disk.id}`"
                  class="text-highlighted font-semibold after:absolute after:inset-0"
                >
                  {{ disk.alias ?? disk.serial ?? "—" }}
                </NuxtLink>
                <span class="text-muted truncate text-sm">{{ displayModel(disk.model, disk.vendor) ?? "—" }}</span>
                <span
                  v-if="disk.alias"
                  class="text-dimmed truncate font-mono text-xs"
                >
                  {{ disk.serial ?? "—" }}
                </span>
              </div>
              <div class="flex shrink-0 items-start gap-1">
                <div class="flex flex-col items-end gap-1 text-sm">
                  <InventoryCell
                    v-for="column in headerColumns"
                    :key="column.id"
                    :column="column"
                    :disk="disk"
                    :linked="false"
                    :disk-labels="diskLabels"
                  />
                </div>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-pencil"
                  :aria-label="`Edit ${diskLabels.get(disk.id) ?? diskLabel(disk)}`"
                  class="relative -me-1 -mt-0.5"
                  data-testid="inventory-edit"
                  @click="emit('edit', disk.id)"
                />
              </div>
            </div>

            <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <div
                v-for="column in fieldColumns"
                :key="column.id"
                class="flex min-w-0 flex-col items-start"
                :data-testid="`inventory-card-${column.id}`"
              >
                <template v-if="column.id === 'pool' && !disk.membership && usageColumn">
                  <dt class="text-dimmed text-xs">{{ usageColumn.label }}</dt>
                  <dd class="flex max-w-full min-w-0 items-center gap-1">
                    <InventoryCell :column="usageColumn" :disk="disk" :linked="false" />
                    <UBadge
                      v-if="disk.purpose"
                      v-bind="PURPOSE_BADGE[disk.purpose]"
                      class="shrink-0"
                      :class="{ italic: disk.purposeInferred }"
                      :title="disk.purposeInferred ? 'Purpose inferred from usage' : undefined"
                    />
                  </dd>
                </template>
                <template v-else>
                  <dt class="text-dimmed text-xs">{{ column.label }}</dt>
                  <dd class="max-w-full truncate">
                    <InventoryCell :column="column" :disk="disk" :linked="false" />
                  </dd>
                </template>
              </div>
            </dl>

            <InventoryCardAttention :disk="disk" />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
