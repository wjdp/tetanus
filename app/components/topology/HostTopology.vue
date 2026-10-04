<script setup lang="ts">
import {
  hostDiskGroups,
  type TopologyDisk,
  type TopologyPool,
} from "./groupDisks";

const props = defineProps<{
  hostId: number;
  pools: TopologyPool[];
  disks: TopologyDisk[];
  inPool: Set<number>;
  now: number;
}>();

const otherDisks = computed(() =>
  hostDiskGroups(props.disks, props.hostId, props.inPool),
);
</script>

<template>
  <div class="flex flex-col gap-4">
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
  </div>
</template>
