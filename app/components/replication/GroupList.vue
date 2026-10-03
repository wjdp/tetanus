<script setup lang="ts">
import type { ReplicationRow } from "#shared/replications";
import { REPLICATION_STATUS_VOCABULARY } from "~/utils/vocabulary";
import { groupReplications } from "./groups";

const props = defineProps<{ rows: ReplicationRow[]; now: number }>();

const groups = computed(() => groupReplications(props.rows));
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="replication-groups">
    <section
      v-for="group in groups"
      :key="group.key"
      class="flex flex-col gap-1"
      data-testid="replication-group"
      :data-status="group.status"
    >
      <h3
        class="text-toned flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold"
      >
        <TopologyStatusDot
          :colour="REPLICATION_STATUS_VOCABULARY[group.status].colour"
          :shape="REPLICATION_STATUS_VOCABULARY[group.status].shape"
        />
        <template v-if="group.source">
          <span>{{ group.source.host }}</span>
          <span class="font-mono font-normal">{{ group.source.parent }}</span>
        </template>
        <span v-else class="text-dimmed font-normal">source not monitored</span>
        <UIcon name="i-lucide-arrow-right" class="text-dimmed size-4" />
        <span>{{ group.target.host }}</span>
        <span class="font-mono font-normal">{{ group.target.parent }}</span>
        <span class="text-dimmed tabular font-normal">
          {{ group.rows.length }}
        </span>
      </h3>
      <ReplicationTable :rows="group.rows" :now="now" />
    </section>
  </div>
</template>
