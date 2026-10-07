<script setup lang="ts">
import { hostPath } from "#shared/entityPaths";
import type { FaultView } from "#shared/faults";
import { ENTITY_ICON, faultSubjectPath } from "~/utils/vocabulary";

const props = defineProps<{
  fault: FaultView;
  columns?: boolean;
}>();

const hostName = computed(() => props.fault.subject.hostName);
const hasSeparateSubject = computed(() => props.fault.subject.type !== "host");
const subjectPath = computed(() =>
  faultSubjectPath(props.fault.subject, props.fault.kind),
);

const LINK_CLASS =
  "text-highlighted relative z-10 inline-flex min-w-0 items-baseline gap-1.5 font-semibold hover:underline";
</script>

<template>
  <NuxtLink
    v-if="hostName"
    :to="hostPath(hostName)"
    data-testid="fault-host"
    :class="[LINK_CLASS, columns ? 'w-28 shrink-0' : 'shrink-0']"
  >
    <UIcon
      :name="ENTITY_ICON.host"
      class="text-dimmed size-3.5 shrink-0 self-center"
    />
    <span class="min-w-0 [overflow-wrap:anywhere]">{{ hostName }}</span>
  </NuxtLink>
  <span v-else-if="columns" class="w-28 shrink-0" />
  <NuxtLink
    v-if="hasSeparateSubject"
    :to="subjectPath ?? undefined"
    data-testid="fault-subject"
    :class="[LINK_CLASS, columns ? 'w-48 shrink-0' : 'shrink-0']"
  >
    <UIcon
      :name="ENTITY_ICON[fault.subject.type]"
      class="text-dimmed size-3.5 shrink-0 self-center"
    />
    <span class="min-w-0 [overflow-wrap:anywhere]">{{ fault.subject.label }}</span>
  </NuxtLink>
  <span v-else-if="columns" class="w-48 shrink-0" />
</template>
