<script setup lang="ts">
import type { RunLike } from "~/utils/hostFreshness";

const props = defineProps<{
  host: {
    intermittent: boolean;
    lastRuns: Record<string, RunLike>;
    lastSeenAt: Date | string;
  };
  now: number;
}>();

const cadences = useRuntimeConfig().public.demo ? DEMO_CADENCES : undefined;

const offline = computed(() => isHostOffline(props.host, props.now, cadences));

const lastSeenAgo = computed(() =>
  formatDuration(props.now - new Date(props.host.lastSeenAt).getTime()),
);

const relativeTime = (date: Date | null) =>
  date ? `${formatDuration(props.now - date.getTime())} ago` : "never";

const chipColor = (
  status: ReturnType<typeof allGroupFreshness>[number]["status"],
) => (status === "ok" ? "neutral" : status);
</script>

<template>
  <UBadge
    v-if="offline"
    color="neutral"
    variant="subtle"
    size="sm"
    data-testid="offline-chip"
  >
    offline · last seen {{ lastSeenAgo }}
  </UBadge>
  <template v-else>
    <UBadge
      v-for="group in allGroupFreshness(host.lastRuns, now, cadences)"
      :key="group.name"
      :color="chipColor(group.status)"
      variant="subtle"
      size="sm"
    >
      {{ group.name }}: {{ relativeTime(group.lastSeenAt) }}
    </UBadge>
  </template>
</template>
