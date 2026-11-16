<script setup lang="ts">
import type { InfiniteListStatus } from "~/composables/useInfiniteList";

const props = defineProps<{ status: InfiniteListStatus; hasMore: boolean }>();
const emit = defineEmits<{ loadMore: []; retry: [] }>();

const sentinel = useTemplateRef<HTMLElement>("sentinel");
const nearEnd = useElementVisibility(sentinel, { rootMargin: "400px" });

watch(
  [nearEnd, () => props.status, () => props.hasMore],
  ([visible, status, hasMore]) => {
    if (visible && status === "success" && hasMore) emit("loadMore");
  },
);
</script>

<template>
  <div
    v-if="hasMore || status !== 'success'"
    ref="sentinel"
    class="text-dimmed flex items-center gap-2 py-4 text-sm"
    data-testid="infinite-list-end"
  >
    <template v-if="status === 'error'">
      <span class="text-error">Could not load more.</span>
      <UButton
        label="Retry"
        color="neutral"
        variant="link"
        size="sm"
        @click="emit('retry')"
      />
    </template>
    <template v-else>Loading…</template>
  </div>
</template>
