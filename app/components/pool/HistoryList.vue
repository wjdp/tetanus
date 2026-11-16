<script setup lang="ts">
import { formatTimestamp } from "~/components/pool/timestamp";
import type { PoolHistoryPage } from "~/components/pool/types";

const props = defineProps<{ poolId: number; hostName: string }>();

const route = useRoute();
const router = useRouter();

const showAll = computed({
  get: () => route.query.history === "all",
  set: (all: boolean) =>
    router.replace({
      query: { ...route.query, history: all ? "all" : undefined },
    }),
});

const scope = ref<PoolHistoryPage["scope"]>("pool");

const history = useInfiniteList(async (page) => {
  const result = await $fetch(`/api/pools/${props.poolId}/history`, {
    query: { ...page, all: showAll.value ? "true" : undefined },
  });
  scope.value = result.scope;
  return result;
});
const { items: lines, status } = history;
watch(showAll, history.reload);
</script>

<template>
  <div class="flex flex-col gap-2 py-2">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p v-if="scope === 'host'" class="text-muted text-sm">
        Showing every pool on {{ hostName }}: the collected history has no pool
        headers to attribute lines.
      </p>
      <USwitch
        v-model="showAll"
        label="Show snapshot, replication and ioctl lines"
        size="sm"
        class="ms-auto"
        data-testid="history-show-all"
      />
    </div>
    <p
      v-if="status === 'success' && lines.length === 0"
      class="text-dimmed py-4 text-sm"
    >
      {{ showAll ? "No history recorded." : "No history beyond snapshot and replication lines." }}
    </p>
    <ul
      v-if="lines.length > 0"
      class="divide-default flex flex-col divide-y"
      data-testid="history-lines"
    >
      <li
        v-for="line in lines"
        :key="line.id"
        class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm"
      >
        <span class="text-muted tabular">{{ formatTimestamp(line.at) }}</span>
        <span v-if="line.internal" class="text-dimmed text-xs">internal</span>
        <span
          class="min-w-0 font-mono break-all whitespace-pre-wrap"
          :class="line.internal ? 'text-muted' : 'text-highlighted'"
          >{{ line.text }}</span
        >
      </li>
    </ul>
    <InfiniteListEnd :list="history" />
  </div>
</template>
