<script setup lang="ts">
import type { DropdownMenuItem, TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { capacitySeries } from "~/components/pool/capacityChart";
import { formatTimestamp } from "~/components/pool/timestamp";
import { capacityColour } from "~/utils/vocabulary";

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

const { system, formatZfsBytes } = useZfsByteSystem();

const usablePercent = computed(() => {
  const usable = pool.value?.usable;
  if (!usable) return null;
  const total = usable.used + usable.available;
  return total > 0 ? Math.round((usable.used / total) * 100) : null;
});

const capacityChart = computed(() =>
  capacitySeries(pool.value?.readings ?? [], system.value),
);

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
  const needsDatasets = tab === "datasets" || tab === "space";
  if (needsDatasets && datasetsStatus.value === "idle") loadDatasets();
});

const tabs = computed<TabsItem[]>(() => [
  { label: "Vdevs", slot: "vdevs", value: "vdevs" },
  {
    label: "Datasets",
    slot: "datasets",
    value: "datasets",
    badge: pool.value?.datasetCount || undefined,
  },
  { label: "Space", slot: "space", value: "space" },
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
          <PoolStateBadge :pool="pool" />
          <span class="text-muted">
            on {{ pool.host.displayName || pool.host.name }}
          </span>
          <span
            v-if="pool.errors !== null"
            class="tabular text-sm"
            :class="pool.errors > 0 ? 'text-error' : 'text-muted'"
            data-testid="pool-data-errors"
          >
            Data errors {{ pool.errors }}
          </span>
          <div class="ms-auto flex items-center gap-2">
            <ZfsByteUnitToggle />
            <PoolConfigPopover
              :pool-id="pool.id"
              :config="pool.config"
              @saved="refresh"
            />
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
          v-if="pool.status || pool.action || pool.msgid"
          class="text-muted flex flex-col gap-1 text-sm whitespace-pre-line"
        >
          <p v-if="pool.status || pool.msgid">
            <template v-if="pool.status">{{ pool.status.trim() }}</template>
            <ULink
              v-if="pool.msgid"
              :to="pool.moreinfo ?? undefined"
              target="_blank"
              class="ms-2 font-mono text-xs whitespace-nowrap"
              data-testid="pool-msgid"
            >
              {{ pool.msgid }}
            </ULink>
          </p>
          <p v-if="pool.action" class="text-dimmed">{{ pool.action.trim() }}</p>
        </div>
        <PoolDamagedFiles
          v-if="pool.errors && (pool.damagedFiles?.length || pool.damagedFilesError)"
          :errors="pool.errors"
          :files="pool.damagedFiles"
          :list-error="pool.damagedFilesError"
        />
      </header>

      <PoolFaults :pool-id="pool.id" :now="now" />

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          class="border-default flex flex-col gap-3 rounded-lg border p-4"
          data-testid="capacity-panel"
        >
          <h2 class="text-highlighted font-semibold">Capacity</h2>
          <dl
            v-if="pool.usable"
            class="grid grid-cols-3 gap-2 sm:grid-cols-6"
            data-testid="usable-space"
          >
            <div>
              <dt class="text-muted text-sm">Used</dt>
              <dd class="text-highlighted tabular text-lg font-semibold">
                {{ formatZfsBytes(pool.usable.used) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted flex h-5 items-center gap-1 text-sm">
                Available
                <PoolAvailableNote
                  :vdevs="pool.vdevs"
                  :free-bytes="pool.freeBytes"
                />
              </dt>
              <dd class="text-highlighted tabular text-lg font-semibold">
                {{ formatZfsBytes(pool.usable.available) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted text-sm">Used %</dt>
              <dd class="text-highlighted tabular text-lg font-semibold">
                {{ usablePercent ?? "—" }} %
              </dd>
            </div>
          </dl>
          <p v-else class="text-muted text-sm" data-testid="usable-missing">
            No recent <span class="font-mono">zfs list</span> for this pool, so
            usable space is unknown; raw figures include parity.
          </p>
          <div class="flex flex-col gap-1" data-testid="raw-space">
            <h3 class="text-muted text-xs">Raw, incl. parity</h3>
            <dl class="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
              <div>
                <dt class="text-muted">Size</dt>
                <dd class="text-toned tabular">
                  {{ formatZfsBytes(pool.sizeBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Alloc</dt>
                <dd class="text-toned tabular">
                  {{ formatZfsBytes(pool.allocBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Free</dt>
                <dd class="text-toned tabular">
                  {{ formatZfsBytes(pool.freeBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Cap</dt>
                <dd class="text-toned tabular">{{ pool.cap ?? "—" }} %</dd>
              </div>
              <div>
                <dt class="text-muted">Frag</dt>
                <dd class="text-toned tabular">{{ pool.frag ?? "—" }} %</dd>
              </div>
              <div>
                <dt class="text-muted">Dedup</dt>
                <dd class="text-toned tabular">
                  {{ pool.dedup === null ? "—" : `${pool.dedup.toFixed(2)}×` }}
                </dd>
              </div>
            </dl>
          </div>
          <UProgress
            v-if="pool.cap !== null"
            :model-value="pool.cap"
            :color="capacityColour(pool.cap)"
            size="xs"
            data-testid="pool-capacity-bar"
          />
          <ChartsTimeSeriesChart
            :series="capacityChart.series"
            :unit="capacityChart.unit"
          />
        </section>

        <div class="flex flex-col gap-4">
          <PoolScanPanel
            :scan="pool.scan"
            :last-scrub="pool.lastScrub"
            :scan-progress-at="pool.scanProgressAt"
            :first-seen-at="pool.firstSeenAt"
            :scrub-interval-days="pool.resolvedConfig.scrubIntervalDays"
            :now="now"
          />
          <PoolRemovalPanel v-if="pool.removal" :removal="pool.removal" />
        </div>
      </div>

      <UTabs
        v-model="activeTab"
        :items="tabs"
        variant="link"
        class="w-full"
      >
        <template #vdevs>
          <PoolVdevTreeTable
            :pool-id="pool.id"
            :root="pool.vdevs"
            :slow-io-threshold="pool.resolvedConfig.slowIoThreshold"
          />
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

        <template #space>
          <p
            v-if="datasetsStatus === 'error'"
            class="text-error py-4 text-sm"
          >
            Could not load the datasets.
          </p>
          <template v-else>
            <p class="text-muted py-4 text-sm md:hidden">
              The space map needs a wider screen. The Datasets tab lists the
              same figures.
            </p>
            <div class="hidden md:block">
              <p
                v-if="datasetsStatus === 'pending'"
                class="text-dimmed py-4 text-sm"
              >
                Loading datasets…
              </p>
              <DatasetTreemap v-else :datasets="datasets?.datasets ?? []" />
            </div>
          </template>
        </template>

        <template #events>
          <PoolEventList :events="pool.events" :root="pool.vdevs" />
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
