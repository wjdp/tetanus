<script setup lang="ts">
import type { ReplicationStatus } from "#shared/replications";
import {
  REPLICATION_STATUS_VOCABULARY,
  STATUS_TEXT_CLASS,
} from "~/utils/vocabulary";

const props = defineProps<{ status: ReplicationStatus }>();

const vocabulary = computed(() => REPLICATION_STATUS_VOCABULARY[props.status]);
</script>

<template>
  <span class="inline-flex items-center gap-2" :data-status="status">
    <TopologyStatusDot :colour="vocabulary.colour" :shape="vocabulary.shape" />
    <span
      :class="
        vocabulary.colour === 'neutral'
          ? 'text-muted'
          : STATUS_TEXT_CLASS[vocabulary.colour]
      "
    >
      {{ vocabulary.label }}
    </span>
  </span>
</template>
