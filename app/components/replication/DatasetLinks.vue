<script setup lang="ts">
import type { DatasetReplication } from "#shared/replications";
import {
  REPLICATION_ROLE_VOCABULARY,
  REPLICATION_STATUS_VOCABULARY,
} from "~/utils/vocabulary";

defineProps<{ replications: DatasetReplication[] }>();

const title = ({ role, status }: DatasetReplication) =>
  `${REPLICATION_ROLE_VOCABULARY[role].label} · ${REPLICATION_STATUS_VOCABULARY[status].label}`;
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1">
    <NuxtLink
      v-for="replication in replications"
      :key="`${replication.id}-${replication.role}`"
      :to="`/replications/${replication.id}`"
      :title="title(replication)"
      :aria-label="title(replication)"
      class="hover:bg-elevated text-muted inline-flex items-center gap-1 rounded px-1 py-0.5"
      data-testid="dataset-replication"
      :data-role="replication.role"
    >
      <UIcon
        :name="REPLICATION_ROLE_VOCABULARY[replication.role].icon"
        class="size-4"
      />
      <TopologyStatusDot
        :colour="REPLICATION_STATUS_VOCABULARY[replication.status].colour"
        :shape="REPLICATION_STATUS_VOCABULARY[replication.status].shape"
      />
    </NuxtLink>
  </span>
</template>
