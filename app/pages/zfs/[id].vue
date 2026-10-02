<script setup lang="ts">
import type { DropdownMenuItem, TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { formatTimestamp } from "~/components/pool/timestamp";
import { capacityColour, zfsStateColour } from "~/utils/vocabulary";

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

const toast = useToast();
const archiveOpen = ref(false);
const unarchiving = ref(false);

const unarchive = async () => {
  if (!pool.value) return;
  unarchiving.value = true;
  try {
    await $fetch(`/api/pools/${pool.value.id}/archive`, { method: "DELETE" });
    await refresh();
  } catch {
    toast.add({ title: `Could not unarchive ${pool.value.name}`, color: "error" });
  } finally {
    unarchiving.value = false;
  }
};

const menuItems = computed<DropdownMenuItem[]>(() => [
  pool.value?.archivedAt
    ? { label: "Unarchive", icon: "i-lucide-archive-restore", onSelect: unarchive }
    : {
        label: "Archive…",
        icon: "i-lucide-archive",
        onSelect: () => {
          archiveOpen.value = true;
        },
      },
]);

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
          <UBadge
            :color="zfsStateColour(pool.state)"
            variant="subtle"
            data-testid="pool-state"
          >
            {{ pool.state }}
          </UBadge>
          <span class="text-muted">
            on {{ pool.host.displayName || pool.host.name }}
          </span>
          <div class="ms-auto flex items-center gap-2">
            <SimulateFaultMenu
              subject-type="pool"
              :subject-id="pool.id"
              size="sm"
            />
            <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-ellipsis-vertical"
                aria-label="Pool actions"
                data-testid="pool-menu"
              />
            </UDropdownMenu>
          </div>
          <PoolArchiveModal
            v-model:open="archiveOpen"
            :pool-id="pool.id"
            :pool-name="pool.name"
            @archived="refresh"
          />
        </div>
        <p class="text-dimmed font-mono text-xs">{{ pool.guid }}</p>
        <div
          v-if="pool.archivedAt"
          data-testid="pool-archived-banner"
          class="bg-elevated border-default border-s-accented text-muted flex items-center gap-3 rounded-md border border-s-[3px] py-1.5 ps-4 pe-2 text-sm"
        >
          <UIcon name="i-lucide-archive" class="size-4 shrink-0" />
          <span class="flex-1">
            Archived {{ formatDate(pool.archivedAt) }}<template v-if="pool.archiveNote"> · {{ pool.archiveNote }}</template>
          </span>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-archive-restore"
            label="Unarchive"
            :loading="unarchiving"
            @click="unarchive"
          />
        </div>
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
          <UProgress
            v-if="pool.cap !== null"
            :model-value="pool.cap"
            :color="capacityColour(pool.cap)"
            size="xs"
            data-testid="pool-capacity-bar"
          />
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
