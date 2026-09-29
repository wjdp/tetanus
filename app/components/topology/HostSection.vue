<script setup lang="ts">
import type { RunLike } from "~/utils/hostFreshness";
import { activeScan } from "./activeScan";
import {
  hostDiskGroups,
  hostDiskSummary,
  type TopologyDisk,
  type TopologyPool,
} from "./groupDisks";

const props = defineProps<{
  host: {
    id: number;
    name: string;
    displayName: string | null;
    lastRuns: Record<string, RunLike>;
  };
  pools: TopologyPool[];
  disks: TopologyDisk[];
  inPool: Set<number>;
  now: number;
}>();

const cadences = useRuntimeConfig().public.demo ? DEMO_CADENCES : undefined;

const relativeTime = (date: Date | null) =>
  date ? `${formatDuration(props.now - date.getTime())} ago` : "never";

const chipColor = (
  status: ReturnType<typeof allGroupFreshness>[number]["status"],
) => (status === "ok" ? "neutral" : status);

const activeScans = computed(() =>
  props.pools.flatMap((pool) => {
    const scan = activeScan(pool.scan, props.now);
    return scan ? [{ pool: pool.name, text: scan.text }] : [];
  }),
);

const summary = computed(() => {
  const { count, hdd, ssd, rawBytes } = hostDiskSummary(props.disks);
  if (count === 0) return null;
  return [
    `${count} ${count === 1 ? "disk" : "disks"}`,
    hdd > 0 ? `${hdd} HDD` : null,
    ssd > 0 ? `${ssd} SSD` : null,
    rawBytes === null ? null : `${formatBytes(rawBytes)} raw`,
  ]
    .filter(Boolean)
    .join(" · ");
});

const otherDisks = computed(() =>
  hostDiskGroups(props.disks, props.host.id, props.inPool),
);
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="host-section">
    <header class="flex flex-col gap-1">
      <h2 class="text-highlighted text-lg font-semibold">
        {{ host.displayName || host.name }}
        <span
          v-if="host.displayName"
          class="text-dimmed ml-1 font-mono text-sm font-normal"
        >
          {{ host.name }}
        </span>
      </h2>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p
          v-if="summary"
          class="text-dimmed tabular text-sm"
          data-testid="host-summary"
        >
          {{ summary }}
        </p>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <UBadge
            v-for="group in allGroupFreshness(host.lastRuns, now, cadences)"
            :key="group.name"
            :color="chipColor(group.status)"
            variant="subtle"
            size="sm"
          >
            {{ group.name }}: {{ relativeTime(group.lastSeenAt) }}
          </UBadge>
          <UBadge
            v-for="scan in activeScans"
            :key="scan.pool"
            color="info"
            variant="subtle"
            size="sm"
            icon="i-lucide-loader"
          >
            {{ scan.pool }}: {{ scan.text }}
          </UBadge>
        </div>
      </div>
    </header>

    <p
      v-if="pools.length === 0 && otherDisks.length === 0"
      class="text-muted text-sm"
    >
      No pools reported yet.
    </p>

    <TopologyPoolCard
      v-for="pool in pools"
      :key="pool.id"
      :pool="pool"
      :now="now"
    />

    <article
      v-if="otherDisks.length > 0"
      class="border-default flex flex-col gap-4 rounded-lg border p-4"
      data-testid="other-disks-card"
    >
      <h3 class="text-highlighted text-lg font-semibold">Other disks</h3>
      <div class="flex flex-col gap-3">
        <TopologyVdevRow
          v-for="group in otherDisks"
          :key="group.key"
          :icon="group.icon"
          :label="group.label"
          data-testid="host-disk-group"
        >
          <TopologyDiskTile
            v-for="disk in group.disks"
            :key="disk.id"
            :disk="disk"
          />
        </TopologyVdevRow>
      </div>
    </article>
  </section>
</template>
