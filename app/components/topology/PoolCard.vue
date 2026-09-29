<script setup lang="ts">
import { capacityColour, zfsStateColour } from "~/utils/vocabulary";
import { isScanActive, scanEndedAt } from "../pool/scan";
import { activeScan } from "./activeScan";
import { type TopologyPool, vdevGroups } from "./groupDisks";

const props = defineProps<{ pool: TopologyPool; now: number }>();

const groups = computed(() => vdevGroups(props.pool.vdevs));
const classDividerIndex = computed(() => {
  const index = groups.value.findIndex((group) => group.isClass);
  return index > 0 ? index : null;
});
const scanRunning = computed(() => activeScan(props.pool.scan, props.now));
const lastScan = computed(() => {
  const scan = props.pool.scan;
  if (!scan || isScanActive(scan)) return null;
  return {
    verb: scan.function.toLowerCase(),
    endedAt: scanEndedAt(scan),
    errors: scan.errors,
  };
});
const capColour = computed(() => capacityColour(props.pool.cap));
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
      <span
        v-if="lastScan"
        class="text-sm"
        :class="lastScan.errors > 0 ? 'text-warning' : 'text-muted'"
      >
        Last {{ lastScan.verb }} {{ formatDate(lastScan.endedAt) }} ·
        {{ lastScan.errors }} errors
      </span>
      <span v-else-if="!scanRunning" class="text-dimmed text-sm">
        No scrub recorded
      </span>
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
      <template v-if="scanRunning">
        <UProgress
          :model-value="scanRunning.percent"
          color="info"
          size="2xs"
          data-testid="scan-progress"
        />
        <p class="text-info tabular text-sm">{{ scanRunning.text }}</p>
      </template>
    </div>

    <p v-if="groups.length === 0" class="text-dimmed text-sm">
      No vdevs reported.
    </p>

    <div v-else class="flex flex-col gap-3">
      <TopologyVdevRow
        v-for="(group, index) in groups"
        :key="group.key"
        :class="{ 'border-default border-t pt-3': index === classDividerIndex }"
        :data-class-divider="index === classDividerIndex || undefined"
        :type="group.type"
        :label="group.label"
        :state="group.state"
        :size-bytes="group.sizeBytes"
        :alloc-bytes="group.allocBytes"
      >
        <TopologyDiskTile
          v-for="leaf in group.leaves"
          :key="leaf.guid"
          :leaf="leaf"
        />
      </TopologyVdevRow>
    </div>
  </article>
</template>
