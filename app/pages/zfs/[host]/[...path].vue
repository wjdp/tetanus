<script setup lang="ts">
import { hostPath } from "#shared/entityPaths";

const route = useRoute();
const hostName = computed(() => String(route.params.host));
const segments = computed(() => {
  const path = route.params.path;
  return (Array.isArray(path) ? path : [path]).filter(Boolean);
});

if (segments.value.length === 0) {
  await navigateTo(hostPath(hostName.value), { redirectCode: 302 });
}

const { data, error, refresh } = await useFetch(
  () =>
    `/api/zfs/${[hostName.value, ...segments.value].map(encodeURIComponent).join("/")}`,
);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage,
  });
}
</script>

<template>
  <PoolPage
    v-if="data?.kind === 'pool'"
    :key="`pool-${data.pool.id}`"
    :pool="data.pool"
    @refresh="refresh"
  />
  <DatasetPage
    v-else-if="data?.kind === 'dataset'"
    :key="`dataset-${data.dataset.id}`"
    :dataset="data.dataset"
    @refresh="refresh"
  />
</template>
