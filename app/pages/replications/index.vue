<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { statusSummary } from "~/components/replication/groups";

useSeoMeta({ title: getPageTitle("Replications") });

const CLOCK_TICK_MS = 60_000;

const { data, status, refresh } = await useFetch("/api/replications");
const replications = computed(() => data.value ?? []);

const now = ref(Date.now());
let clockHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockHandle = setInterval(() => {
    now.value = Date.now();
    refresh();
  }, CLOCK_TICK_MS);
});
onUnmounted(() => {
  if (clockHandle) clearInterval(clockHandle);
});

const active = computed(() =>
  replications.value.filter((row) => row.status !== "archived"),
);
const archived = computed(() =>
  replications.value.filter((row) => row.status === "archived"),
);

const archivedOpen = ref(false);

const summary = computed(() => {
  const count = active.value.length;
  const problems = statusSummary(active.value);
  return `${count} ${count === 1 ? "replication" : "replications"} · ${problems || "all on schedule"}`;
});
</script>

<template>
  <AppPanel title="Replications" class="flex max-w-7xl flex-col gap-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Replications
      </h1>
      <p
        v-if="active.length"
        class="text-muted text-sm"
        data-testid="replications-summary"
      >
        {{ summary }}
      </p>
    </div>

    <div
      v-if="replications.length === 0 && status !== 'pending'"
      class="border-default flex flex-col items-center gap-1 rounded-md border border-dashed px-4 py-10 text-center"
      data-testid="replications-empty"
    >
      <p class="text-highlighted font-medium">No replications seen yet</p>
      <p class="text-muted max-w-prose text-sm">
        They appear once a monitored host's pool history shows a
        <span class="font-mono">zfs receive</span> into one of its datasets.
      </p>
    </div>

    <ReplicationGroupList v-if="active.length" :rows="active" :now="now" />

    <section
      v-if="archived.length"
      class="flex flex-col gap-3"
      data-testid="archived-replications"
    >
      <button
        type="button"
        class="text-toned flex items-center gap-1.5 text-left text-sm font-semibold"
        :aria-expanded="archivedOpen"
        data-testid="archived-toggle"
        @click="archivedOpen = !archivedOpen"
      >
        <UIcon name="i-lucide-archive" class="text-muted size-4 shrink-0" />
        Archived
        <span class="text-dimmed tabular font-normal">
          {{ archived.length }}
        </span>
        <UIcon
          name="i-lucide-chevron-down"
          class="text-dimmed size-4 transition-transform"
          :class="archivedOpen ? '' : '-rotate-90'"
        />
      </button>
      <ReplicationGroupList
        v-if="archivedOpen"
        :rows="archived"
        :now="now"
        class="opacity-75"
      />
    </section>
  </AppPanel>
</template>
