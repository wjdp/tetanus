<script setup lang="ts">
import { findMembership } from "./membership";
import type { PoolSummary, VdevNode } from "./types";

const props = defineProps<{ diskId: number }>();

const { data: pools, status } = useFetch<PoolSummary[]>("/api/pools", {
  lazy: true,
});

const membership = computed(() =>
  findMembership<VdevNode, PoolSummary>(pools.value ?? [], props.diskId),
);

const errorCounters = computed(() => {
  const leaf = membership.value?.leaf;
  if (!leaf) return [];
  return [
    { label: "Read", value: leaf.readErrors },
    { label: "Write", value: leaf.writeErrors },
    { label: "Checksum", value: leaf.checksumErrors },
  ];
});
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-highlighted text-lg font-semibold">ZFS</h2>

    <p v-if="status === 'pending'" class="text-dimmed text-sm">Loading pools…</p>
    <p v-else-if="!membership" class="text-muted text-sm">
      Not a member of any pool.
    </p>
    <div
      v-else
      class="border-default flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-4 text-sm"
    >
      <div class="flex items-center gap-1.5">
        <ULink
          :to="`/zfs/${membership.pool.id}`"
          class="text-highlighted hover:text-primary font-medium"
        >
          {{ membership.pool.name }}
        </ULink>
        <template v-for="node in membership.ancestors" :key="node.id">
          <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
          <span class="text-default">{{ node.name }}</span>
        </template>
        <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
        <span class="text-default font-mono text-xs">{{ membership.leaf.name }}</span>
      </div>
      <UBadge
        :color="zfsStateColour(membership.leaf.state)"
        variant="subtle"
        :label="membership.leaf.state"
      />
      <dl class="flex gap-4">
        <div v-for="counter in errorCounters" :key="counter.label" class="flex gap-1">
          <dt class="text-dimmed">{{ counter.label }}</dt>
          <dd
            class="tabular"
            :class="counter.value > 0 ? 'text-warning' : 'text-muted'"
          >
            {{ counter.value }}
          </dd>
        </div>
      </dl>
      <span class="text-dimmed">
        on {{ membership.pool.host.displayName || membership.pool.host.name }}
      </span>
    </div>
  </section>
</template>
