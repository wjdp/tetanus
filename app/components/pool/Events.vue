<script setup lang="ts">
import type { PoolVdev } from "./types";

const props = defineProps<{ poolId: number; root: PoolVdev | null }>();

const route = useRoute();
const router = useRouter();

const showHistory = computed({
  get: () => route.query.events === "all",
  set: (all: boolean) =>
    router.replace({
      query: { ...route.query, events: all ? "all" : undefined },
    }),
});

const events = useInfiniteList((page) =>
  $fetch(`/api/pools/${props.poolId}/events`, {
    query: { ...page, all: showHistory.value ? "true" : undefined },
  }),
);
const { items, status } = events;

watch(showHistory, events.reload);
</script>

<template>
  <div class="flex flex-col gap-2 py-2">
    <USwitch
      v-model="showHistory"
      label="Show history events"
      size="sm"
      class="self-end"
      data-testid="events-show-history"
    />
    <PoolEventList
      v-if="status === 'success' || items.length > 0"
      :events="items"
      :root="root"
      :empty="
        showHistory
          ? 'No events recorded for this pool.'
          : 'No events beyond history events, which repeat pool history.'
      "
    />
    <InfiniteListEnd :list="events" />
  </div>
</template>
