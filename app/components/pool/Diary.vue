<script setup lang="ts">
const props = defineProps<{ poolId: number }>();

const diary = useInfiniteList((page) =>
  $fetch(`/api/pools/${props.poolId}/diary`, { query: page }),
);
const { items, status, hasMore } = diary;

onMounted(diary.reload);
</script>

<template>
  <div class="flex flex-col py-4">
    <DiaryTimeline
      :entries="items"
      :show-subject="false"
      :empty="
        status === 'success'
          ? 'Nothing in the diary for this pool yet.'
          : ''
      "
      @changed="diary.refresh"
    />
    <InfiniteListEnd
      :status="status"
      :has-more="hasMore"
      @load-more="diary.loadMore"
      @retry="diary.retry"
    />
  </div>
</template>
