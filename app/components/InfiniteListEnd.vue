<script setup lang="ts">
import type { InfiniteList } from "~/composables/useInfiniteList";

const props = defineProps<{ list: InfiniteList }>();

const status = computed(() => props.list.status.value);
const hasMore = computed(() => props.list.hasMore.value);

const sentinel = useTemplateRef<HTMLElement>("sentinel");

/** Pages scroll inside a panel, not the window; observing that panel lets the margin load ahead. */
function scrollingAncestor(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

const scrollTarget = ref<HTMLElement | null>(null);
watch(sentinel, (element) => {
  if (element) scrollTarget.value = scrollingAncestor(element);
});

const nearEnd = useElementVisibility(sentinel, {
  rootMargin: "400px",
  scrollTarget,
});

watch([nearEnd, status, hasMore], ([visible, current, more]) => {
  if (visible && current === "success" && more) props.list.loadMore();
});
</script>

<template>
  <div
    v-if="hasMore || status !== 'success'"
    ref="sentinel"
    role="status"
    aria-live="polite"
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
        @click="list.retry"
      />
    </template>
    <template v-else>Loading…</template>
  </div>
</template>
