<script setup lang="ts">
import { formatDuration } from "#shared/hostFreshness";
import type { ReplicationEndpointFacts } from "#shared/replications";
import { formatTimestamp } from "~/components/pool/timestamp";

const props = defineProps<{
  facts: ReplicationEndpointFacts;
  now: number;
}>();

const { formatZfsBytes } = useZfsByteSystem();

const formatRatio = (ratio: number | null) =>
  ratio === null ? "—" : `${ratio.toFixed(2)}×`;

const KEY_STATUS_LABEL: Record<string, string> = {
  available: "key loaded",
  unavailable: "key not loaded",
};

const encryption = computed(() => {
  const { encryption } = props.facts.dataset;
  return encryption && encryption !== "off" ? encryption : "off";
});
const keyStatus = computed(() => {
  const { keyStatus } = props.facts.dataset;
  return keyStatus === null ? null : (KEY_STATUS_LABEL[keyStatus] ?? null);
});

const newestAge = computed(() => {
  const { newest } = props.facts.snapshots;
  return newest
    ? `${formatDuration(props.now - Date.parse(newest.creation))} ago`
    : null;
});
</script>

<template>
  <dl
    class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
    data-testid="endpoint-facts"
  >
    <dt class="text-muted">Pool</dt>
    <dd>
      <PoolStateBadge :pool="facts.pool" size="sm" />
    </dd>
    <dt class="text-muted">Referenced</dt>
    <dd class="text-highlighted tabular">
      {{ formatZfsBytes(facts.dataset.referenced) }}
    </dd>
    <dt class="text-muted">Snapshots</dt>
    <dd class="text-highlighted tabular">
      {{ facts.snapshots.count }}
      <span v-if="facts.dataset.usedBySnapshots !== null" class="text-muted">
        · {{ formatZfsBytes(facts.dataset.usedBySnapshots) }}
      </span>
    </dd>
    <dt class="text-muted">Newest</dt>
    <dd class="text-highlighted min-w-0">
      <template v-if="facts.snapshots.newest">
        <span class="font-mono break-all">{{ facts.snapshots.newest.name }}</span>
        <span class="text-muted"> · {{ newestAge }}</span>
      </template>
      <template v-else>—</template>
    </dd>
    <dt class="text-muted">Available</dt>
    <dd class="text-highlighted tabular">
      {{ formatZfsBytes(facts.dataset.available) }}
    </dd>
    <dt class="text-muted">Compression</dt>
    <dd class="text-highlighted">
      {{ facts.dataset.compression ?? "—" }}
      <span class="text-muted tabular">
        · {{ formatRatio(facts.dataset.compressRatio) }}
      </span>
    </dd>
    <dt class="text-muted">Encryption</dt>
    <dd class="text-highlighted" data-testid="endpoint-encryption">
      {{ encryption }}
      <span v-if="keyStatus" class="text-muted">· {{ keyStatus }}</span>
    </dd>
    <dt class="text-muted">Recordsize</dt>
    <dd class="text-highlighted tabular">
      {{ formatZfsBytes(facts.dataset.recordSize) }}
    </dd>
    <dt v-if="facts.dataset.mountpoint" class="text-muted">Mountpoint</dt>
    <dd v-if="facts.dataset.mountpoint" class="text-highlighted font-mono break-all">
      {{ facts.dataset.mountpoint }}
    </dd>
    <dt class="text-muted">Created</dt>
    <dd class="text-highlighted tabular">
      {{ formatTimestamp(facts.dataset.creation) }}
    </dd>
  </dl>
</template>
