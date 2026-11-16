<script setup lang="ts">
import type { PoolVdev } from "./types";

const props = defineProps<{ poolId: number; root: PoolVdev | null }>();

const events = useInfiniteList((page) =>
  $fetch(`/api/pools/${props.poolId}/events`, { query: page }),
);
const { items, status, hasMore } = events;

onMounted(events.reload);
</script>

<template>
  <div class="flex flex-col">
    <PoolEventList
      v-if="status === 'success' || items.length > 0"
      :events="items"
      :root="root"
    />
    <InfiniteListEnd
      :status="status"
      :has-more="hasMore"
      @load-more="events.loadMore"
      @retry="events.retry"
    />
  </div>
</template>
