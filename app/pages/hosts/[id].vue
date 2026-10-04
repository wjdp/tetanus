<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import {
  hostDiskSummary,
  linkedDiskIds,
} from "~/components/topology/groupDisks";

const POLL_MS = 60_000;

const route = useRoute();
const hostId = Number(route.params.id);

const [
  { data: host, error, refresh: refreshHost },
  { data: pools, refresh: refreshPools },
  { data: disks, refresh: refreshDisks },
  { data: diary, refresh: refreshDiary },
] = await Promise.all([
  useFetch(`/api/hosts/${hostId}`),
  useFetch("/api/pools"),
  useFetch("/api/disks"),
  useFetch("/api/diary", {
    query: { subjectType: "host", subjectId: hostId },
    default: () => [],
  }),
]);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage,
  });
}

const label = computed(
  () => host.value?.displayName || host.value?.name || "Host",
);

useSeoMeta({ title: () => getPageTitle(label.value) });

const now = ref(Date.now());
let pollHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  pollHandle = setInterval(() => {
    now.value = Date.now();
    refreshHost();
    refreshPools();
    refreshDisks();
  }, POLL_MS);
});
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const hostPools = computed(() =>
  (pools.value ?? []).filter((pool) => pool.host.id === hostId),
);
const hostDisks = computed(() =>
  (disks.value ?? []).filter((disk) => disk.lastSeenHostId === hostId),
);
const inPool = computed(() =>
  linkedDiskIds((pools.value ?? []).map((pool) => pool.vdevs)),
);

const summary = computed(() => {
  const { count, hdd, ssd, rawBytes } = hostDiskSummary(hostDisks.value);
  const poolCount = hostPools.value.length;
  return [
    `${poolCount} ${poolCount === 1 ? "pool" : "pools"}`,
    `${count} ${count === 1 ? "disk" : "disks"}`,
    hdd > 0 ? `${hdd} HDD` : null,
    ssd > 0 ? `${ssd} SSD` : null,
    rawBytes === null ? null : `${formatBytes(rawBytes)} raw`,
  ]
    .filter(Boolean)
    .join(" · ");
});

const lastSeen = computed(() =>
  host.value
    ? `${formatDuration(now.value - new Date(host.value.lastSeenAt).getTime())} ago`
    : "",
);

const activeTab = ref("diary");

const tabs = computed<TabsItem[]>(() => [
  {
    label: "Diary",
    slot: "diary",
    value: "diary",
    badge: diary.value?.length || undefined,
  },
  { label: "Settings", slot: "settings", value: "settings" },
]);
</script>

<template>
  <AppPanel :title="label" class="max-w-7xl">
    <div class="flex flex-col gap-6">
      <div class="flex items-center justify-between gap-4">
        <UButton
          to="/hosts"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Hosts"
          class="-ml-2.5"
        />
        <SimulateFaultMenu
          v-if="host"
          subject-type="host"
          :subject-id="host.id"
        />
      </div>

      <template v-if="host">
        <header class="flex flex-col gap-2">
          <div class="flex flex-wrap items-baseline gap-3">
            <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
              {{ label }}
            </h1>
            <span v-if="host.displayName" class="text-dimmed font-mono text-sm">
              {{ host.name }}
            </span>
            <UBadge
              v-if="host.intermittent"
              color="neutral"
              variant="subtle"
              size="sm"
              class="self-center"
            >
              intermittent
            </UBadge>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p class="text-dimmed tabular text-sm" data-testid="host-summary">
              {{ summary }} · last seen {{ lastSeen }}
            </p>
            <div class="flex flex-wrap items-center gap-1">
              <HostFreshnessChips :host="host" :now="now" />
            </div>
          </div>
        </header>

        <HostFaults :host-name="host.name" :now="now" />

        <div
          class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
        >
          <TopologyHostTopology
            :host-id="host.id"
            :pools="hostPools"
            :disks="hostDisks"
            :in-pool="inPool"
            :now="now"
          />
          <aside class="flex flex-col gap-4">
            <HostCollectorPanel
              :collector-version="host.collectorVersion"
              :tool-versions="host.toolVersions"
            />
            <section
              v-if="host.notes.trim()"
              class="border-default flex flex-col gap-2 rounded-lg border p-4"
              data-testid="host-notes"
            >
              <h2 class="text-highlighted font-semibold">Notes</h2>
              <DiaryMarkdown :source="host.notes" class="text-sm" />
            </section>
          </aside>
        </div>

        <UTabs
          v-model="activeTab"
          :items="tabs"
          variant="link"
          class="w-full"
        >
          <template #diary>
            <div class="py-4">
              <DiaryPanel
                subject-type="host"
                :subject-id="host.id"
                :entries="diary ?? []"
                :show-heading="false"
                @changed="refreshDiary"
              />
            </div>
          </template>

          <template #settings>
            <div class="max-w-2xl py-4">
              <HostSettingsForm :host="host" @saved="refreshHost" />
            </div>
          </template>
        </UTabs>
      </template>
    </div>
  </AppPanel>
</template>
