<script setup lang="ts">
import {
  FAULT_KIND_DEFINITIONS,
  type FaultAction,
  type FaultView,
  faultHint,
  faultTitle,
} from "#shared/faults";
import {
  ENTITY_ICON,
  FAULT_GUTTER_CLASS,
  faultDiskPath,
  faultGutterColour,
  faultHostLabel,
  faultSubjectPath,
} from "~/utils/vocabulary";

const props = defineProps<{
  fault: FaultView;
  now: number;
  upgradeCommand: string;
  perform: (action: FaultAction, note?: string) => Promise<void>;
  hideSubject?: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

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
const subjectPath = computed(() => faultSubjectPath(props.fault.subject, props.fault.kind));
const diskPath = computed(() => faultDiskPath(props.fault));
const title = computed(() => faultTitle(props.fault, props.now));
const hint = computed(() => faultHint(props.fault));
const showsUpgradeCommand = computed(
  () =>
    !isResolved.value &&
    FAULT_KIND_DEFINITIONS[props.fault.kind].upgradeCommand === true,
);

const age = computed(() => {
  const { resolvedAt, openedAt } = props.fault;
  return resolvedAt
    ? `resolved ${formatDuration(props.now - Date.parse(resolvedAt))} ago`
    : `since ${formatDuration(props.now - Date.parse(openedAt))}`;
});

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
      <template v-if="!hideSubject">
        <span class="text-highlighted w-20 shrink-0 truncate font-semibold">
          {{ hostLabel }}
        </span>
        <span class="text-muted w-14 shrink-0 truncate font-mono text-xs">
          {{ subjectLabel }}
        </span>
      </template>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <NuxtLink
          :to="subjectPath ?? undefined"
          data-testid="fault-subject-link"
          class="text-default min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
        >
          {{ title }}
        </NuxtLink>
        <p v-if="hint" class="text-muted text-xs" data-testid="fault-hint">
          {{ hint }}
        </p>
        <NuxtLink
          v-if="diskPath"
          :to="diskPath"
          data-testid="fault-disk-link"
          class="text-muted hover:text-highlighted relative z-10 inline-flex items-center gap-1 self-start text-xs hover:underline"
        >
          <UIcon :name="ENTITY_ICON.disk" class="size-3.5" />
          Disk
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

    <FaultActions
      :fault="fault"
      :perform="perform"
      @changed="emit('changed')"
    />
  </div>
</template>
