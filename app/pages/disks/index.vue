<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  ALL_HOSTS,
  ALL_INTERFACES,
  ALL_MEDIA,
  ALL_POOLS,
  ALL_PURPOSES,
  ALL_RECORDING,
  ALL_USAGE,
  ALL_VENDORS,
  CLEARED_FILTERS,
  type InventoryFilterState,
  NO_HOST,
  NO_INTERFACE,
  NO_MEDIA,
  NO_POOL,
  NO_PURPOSE,
  NO_RECORDING,
  NO_VENDOR,
} from "~/components/inventory/InventoryFilters.vue";
import type { SortingState } from "~/components/inventory/types";

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

const filters = ref<InventoryFilterState>({ ...CLEARED_FILTERS });

const { visibleColumns, setColumnVisible, resetColumns, isCustomised, view } =
  useInventoryPreferences();

const sorting = ref<SortingState>([{ id: "alias", desc: false }]);

const allDisks = computed(() => disks.value ?? []);

const hosts = computed(() =>
  [
    ...new Set(
      allDisks.value.flatMap((row) => (row.hostName ? [row.hostName] : [])),
    ),
  ].sort(),
);

const pools = computed(() =>
  [
    ...new Set(
      allDisks.value.flatMap((row) =>
        row.membership ? [row.membership.poolName] : [],
      ),
    ),
  ].sort(),
);

const states = computed(() =>
  [...new Set(allDisks.value.map((row) => row.state))].sort(),
);

const knownOrNull = <Value extends string>(value: Value | null) =>
  value === "unknown" ? null : value;

const matches = (
  selected: string,
  all: string,
  none: string,
  value: string | null,
) => selected === all || (selected === none ? value === null : value === selected);

const visibleDisks = computed(() => {
  const {
    host,
    pool,
    usage,
    purpose,
    media,
    interface: driveInterface,
    recording,
    vendor,
    states: wantedStates,
    search,
  } = filters.value;
  const wantedPurpose = purpose === NO_PURPOSE ? null : purpose;
  const needle = search.trim().toLowerCase();
  return allDisks.value.filter((row) => {
    if (host === NO_HOST && row.hostName !== null) return false;
    if (host !== ALL_HOSTS && host !== NO_HOST && row.hostName !== host) {
      return false;
    }
    const poolName = row.membership?.poolName ?? null;
    if (pool === NO_POOL && poolName !== null) return false;
    if (pool !== ALL_POOLS && pool !== NO_POOL && poolName !== pool) {
      return false;
    }
    if (usage !== ALL_USAGE && row.usage.kind !== usage) return false;
    if (purpose !== ALL_PURPOSES && row.purpose !== wantedPurpose) return false;
    if (!matches(media, ALL_MEDIA, NO_MEDIA, knownOrNull(row.media))) {
      return false;
    }
    if (
      !matches(
        driveInterface,
        ALL_INTERFACES,
        NO_INTERFACE,
        knownOrNull(row.interface),
      )
    ) {
      return false;
    }
    if (
      !matches(recording, ALL_RECORDING, NO_RECORDING, knownRecordingTech(row.recordingTech))
    ) {
      return false;
    }
    if (!matches(vendor, ALL_VENDORS, NO_VENDOR, row.vendor)) return false;
    if (wantedStates.length && !wantedStates.includes(row.state)) return false;
    if (!needle) return true;
    return [row.alias, row.model, row.serial].some((value) =>
      value?.toLowerCase().includes(needle),
    );
  });
});

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
          :hosts="hosts"
          :pools="pools"
          :states="states"
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
