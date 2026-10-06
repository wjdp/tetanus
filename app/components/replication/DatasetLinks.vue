<script setup lang="ts">
import type { DatasetReplication } from "#shared/replications";
import {
  REPLICATION_ROLE_VOCABULARY,
  REPLICATION_STATUS_VOCABULARY,
} from "~/utils/vocabulary";

defineProps<{ replications: DatasetReplication[] }>();

const PEER_PREPOSITION = { source: "to", target: "from" } as const;

const peerLabel = ({ peer }: DatasetReplication) => {
  if (!peer) return "unknown";
  return peer.sameHost ? peer.pool : (peer.host.displayName ?? peer.host.name);
};

const peerAddress = ({ peer }: DatasetReplication) =>
  peer
    ? `${peer.host.displayName ?? peer.host.name}:${peer.dataset}`
    : "an unknown source";

const title = (replication: DatasetReplication) =>
  `${REPLICATION_ROLE_VOCABULARY[replication.role].label} ${PEER_PREPOSITION[replication.role]} ${peerAddress(replication)} · ${REPLICATION_STATUS_VOCABULARY[replication.status].label}`;
</script>

<template>
  <span class="inline-flex flex-col items-start">
    <NuxtLink
      v-for="replication in replications"
      :key="`${replication.id}-${replication.role}`"
      :to="`/replications/${replication.id}`"
      :title="title(replication)"
      :aria-label="title(replication)"
      class="hover:bg-elevated text-muted -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm whitespace-nowrap"
      data-testid="dataset-replication"
      :data-role="replication.role"
    >
      <UIcon
        :name="REPLICATION_ROLE_VOCABULARY[replication.role].icon"
        class="size-4 shrink-0"
      />
      <span class="max-w-32 truncate" data-testid="dataset-replication-peer">
        {{ peerLabel(replication) }}
      </span>
      <TopologyStatusDot
        :colour="REPLICATION_STATUS_VOCABULARY[replication.status].colour"
        :shape="REPLICATION_STATUS_VOCABULARY[replication.status].shape"
      />
    </NuxtLink>
  </span>
</template>
