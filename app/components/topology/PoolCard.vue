<script setup lang="ts">
import { zfsStateColour } from "~/utils/statusColour";
import { isScanActive, scanEndedAt, scanProgress } from "../pool/scan";
import { type TopologyPool, vdevGroups } from "./groupDisks";
import { STATUS_TEXT_CLASS } from "./statusClasses";

const props = defineProps<{ pool: TopologyPool; now: number }>();

const groups = computed(() => vdevGroups(props.pool.vdevs));
const activeScan = computed(() => {
  const scan = props.pool.scan;
  return scan && isScanActive(scan) ? scanProgress(scan, props.now) : null;
});
const lastScan = computed(() => {
  const scan = props.pool.scan;
  if (!scan || isScanActive(scan)) return null;
  return {
    verb: scan.function.toLowerCase(),
    endedAt: scanEndedAt(scan),
    errors: scan.errors,
  };
});
const capColour = computed(() =>
  (props.pool.cap ?? 0) >= 90 ? "warning" : "neutral",
);
</script>

<template>
  <article
    class="border-default flex flex-col gap-4 rounded-lg border p-4"
    data-testid="pool-card"
  >
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <NuxtLink
        :to="`/zfs/${pool.id}`"
        class="text-highlighted text-lg font-semibold hover:underline"
      >
        {{ pool.name }}
      </NuxtLink>
      <UBadge :color="zfsStateColour(pool.state)" variant="subtle" size="sm">
        {{ pool.state }}
      </UBadge>
      <span v-if="activeScan" class="text-info text-sm">
        {{ activeScan.verb }} running {{ activeScan.percent }} %
      </span>
      <span
        v-else-if="lastScan"
        class="text-sm"
        :class="lastScan.errors > 0 ? 'text-warning' : 'text-muted'"
      >
        Last {{ lastScan.verb }} {{ formatDate(lastScan.endedAt) }} ·
        {{ lastScan.errors }} errors
      </span>
      <span v-else class="text-dimmed text-sm">No scrub recorded</span>
    </header>

    <div class="flex flex-col gap-1">
      <UProgress
        :model-value="pool.cap ?? 0"
        :color="capColour"
        size="sm"
      />
      <p class="text-muted tabular text-sm">
        {{ formatBytes(pool.allocBytes) }} of {{ formatBytes(pool.sizeBytes) }}
        · {{ pool.cap ?? "—" }} % · frag {{ pool.frag ?? "—" }} %
      </p>
    </div>

    <p v-if="groups.length === 0" class="text-dimmed text-sm">
      No vdevs reported.
    </p>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="group in groups"
        :key="group.key"
        class="flex flex-col gap-2 sm:flex-row sm:items-start"
        data-testid="vdev-group"
      >
        <div class="flex w-40 shrink-0 flex-col sm:pt-1">
          <span class="text-toned truncate font-mono text-sm">
            {{ group.label }}
          </span>
          <span
            v-if="group.state"
            class="text-xs"
            :class="STATUS_TEXT_CLASS[zfsStateColour(group.state)]"
          >
            {{ group.state }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <TopologyDiskTile
            v-for="leaf in group.leaves"
            :key="leaf.guid"
            :leaf="leaf"
          />
        </div>
      </div>
    </div>
  </article>
</template>
