<script setup lang="ts">
import { leafLabel } from "#shared/faults";
import { formatTimestamp } from "./timestamp";
import type { PoolVdev } from "./types";

interface PoolEvent {
  id: number;
  at: string;
  class: string;
  eid: number | null;
  vdevGuid: string | null;
  payload: Record<string, unknown>;
}

const props = defineProps<{ events: PoolEvent[]; root: PoolVdev | null }>();

const vdevsByGuid = computed(() => {
  const byGuid = new Map<string, PoolVdev>();
  const visit = (node: PoolVdev) => {
    byGuid.set(node.guid, node);
    for (const child of node.children) visit(child);
  };
  if (props.root) visit(props.root);
  return byGuid;
});

const rows = computed(() =>
  props.events.map((event) => ({
    ...event,
    vdev: event.vdevGuid ? (vdevsByGuid.value.get(event.vdevGuid) ?? null) : null,
  })),
);

const openIds = ref(new Set<number>());

const toggle = (id: number) => {
  const next = new Set(openIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openIds.value = next;
};

const payloadEntries = (payload: Record<string, unknown>) =>
  Object.entries(payload).sort(([a], [b]) => a.localeCompare(b));

const payloadText = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
</script>

<template>
  <p v-if="events.length === 0" class="text-dimmed py-4 text-sm">
    No events recorded for this pool.
  </p>
  <ul v-else class="divide-default flex flex-col divide-y">
    <li
      v-for="event in rows"
      :key="event.id"
      class="flex flex-col gap-2 py-2 text-sm"
      data-testid="pool-event"
    >
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          class="self-center"
          :icon="openIds.has(event.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          :aria-label="`${openIds.has(event.id) ? 'Hide' : 'Show'} payload of event ${event.eid ?? event.id}`"
          :aria-expanded="openIds.has(event.id)"
          data-testid="pool-event-expand"
          @click="toggle(event.id)"
        />
        <span class="text-muted tabular">{{ formatTimestamp(event.at) }}</span>
        <span class="text-highlighted font-mono">{{ event.class }}</span>
        <span class="text-dimmed tabular font-mono text-xs">
          eid {{ event.eid ?? "—" }}
        </span>
        <span
          v-if="event.vdev"
          class="flex items-baseline gap-2 font-mono text-xs"
          data-testid="pool-event-vdev"
        >
          <span class="text-toned">{{ leafLabel(event.vdev.name) }}</span>
          <NuxtLink
            v-if="event.vdev.disk"
            :to="`/disks/${event.vdev.disk.id}`"
            class="text-highlighted font-sans font-semibold hover:underline"
          >
            {{ event.vdev.disk.alias ?? `#${event.vdev.disk.id}` }}
          </NuxtLink>
        </span>
        <span v-else-if="event.vdevGuid" class="text-dimmed font-mono text-xs">
          vdev {{ event.vdevGuid }}
        </span>
      </div>
      <dl
        v-if="openIds.has(event.id)"
        class="bg-elevated grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 rounded-md px-3 py-2 font-mono text-xs"
        data-testid="pool-event-payload"
      >
        <template v-for="[key, value] in payloadEntries(event.payload)" :key="key">
          <dt class="text-muted">{{ key }}</dt>
          <dd class="text-highlighted break-all">{{ payloadText(value) }}</dd>
        </template>
      </dl>
    </li>
  </ul>
</template>
