<script setup lang="ts">
import { NuxtLink } from "#components";
import {
  hasErrors,
  leafLabel,
  type TopologyVdev,
  tileColour,
} from "./groupDisks";

const props = defineProps<{ leaf: TopologyVdev }>();

const label = computed(() => leafLabel(props.leaf));
const dot = computed(() => tileColour(props.leaf));
const counters = computed(() =>
  (
    [
      ["R", props.leaf.readErrors],
      ["W", props.leaf.writeErrors],
      ["C", props.leaf.checksumErrors],
    ] as const
  ).filter(([, count]) => count > 0),
);
const nonOnlineState = computed(() =>
  props.leaf.state === "ONLINE" ? null : props.leaf.state,
);
</script>

<template>
  <UTooltip :text="leaf.path ?? leaf.name" :disabled="!!leaf.disk">
    <component
      :is="leaf.disk ? NuxtLink : 'div'"
      :to="leaf.disk ? `/disks/${leaf.disk.id}` : undefined"
      class="bg-elevated border-default flex h-16 w-24 flex-col justify-between rounded-md border p-2"
      :class="
        leaf.disk
          ? 'hover:border-accented transition-colors'
          : 'border-dashed'
      "
      data-testid="disk-tile"
    >
      <span class="flex items-center justify-between gap-1">
        <span
          class="truncate font-semibold"
          data-testid="disk-tile-label"
          :class="leaf.disk ? 'text-highlighted' : 'text-muted'"
        >
          {{ label }}
        </span>
        <TopologyStatusDot :colour="dot.colour" :shape="dot.shape" />
      </span>
      <span v-if="hasErrors(leaf)" class="text-error tabular font-mono text-xs">
        <span v-for="[name, count] in counters" :key="name" class="mr-1">
          {{ name }}{{ count }}
        </span>
      </span>
      <span v-else-if="nonOnlineState" class="text-muted text-xs">
        {{ nonOnlineState }}
      </span>
      <span v-else-if="!leaf.disk" class="text-dimmed text-xs">unlinked</span>
    </component>
  </UTooltip>
</template>
