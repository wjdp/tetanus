<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  linkedDiskIds,
  railGroups,
} from "~/components/topology/groupDisks";

useSeoMeta({ title: getPageTitle("Topology") });

const [
  { data: hosts, refresh: refreshHosts },
  { data: pools, refresh: refreshPools },
  { data: disks, refresh: refreshDisks },
  { data: settings },
] = await Promise.all([
  useFetch("/api/hosts"),
  useFetch("/api/pools"),
  useFetch("/api/disks"),
  useSettings(),
]);
const requestUrl = useRequestURL();

const now = ref(Date.now());
let pollHandle: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  pollHandle = setInterval(() => {
    now.value = Date.now();
    refreshHosts();
    refreshPools();
    refreshDisks();
  }, 60_000);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const poolsByHost = computed(() => {
  const byHost = new Map<number, NonNullable<typeof pools.value>>();
  for (const pool of pools.value ?? []) {
    byHost.set(pool.host.id, [...(byHost.get(pool.host.id) ?? []), pool]);
  }
  return byHost;
});

const inPool = computed(() =>
  linkedDiskIds((pools.value ?? []).map((pool) => pool.vdevs)),
);

const disksByHost = computed(() => {
  const byHost = new Map<number, NonNullable<typeof disks.value>>();
  for (const disk of disks.value ?? []) {
    if (disk.lastSeenHostId === null) continue;
    byHost.set(disk.lastSeenHostId, [
      ...(byHost.get(disk.lastSeenHostId) ?? []),
      disk,
    ]);
  }
  return byHost;
});

const rail = computed(() => railGroups(disks.value ?? [], inPool.value));
</script>

<template>
  <AppPanel title="Topology" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Topology
    </h1>

    <div
      v-if="hosts && hosts.length === 0"
      class="border-default mt-6 flex flex-col gap-4 rounded-lg border border-dashed p-8"
    >
      <div class="flex items-center gap-3">
        <TetanusMark :size="28" class="text-dimmed shrink-0" />
        <p class="text-highlighted font-semibold">
          No hosts have reported yet.
        </p>
      </div>

      <InstallCommand
        v-if="settings"
        :url="requestUrl.origin"
        :token="settings.enrolToken"
      />

      <div>
        <UButton
          to="/settings/hosts"
          color="neutral"
          variant="soft"
          icon="i-lucide-server"
          label="Go to Hosts settings"
        />
      </div>
    </div>

    <div
      v-else-if="hosts"
      class="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div class="flex min-w-0 flex-col gap-10">
        <TopologyHostSection
          v-for="host in hosts"
          :key="host.id"
          :host="host"
          :pools="poolsByHost.get(host.id) ?? []"
          :disks="disksByHost.get(host.id) ?? []"
          :in-pool="inPool"
          :now="now"
        />
      </div>
      <TopologyDiskRail :groups="rail" />
    </div>
  </AppPanel>
</template>
