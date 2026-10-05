<script setup lang="ts">
import {
  RETENTION_RULES,
  RETENTION_SCHEDULE_DESCRIPTION,
} from "#shared/retention";

const demo = useRuntimeConfig().public.demo;
const toast = useToast();

const { data: databaseSize } = await useFetch("/api/database", {
  key: "database-size",
});
const optimising = ref(false);

const optimiseDatabase = async () => {
  optimising.value = true;
  try {
    const { before, after } = await $fetch("/api/database/optimise", {
      method: "POST",
    });
    databaseSize.value = after;
    toast.add({
      title: "Database optimised",
      description: `${formatBytes(before.bytes)} → ${formatBytes(after.bytes)}`,
      color: "success",
    });
  } catch (error) {
    toast.add({
      title: "Could not optimise the database",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    optimising.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-8">
    <section v-if="!demo" class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Maintenance</h2>

      <UFormField
        label="Optimise"
        name="optimise"
        description="Rebuilds the database file to reclaim space left by deleted rows and refreshes the query planner's statistics. Ingest pauses while it runs."
      >
        <div class="flex flex-wrap items-center gap-4">
          <UButton
            icon="i-lucide-database-zap"
            color="neutral"
            variant="outline"
            :loading="optimising"
            data-testid="optimise-database"
            @click="optimiseDatabase"
          >
            Optimise database
          </UButton>
          <span
            v-if="databaseSize"
            class="text-muted text-sm"
            data-testid="database-size"
          >
            {{ formatBytes(databaseSize.bytes) }},
            {{ formatBytes(databaseSize.reclaimableBytes) }} reclaimable
          </span>
        </div>
      </UFormField>
    </section>

    <section class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-highlighted text-lg font-semibold">Retention</h2>
        <p class="text-muted text-sm">
          <template v-if="demo">
            Retention does not run in the demo, which resets daily.
          </template>
          <template v-else>
            Runs {{ RETENTION_SCHEDULE_DESCRIPTION }}, server time. Recent
            history is kept in full; older history is thinned rather than
            deleted, so long-term trends remain. Freed space is returned to
            the filesystem after each run.
          </template>
        </p>
      </div>

      <dl
        class="divide-default border-default divide-y rounded-md border"
        data-testid="retention-rules"
      >
        <div
          v-for="rule in RETENTION_RULES"
          :key="rule.data"
          class="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4"
        >
          <dt class="text-highlighted text-sm font-medium">{{ rule.data }}</dt>
          <dd class="flex flex-col gap-1 text-sm">
            <span>{{ rule.kept }}</span>
            <span class="text-muted">{{ rule.reason }}</span>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
