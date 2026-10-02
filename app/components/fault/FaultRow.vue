<script setup lang="ts">
import {
  allowedActions,
  FAULT_KIND_DEFINITIONS,
  type FaultAction,
  type FaultView,
  faultTitle,
} from "#shared/faults";
import type { AcceptanceKind } from "#shared/smart/status";
import { ACCEPTANCE_KIND_VOCABULARY } from "~/components/disk/attributeRows";
import {
  FAULT_GUTTER_CLASS,
  faultGutterColour,
  faultHostLabel,
  faultSubjectPath,
} from "~/utils/vocabulary";

const props = defineProps<{
  fault: FaultView;
  now: number;
  upgradeCommand: string;
  perform: (action: FaultAction, note?: string) => Promise<void>;
}>();

const emit = defineEmits<{ review: [kind: AcceptanceKind] }>();

const copyToClipboard = useCopyToClipboard();

const gutterColour = computed(() => faultGutterColour(props.fault));
const gutterClass = computed(() =>
  gutterColour.value
    ? FAULT_GUTTER_CLASS[gutterColour.value]
    : "border-s-transparent",
);
const isResolved = computed(() => props.fault.state === "resolved");
const hostLabel = computed(() => faultHostLabel(props.fault));
const subjectLabel = computed(() =>
  props.fault.subject.type === "host" ? "" : props.fault.subject.label,
);
const subjectPath = computed(() => faultSubjectPath(props.fault.subject));
const title = computed(() => faultTitle(props.fault, props.now));
const showsUpgradeCommand = computed(
  () =>
    !isResolved.value &&
    FAULT_KIND_DEFINITIONS[props.fault.kind].upgradeCommand === true,
);
const opensAcceptanceDialog = computed(
  () => props.fault.kind === "smart-attribute",
);

const age = computed(() => {
  const { resolvedAt, openedAt } = props.fault;
  return resolvedAt
    ? `resolved ${formatDuration(props.now - Date.parse(resolvedAt))} ago`
    : `since ${formatDuration(props.now - Date.parse(openedAt))}`;
});

const noteActions = computed(() =>
  allowedActions(props.fault).filter(
    (action): action is AcceptanceKind => action !== "clear",
  ),
);
const canClear = computed(() =>
  allowedActions(props.fault).includes("clear"),
);
</script>

<template>
  <div
    data-testid="fault-row"
    :data-state="fault.state"
    class="hover:bg-elevated/50 relative flex min-w-0 items-start gap-3 border-s-[3px] py-2.5 ps-4 pe-3 sm:items-center"
    :class="[gutterClass, { 'opacity-60': isResolved }]"
  >
    <div
      class="flex min-w-0 flex-1 flex-col gap-x-3 gap-y-1 text-sm sm:flex-row sm:items-baseline"
    >
      <span class="text-highlighted w-20 shrink-0 truncate font-semibold">
        {{ hostLabel }}
      </span>
      <span class="text-muted w-14 shrink-0 truncate font-mono text-xs">
        {{ subjectLabel }}
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <NuxtLink
          :to="subjectPath"
          data-testid="fault-subject-link"
          class="text-default min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
        >
          {{ title }}
        </NuxtLink>
        <p v-if="fault.note" class="text-muted text-xs" data-testid="fault-note">
          <UIcon name="i-lucide-message-square" class="me-1 size-3 align-[-1px]" />
          {{ fault.note }}
        </p>
        <button
          v-if="showsUpgradeCommand"
          type="button"
          class="bg-muted border-default text-toned hover:text-highlighted hover:border-accented focus-visible:ring-primary group relative z-10 inline-flex min-w-0 max-w-full items-center gap-2 self-start rounded-md border px-2 py-0.5 text-start font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="`Copy upgrade command for ${hostLabel}`"
          @click="copyToClipboard(upgradeCommand, 'Upgrade command')"
        >
          <code class="truncate">{{ upgradeCommand }}</code>
          <UIcon
            name="i-lucide-copy"
            class="text-dimmed group-hover:text-highlighted size-3.5 shrink-0"
          />
        </button>
      </div>
      <span class="text-muted shrink-0 text-xs whitespace-nowrap tabular-nums">
        {{ age }}
      </span>
    </div>

    <div
      v-if="noteActions.length || canClear"
      class="relative z-10 flex shrink-0 justify-end gap-1"
    >
      <template v-for="action in noteActions" :key="action">
        <UButton
          v-if="opensAcceptanceDialog"
          color="neutral"
          variant="soft"
          size="xs"
          :label="ACCEPTANCE_KIND_VOCABULARY[action].action"
          @click="emit('review', action)"
        />
        <FaultNoteAction
          v-else
          :label="ACCEPTANCE_KIND_VOCABULARY[action].action"
          :placeholder="ACCEPTANCE_KIND_VOCABULARY[action].notePlaceholder"
          :confirm="(note) => perform(action, note)"
        />
      </template>
      <UButton
        v-if="canClear"
        color="neutral"
        variant="ghost"
        size="xs"
        label="Clear"
        @click="perform('clear')"
      />
    </div>
  </div>
</template>
