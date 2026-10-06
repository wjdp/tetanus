<script setup lang="ts">
import { ENTITY_ICON, faultSubjectPath } from "~/utils/vocabulary";
import { faultCountLabel, summariseSubjectFaults } from "./faultSummary";

const props = defineProps<{ hostName: string; now: number }>();

const { faults, perform, refresh } = useFaults(() => ({
  host: props.hostName,
}));

const hostFaults = computed(() =>
  faults.value.filter((fault) => fault.subject.type === "host"),
);
const subjectSummaries = computed(() => summariseSubjectFaults(faults.value));
</script>

<template>
  <div v-if="faults.length" class="flex flex-col gap-3">
    <FaultList
      v-if="hostFaults.length"
      :faults="hostFaults"
      :now="now"
      :perform="perform"
      data-testid="host-faults"
      @changed="refresh"
    />

    <section
      v-if="subjectSummaries.length"
      class="border-default flex flex-col gap-2 rounded-md border p-3"
      data-testid="subject-fault-summary"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-highlighted text-sm font-semibold">
          On this host's disks, pools and replications
        </h2>
        <ULink
          :to="{ path: '/faults', query: { host: hostName } }"
          class="text-muted hover:text-primary text-sm"
        >
          View all
        </ULink>
      </div>
      <ul class="flex flex-col gap-1 text-sm">
        <li
          v-for="summary in subjectSummaries"
          :key="`${summary.subject.type}:${summary.subject.id}`"
          class="flex items-center gap-2"
        >
          <UIcon
            :name="ENTITY_ICON[summary.subject.type]"
            class="text-dimmed size-4 shrink-0"
          />
          <NuxtLink
            :to="faultSubjectPath(summary.subject) ?? undefined"
            class="text-highlighted hover:text-primary truncate"
          >
            {{ summary.subject.label }}
          </NuxtLink>
          <span
            class="tabular ms-auto shrink-0"
            :class="summary.errors ? 'text-error' : 'text-warning'"
          >
            {{ faultCountLabel(summary) }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
