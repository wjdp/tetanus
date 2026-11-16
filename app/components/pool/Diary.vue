<script setup lang="ts">
const props = defineProps<{ poolId: number; revision: number }>();

const diary = useInfiniteList((page) =>
  $fetch(`/api/pools/${props.poolId}/diary`, { query: page }),
);
const { items, status } = diary;

watch(() => props.revision, diary.refresh);
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
    <InfiniteListEnd :list="diary" />
  </div>
</template>
