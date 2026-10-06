<script setup lang="ts">
const props = defineProps<{ diskId: number }>();
const emit = defineEmits<{ changed: [] }>();

const RESOLVED_SHOWN = 10;

const live = useFaults(() => ({
  state: "open,acknowledged,accepted",
  subject: `disk:${props.diskId}`,
}));
const poolFaults = useFaults(() => ({
  state: "open,acknowledged,accepted",
  namesDisk: String(props.diskId),
}));
const resolved = useFaults(() => ({
  state: "resolved",
  subject: `disk:${props.diskId}`,
}));

const recentlyResolved = computed(() =>
  resolved.faults.value.slice(0, RESOLVED_SHOWN),
);

const now = ref(Date.now());

const onChanged = async () => {
  now.value = Date.now();
  await Promise.all([
    live.refresh(),
    poolFaults.refresh(),
    resolved.refresh(),
  ]);
  emit("changed");
};
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="disk-faults">
    <FaultList
      v-if="live.faults.value.length"
      :faults="live.faults.value"
      :now="now"
      :perform="live.perform"
      hide-subject
      @changed="onChanged"
    />
    <p v-else class="text-muted text-sm" data-testid="disk-faults-none">
      No live faults on this disk.
    </p>

    <div
      v-if="poolFaults.faults.value.length"
      class="flex flex-col gap-2"
      data-testid="disk-pool-faults"
    >
      <h3 class="text-muted text-sm font-medium">Pool faults naming this disk</h3>
      <FaultList
        :faults="poolFaults.faults.value"
        :now="now"
        :perform="poolFaults.perform"
        @changed="onChanged"
      />
    </div>

    <div v-if="recentlyResolved.length" class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="text-muted text-sm font-medium">Resolved</h3>
        <NuxtLink
          :to="{ path: '/faults', query: { state: 'resolved', subject: `disk:${diskId}` } }"
          class="text-dimmed text-xs hover:underline"
        >
          All on the Faults page
        </NuxtLink>
      </div>
      <FaultList
        :faults="recentlyResolved"
        :now="now"
        :perform="resolved.perform"
        hide-subject
        @changed="onChanged"
      />
    </div>
  </section>
</template>
