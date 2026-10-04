<script setup lang="ts">
import type { RunLike } from "~/utils/hostFreshness";
import { activeScan } from "./activeScan";
import {
  hostDiskSummary,
  type TopologyDisk,
  type TopologyPool,
} from "./groupDisks";

const props = defineProps<{
  host: {
    id: number;
    name: string;
    displayName: string | null;
    intermittent: boolean;
    lastRuns: Record<string, RunLike>;
    lastSeenAt: Date | string;
  };
  pools: TopologyPool[];
  disks: TopologyDisk[];
  inPool: Set<number>;
  now: number;
}>();

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

</script>

<template>
  <section class="flex flex-col gap-4" data-testid="host-section">
    <header class="flex flex-col gap-1">
      <h2 class="text-highlighted text-lg font-semibold">
        <NuxtLink :to="`/hosts/${host.id}`" class="hover:text-primary">
          {{ host.displayName || host.name }}
        </NuxtLink>
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
          <HostFreshnessChips :host="host" :now="now" />
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

    <TopologyHostTopology
      :host-id="host.id"
      :pools="pools"
      :disks="disks"
      :in-pool="inPool"
      :now="now"
    />
  </section>
</template>
