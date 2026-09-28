<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { formatTimestamp } from "~/components/pool/timestamp";

const route = useRoute();
const { data: pool, error, refresh } = await useFetch(`/api/pools/${route.params.id}`);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage,
  });
}

useSeoMeta({ title: getPageTitle(pool.value?.name ?? "Pool") });

const now = ref(Date.now());

const capacitySeries = computed(() => [
  {
    label: "Allocated",
    points: (pool.value?.readings ?? []).flatMap((reading) =>
      reading.allocBytes === null
        ? []
        : [{ at: reading.at, value: reading.allocBytes / 1e12 }],
    ),
  },
]);

const activeTab = ref("vdevs");

const {
  data: datasets,
  status: datasetsStatus,
  execute: loadDatasets,
} = useLazyFetch(`/api/pools/${route.params.id}/datasets`, {
  immediate: false,
  server: false,
});

watch(activeTab, (tab) => {
  if (tab === "datasets" && datasetsStatus.value === "idle") loadDatasets();
});

const tabs = computed<TabsItem[]>(() => [
  { label: "Vdevs", slot: "vdevs", value: "vdevs" },
  {
    label: "Datasets",
    slot: "datasets",
    value: "datasets",
    badge: pool.value?.datasetCount || undefined,
  },
  {
    label: "Events",
    slot: "events",
    value: "events",
    badge: pool.value?.events.length || undefined,
  },
  { label: "History", slot: "history", value: "history" },
  { label: "Diary", slot: "diary", value: "diary" },
]);
</script>

<template>
  <AppPanel :title="pool?.name ?? 'Pool'" class="max-w-7xl">
    <div v-if="pool" class="flex flex-col gap-6">
      <header class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
            {{ pool.name }}
          </h1>
          <UBadge :color="zfsStateColour(pool.state)" variant="subtle">
            {{ pool.state }}
          </UBadge>
          <span class="text-muted">
            on {{ pool.host.displayName || pool.host.name }}
          </span>
        </div>
        <p class="text-dimmed font-mono text-xs">{{ pool.guid }}</p>
        <div
          v-if="pool.status || pool.action"
          class="text-muted flex flex-col gap-1 text-sm whitespace-pre-line"
        >
          <p v-if="pool.status">{{ pool.status.trim() }}</p>
          <p v-if="pool.action" class="text-dimmed">{{ pool.action.trim() }}</p>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          class="border-default flex flex-col gap-3 rounded-lg border p-4"
          data-testid="capacity-panel"
        >
          <h2 class="text-highlighted font-semibold">Capacity</h2>
          <dl class="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
            <div>
              <dt class="text-muted">Size</dt>
              <dd class="text-highlighted tabular">
                {{ formatBytes(pool.sizeBytes) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Alloc</dt>
              <dd class="text-highlighted tabular">
                {{ formatBytes(pool.allocBytes) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Free</dt>
              <dd class="text-highlighted tabular">
                {{ formatBytes(pool.freeBytes) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Cap</dt>
              <dd class="text-highlighted tabular">{{ pool.cap ?? "—" }} %</dd>
            </div>
            <div>
              <dt class="text-muted">Frag</dt>
              <dd class="text-highlighted tabular">{{ pool.frag ?? "—" }} %</dd>
            </div>
            <div>
              <dt class="text-muted">Dedup</dt>
              <dd class="text-highlighted tabular">
                {{ pool.dedup === null ? "—" : `${pool.dedup.toFixed(2)}×` }}
              </dd>
            </div>
          </dl>
          <ChartsTimeSeriesChart :series="capacitySeries" unit="TB" />
        </section>

        <PoolScanPanel :scan="pool.scan" :now="now" />
      </div>

      <UTabs
        v-model="activeTab"
        :items="tabs"
        variant="link"
        class="w-full"
      >
        <template #vdevs>
          <PoolVdevTreeTable :root="pool.vdevs" />
        </template>

        <template #datasets>
          <p
            v-if="datasetsStatus === 'error'"
            class="text-error py-4 text-sm"
          >
            Could not load the datasets.
          </p>
          <DatasetTree
            v-else
            :datasets="datasets?.datasets ?? []"
            :now="now"
            :loading="datasetsStatus === 'pending'"
          />
        </template>

        <template #events>
          <p v-if="pool.events.length === 0" class="text-dimmed py-4 text-sm">
            No events recorded for this pool.
          </p>
          <ul v-else class="divide-default flex flex-col divide-y">
            <li
              v-for="event in pool.events"
              :key="event.id"
              class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm"
            >
              <span class="text-muted tabular">
                {{ formatTimestamp(event.at) }}
              </span>
              <span class="text-highlighted font-mono">{{ event.class }}</span>
              <span class="text-dimmed tabular font-mono text-xs">
                eid {{ event.eid ?? "—" }}
              </span>
              <span v-if="event.vdevGuid" class="text-dimmed font-mono text-xs">
                vdev {{ event.vdevGuid }}
              </span>
            </li>
          </ul>
        </template>

        <template #history>
          <p
            v-if="pool.historyScope === 'host'"
            class="text-muted py-2 text-sm"
          >
            Showing every pool on {{ pool.host.displayName || pool.host.name }}:
            the collected history has no pool headers to attribute lines.
          </p>
          <p v-if="pool.history.length === 0" class="text-dimmed py-4 text-sm">
            No history recorded.
          </p>
          <ul v-else class="divide-default flex flex-col divide-y">
            <li
              v-for="line in pool.history"
              :key="line.id"
              class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm"
            >
              <span class="text-muted tabular">
                {{ formatTimestamp(line.at) }}
              </span>
              <span v-if="line.internal" class="text-dimmed text-xs">
                internal
              </span>
              <span
                class="min-w-0 font-mono break-all"
                :class="line.internal ? 'text-muted' : 'text-highlighted'"
              >
                {{ line.text }}
              </span>
            </li>
          </ul>
        </template>

        <template #diary>
          <div class="py-4">
            <DiaryTimeline
              :entries="pool.diary"
              :show-subject="false"
              empty="Nothing in the diary for this pool yet."
              @changed="refresh"
            />
          </div>
        </template>
      </UTabs>
    </div>
  </AppPanel>
</template>
