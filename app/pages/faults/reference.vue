<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  FAULT_CATEGORIES,
  FAULT_KIND_DEFINITIONS,
  FAULT_KINDS,
  type FaultAction,
  type FaultCategory,
  type FaultSeverity,
} from "#shared/faults";
import { ENTITY_ICON } from "~/utils/vocabulary";

useSeoMeta({ title: getPageTitle("Fault reference") });

const CATEGORY_HEADINGS: Record<FaultCategory, string> = {
  disk: "Disks",
  zfs: "ZFS",
  host: "Hosts",
};

const SEVERITY_MEANINGS: Record<FaultSeverity, string> = {
  error: "While open, counted in the nav badge and shown in a banner.",
  warning: "While open, counted in the nav badge. No banner.",
};

const ACTION_MEANINGS: Record<FaultAction, string> = {
  acknowledge:
    "Marks the fault as seen. It shows amber and is not counted. Reopens if the severity rises or the condition worsens.",
  accept:
    "Marks the condition as expected for this subject. It shows no colour, is not counted and leaves the default view. Reopens if the severity rises or the condition worsens.",
  clear:
    "Reverts the fault to its initial state.",
  resolve:
    "Close a fault that can't be automatically resolved. A recurrence opens a new fault.",
};

const sections = FAULT_CATEGORIES.map((category) => ({
  category,
  heading: CATEGORY_HEADINGS[category],
  kinds: FAULT_KINDS.filter(
    (kind) => FAULT_KIND_DEFINITIONS[kind].category === category,
  ).map((kind) => ({ kind, ...FAULT_KIND_DEFINITIONS[kind] })),
}));
</script>

<template>
  <AppPanel title="Fault reference" class="flex max-w-4xl flex-col gap-8">
    <header class="flex flex-col gap-2">
      <ULink to="/faults" class="text-muted flex items-center gap-1 text-sm">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        Faults
      </ULink>
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Fault reference
      </h1>
      <p class="text-muted text-sm">
        Unless the entry says otherwise, a fault resolves on the first
        detection pass that no longer reports it.
      </p>
    </header>

    <section class="flex flex-col gap-3" data-testid="fault-severities">
      <h2 class="text-highlighted text-lg font-semibold">Severities</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <template v-for="(meaning, severity) in SEVERITY_MEANINGS" :key="severity">
          <dt>
            <UBadge :color="severity" variant="subtle" size="sm">
              {{ severity }}
            </UBadge>
          </dt>
          <dd class="text-muted">{{ meaning }}</dd>
        </template>
      </dl>
    </section>

    <section class="flex flex-col gap-3" data-testid="fault-actions">
      <h2 class="text-highlighted text-lg font-semibold">Actions</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <template v-for="(meaning, action) in ACTION_MEANINGS" :key="action">
          <dt><FaultActionBadge :action="action" /></dt>
          <dd class="text-muted">{{ meaning }}</dd>
        </template>
      </dl>
    </section>

    <section
      v-for="section in sections"
      :key="section.category"
      class="flex flex-col gap-3"
    >
      <h2 class="text-highlighted text-lg font-semibold">
        {{ section.heading }}
      </h2>
      <article
        v-for="entry in section.kinds"
        :id="entry.kind"
        :key="entry.kind"
        class="border-default flex scroll-mt-4 flex-col gap-2 rounded-lg border p-4 target:ring-2 target:ring-primary"
        data-testid="fault-kind"
      >
        <header class="flex flex-wrap items-baseline gap-2">
          <UIcon
            :name="ENTITY_ICON[entry.subjectType]"
            class="text-dimmed size-4 shrink-0 self-center"
            :aria-label="entry.subjectType"
          />
          <h3 class="text-highlighted font-semibold">{{ entry.label }}</h3>
          <code class="text-dimmed text-xs">{{ entry.kind }}</code>
          <div class="ms-auto flex gap-1 self-center">
            <UBadge
              v-for="severity in entry.severities"
              :key="severity"
              :color="severity"
              variant="subtle"
              size="sm"
            >
              {{ severity }}
            </UBadge>
          </div>
        </header>
        <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
          <dt class="text-muted">Trigger</dt>
          <dd>{{ entry.trigger }}</dd>
          <dt class="text-muted">Resolution</dt>
          <dd>{{ entry.resolves }}</dd>
          <template v-if="entry.settings?.length">
            <dt class="text-muted">Settings</dt>
            <dd>{{ entry.settings.join(", ") }}</dd>
          </template>
          <dt class="text-muted">Actions</dt>
          <dd class="flex flex-wrap gap-1">
            <FaultActionBadge
              v-for="action in entry.actions"
              :key="action"
              :action="action"
            />
          </dd>
        </dl>
      </article>
    </section>
  </AppPanel>
</template>
