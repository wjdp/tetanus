<script setup lang="ts">
import type { FreshnessStatus } from "~/utils/hostFreshness";

interface SourceRun {
  receivedAt: Date | string;
  ok: boolean;
  error: string | null;
}

const props = defineProps<{
  lastRuns: Record<string, SourceRun>;
  now: number;
}>();

const cadences = useRuntimeConfig().public.demo ? DEMO_CADENCES : undefined;

const DOT_CLASS: Record<FreshnessStatus, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

const rows = computed(() =>
  MONITORED_SOURCES.map((source) => {
    const run = props.lastRuns[source];
    const { status, lastSeenAt } = sourceFreshness(
      source,
      run,
      props.now,
      cadences,
    );
    return {
      source,
      dotClass: DOT_CLASS[status],
      when: lastSeenAt
        ? `${formatDuration(props.now - lastSeenAt.getTime())} ago`
        : "never",
      error: run && !run.ok ? (run.error ?? "failed") : null,
    };
  }),
);
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="sources-panel"
  >
    <h2 class="text-highlighted font-semibold">Sources</h2>
    <ul class="flex flex-col gap-1 text-sm">
      <li
        v-for="row in rows"
        :key="row.source"
        class="flex flex-col"
        :data-testid="`source-${row.source}`"
      >
        <div class="flex items-center gap-2">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="row.dotClass"
            aria-hidden="true"
          />
          <span class="font-mono text-xs">{{ row.source }}</span>
          <span class="text-muted tabular ms-auto text-xs">{{ row.when }}</span>
        </div>
        <p
          v-if="row.error"
          class="text-error ps-4 text-xs break-words"
          :title="row.error"
        >
          {{ row.error }}
        </p>
      </li>
    </ul>
  </section>
</template>
