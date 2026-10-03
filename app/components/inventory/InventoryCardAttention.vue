<script setup lang="ts">
import type { StatusCounter } from "#shared/smart/counters";
import { faultRank, findColumn } from "./columns";
import InventoryCell from "./InventoryCell.vue";
import InventoryStatusCounter from "./InventoryStatusCounter.vue";
import { type InventoryDisk, WARRANTY_WARNING_DAYS } from "./types";

const props = defineProps<{ disk: InventoryDisk }>();

const faultsColumn = findColumn("faults");

const hasFaults = computed(() => faultRank(props.disk.faultCounts) !== null);

interface FlaggedCounter {
  id: string;
  label: string;
  counter: StatusCounter;
  suffix?: string;
}

const flaggedCounters = computed(() => {
  const { reallocated, pending, uncorrectable, wearPercent } =
    props.disk.counters;
  const candidates = [
    { id: "reallocated", label: "Reallocated", counter: reallocated },
    { id: "pending", label: "Pending", counter: pending },
    { id: "uncorrectable", label: "Uncorrectable", counter: uncorrectable },
    { id: "wear", label: "Wear", counter: wearPercent, suffix: " %" },
  ];
  return candidates.filter(
    (candidate): candidate is FlaggedCounter =>
      candidate.counter !== null && candidate.counter.status !== "passed",
  );
});

const warrantyDaysLeft = computed(() => {
  const days = props.disk.warrantyDaysLeft;
  return days !== null && days >= 0 && days < WARRANTY_WARNING_DAYS
    ? days
    : null;
});

const needsAttention = computed(
  () =>
    hasFaults.value ||
    flaggedCounters.value.length > 0 ||
    warrantyDaysLeft.value !== null,
);
</script>

<template>
  <div
    v-if="needsAttention"
    class="border-default flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-sm"
    data-testid="inventory-card-attention"
  >
    <InventoryCell
      v-if="hasFaults && faultsColumn"
      :column="faultsColumn"
      :disk="disk"
      :linked="false"
    />
    <InventoryStatusCounter
      v-for="{ id, label, counter, suffix } in flaggedCounters"
      :key="id"
      :counter="counter"
      :label="label"
      :suffix="suffix"
      :data-counter="id"
    />
    <span
      v-if="warrantyDaysLeft !== null"
      class="text-warning tabular-nums"
      data-testid="inventory-card-warranty"
    >
      Warranty {{ formatDays(warrantyDaysLeft) }}
    </span>
  </div>
</template>
