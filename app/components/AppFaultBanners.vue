<script setup lang="ts">
import { upgradeCommand } from "#shared/collector";
import {
  FAULT_KIND_DEFINITIONS,
  type FaultView,
  faultTitle,
} from "#shared/faults";
import { faultHostLabel } from "~/utils/vocabulary";

const BANNER_LIMIT = 3;

const { faults, acknowledge } = useFaults(OPEN_ERRORS_QUERY);
const copyToClipboard = useCopyToClipboard();
const toast = useToast();
const command = upgradeCommand(useRequestURL().origin);

const shown = computed(() => faults.value.slice(0, BANNER_LIMIT));
const overflow = computed(() => faults.value.length - shown.value.length);

const hasUpgradeCommand = (fault: FaultView) =>
  FAULT_KIND_DEFINITIONS[fault.kind].upgradeCommand === true;

const acknowledgeFault = async (fault: FaultView) => {
  try {
    await acknowledge(fault.id);
  } catch {
    toast.add({ title: "Could not acknowledge the fault", color: "error" });
  }
};
</script>

<template>
  <section
    v-if="faults.length"
    aria-label="Faults"
    class="bg-elevated border-default divide-default divide-y border-b"
  >
    <div
      v-for="fault in shown"
      :key="fault.id"
      data-testid="fault-banner"
      class="border-s-error flex min-w-0 items-start gap-3 border-s-[3px] py-2.5 ps-4 pe-2 sm:items-center"
    >
      <div
        class="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-baseline"
      >
        <p class="flex min-w-0 gap-3 text-sm">
          <span class="text-highlighted shrink-0 font-semibold sm:min-w-14">
            {{ faultHostLabel(fault) }}
          </span>
          <span class="text-default">{{ faultTitle(fault) }}</span>
        </p>
        <button
          v-if="hasUpgradeCommand(fault)"
          type="button"
          class="bg-muted border-default text-toned hover:text-highlighted hover:border-accented focus-visible:ring-primary group inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2 py-0.5 text-start font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="`Copy upgrade command for ${faultHostLabel(fault)}`"
          @click="copyToClipboard(command, 'Upgrade command')"
        >
          <code class="truncate">{{ command }}</code>
          <UIcon
            name="i-lucide-copy"
            class="text-dimmed group-hover:text-highlighted size-3.5 shrink-0"
          />
        </button>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-eye"
        label="Acknowledge"
        class="shrink-0"
        @click="acknowledgeFault(fault)"
      />
    </div>
    <NuxtLink
      v-if="overflow > 0"
      to="/faults"
      data-testid="fault-banner-overflow"
      class="text-muted hover:text-highlighted flex items-center gap-1.5 py-2 ps-[calc(1rem+3px)] text-sm"
    >
      and {{ overflow }} more
      <UIcon name="i-lucide-arrow-right" class="size-3.5" />
      Faults
    </NuxtLink>
  </section>
</template>
