<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { diskLabel, displayName } from "~/components/disk/displayName";
import type { DiskDetail } from "~/components/disk/types";
import { DEVICE_STATUS_VOCABULARY } from "~/utils/vocabulary";

const TABS = [
  "overview",
  "faults",
  "smart",
  "statistics",
  "farm",
  "diary",
] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Tab = "overview";

const route = useRoute();
const router = useRouter();
const diskId = computed(() => Number(route.params.id));

const TABS_UI = { list: "px-0 py-1 gap-6 overflow-x-auto", trigger: "px-0" };

const {
  data: disk,
  error,
  refresh,
} = await useFetch<DiskDetail>(() => `/api/disks/${diskId.value}`);

const heading = computed(
  () =>
    (disk.value && displayName(disk.value)) ??
    disk.value?.model ??
    "Disk",
);

useSeoMeta({ title: () => getPageTitle(heading.value) });

const { data: allDisks, refresh: refreshDiskList } = useDiskList();

const labelOf = (id: number | null) => {
  if (id === null) return null;
  const found = allDisks.value.find((candidate) => candidate.id === id);
  return found ? diskLabel(found) : null;
};

const label = computed(() =>
  disk.value ? diskLabel(disk.value) : "disk",
);

const disposedDisk = computed(() =>
  disk.value?.disposal ? { ...disk.value, disposal: disk.value.disposal } : null,
);

const onUpdated = (updated: DiskDetail) => {
  disk.value = updated;
  refreshDiskList();
};

const isTab = (value: unknown): value is Tab =>
  TABS.includes(value as Tab) && (value !== "farm" || Boolean(disk.value?.latestFarm));

const activeTab = computed<Tab>({
  get: () => (isTab(route.query.tab) ? route.query.tab : DEFAULT_TAB),
  set: (tab) => {
    router.replace({
      query: { ...route.query, tab: tab === DEFAULT_TAB ? undefined : tab },
    });
  },
});

const faultCounts = computed(() => {
  const counts = disk.value?.faultCounts;
  return counts
    ? { error: counts.error, warning: counts.warning, neutral: counts.acknowledged }
    : null;
});

const smartStatus = computed(() =>
  disk.value && disk.value.latestStatus !== "passed"
    ? DEVICE_STATUS_VOCABULARY[disk.value.latestStatus]
    : null,
);

const tabs = computed<TabsItem[]>(() => [
  { label: "Overview", slot: "overview", value: "overview" },
  { label: "Faults", slot: "faults", value: "faults" },
  { label: "SMART", slot: "smart", value: "smart" },
  { label: "Statistics", slot: "statistics", value: "statistics" },
  ...(disk.value?.latestFarm
    ? [{ label: "FARM", slot: "farm", value: "farm" }]
    : []),
  {
    label: "Diary",
    slot: "diary",
    value: "diary",
    badge: disk.value?.diaryCount || undefined,
  },
]);
</script>

<template>
  <AppPanel :title="heading" class="max-w-7xl">
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <UButton
          to="/disks"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Disks"
          class="-ml-2.5"
        />
        <div v-if="disk" class="ms-auto flex items-center gap-2">
          <SimulateFaultMenu subject-type="disk" :subject-id="disk.id" />
          <DiskActionsMenu :disk="disk" :label="label" @updated="onUpdated" />
        </div>
      </div>

      <p v-if="error || !disk" class="text-muted">
        {{ error?.statusCode === 404 ? "No such disk." : "Could not load the disk." }}
      </p>

      <template v-else>
        <DiskNameplate
          :disk="disk"
          :replaces-label="labelOf(disk.replacesDiskId)"
          @updated="onUpdated"
        />

        <DiskHeadlineFigures
          :disk="disk"
          class="border-default border-y py-4"
        />

        <DiskDisposalBanner
          v-if="disposedDisk"
          :disk="disposedDisk"
          :label="label"
          :replaced-by-label="labelOf(disposedDisk.replacedByDiskId)"
          @updated="onUpdated"
        />

        <UTabs
          v-model="activeTab"
          :items="tabs"
          variant="link"
          class="w-full min-w-0"
          :ui="TABS_UI"
        >
          <template #trailing="{ item }">
            <AppNavCounts
              v-if="item.value === 'faults' && faultCounts"
              :counts="faultCounts"
              data-testid="faults-tab-counts"
            />
            <TopologyStatusDot
              v-else-if="item.value === 'smart' && smartStatus"
              :colour="smartStatus.colour"
              :shape="smartStatus.shape"
              :title="smartStatus.label"
              data-testid="smart-tab-status"
            />
            <UBadge
              v-else-if="item.badge"
              color="neutral"
              variant="outline"
              size="sm"
              :label="String(item.badge)"
              data-testid="diary-tab-count"
            />
          </template>

          <template #overview>
            <div class="py-4">
              <DiskOverview
                :disk="disk"
                :disks="allDisks"
                      @updated="onUpdated"
              />
            </div>
          </template>

          <template #faults>
            <div class="py-4">
              <DiskFaults :disk-id="disk.id" @changed="refresh" />
            </div>
          </template>

          <template #smart>
            <div class="py-4">
              <DiskSmart
                :disk-id="disk.id"
                :protocol="disk.protocol"
                @changed="refresh"
              />
            </div>
          </template>

          <template #statistics>
            <div class="py-4">
              <DiskStatistics :disk-id="disk.id" />
            </div>
          </template>

          <template v-if="disk.latestFarm" #farm>
            <div class="py-4">
              <DiskFarm
                :farm="disk.latestFarm"
                :smart-hours="disk.latestPowerOnHours"
              />
            </div>
          </template>

          <template #diary>
            <div class="py-4">
              <DiskDiary :disk-id="disk.id" @changed="refresh" />
            </div>
          </template>
        </UTabs>
      </template>
    </div>
  </AppPanel>
</template>
