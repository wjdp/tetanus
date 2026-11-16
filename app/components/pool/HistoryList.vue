<script setup lang="ts">
import { formatTimestamp } from "~/components/pool/timestamp";
import type { PoolHistoryLine, PoolHistoryPage } from "~/components/pool/types";

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

const lines = ref<PoolHistoryLine[]>([]);
const scope = ref<PoolHistoryPage["scope"]>("pool");
const hasMore = ref(false);
const status = ref<"pending" | "success" | "error">("pending");
let latestRequest = 0;

async function load(before?: PoolHistoryLine) {
  const request = ++latestRequest;
  status.value = "pending";
  try {
    const page = await $fetch(`/api/pools/${props.poolId}/history`, {
      query: {
        all: showAll.value ? "true" : undefined,
        beforeAt: before ? Date.parse(before.at) : undefined,
        beforeId: before?.id,
      },
    });
    if (request !== latestRequest) return;
    lines.value = before ? [...lines.value, ...page.lines] : page.lines;
    scope.value = page.scope;
    hasMore.value = page.hasMore;
    status.value = "success";
  } catch {
    if (request === latestRequest) status.value = "error";
  }
}

const loadOlder = () => load(lines.value.at(-1));

onMounted(() => load());
watch(showAll, () => load());
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
    <p v-if="status === 'error'" class="text-error py-4 text-sm">
      Could not load history.
    </p>
    <p
      v-else-if="status === 'success' && lines.length === 0"
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
    <UButton
      v-if="hasMore"
      label="Load older"
      color="neutral"
      variant="outline"
      size="sm"
      class="self-start"
      :loading="status === 'pending'"
      data-testid="history-load-older"
      @click="loadOlder"
    />
  </div>
</template>
