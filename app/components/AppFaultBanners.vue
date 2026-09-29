<script setup lang="ts">
const { faults, dismiss } = useFaults();
const copyToClipboard = useCopyToClipboard();
</script>

<template>
  <section
    v-if="faults.length"
    aria-label="Faults"
    class="bg-elevated border-default divide-default divide-y border-b"
  >
    <div
      v-for="fault in faults"
      :key="fault.id"
      class="border-s-error flex min-w-0 items-start gap-3 border-s-[3px] py-2.5 ps-4 pe-2 sm:items-center"
    >
      <div
        class="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-baseline"
      >
        <p class="flex min-w-0 gap-3 text-sm">
          <span class="text-highlighted shrink-0 font-semibold sm:min-w-14">
            {{ fault.host }}
          </span>
          <span class="text-default">{{ fault.title }}</span>
        </p>
        <button
          v-if="fault.command"
          type="button"
          class="bg-muted border-default text-toned hover:text-highlighted hover:border-accented focus-visible:ring-primary group inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2 py-0.5 text-start font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="`Copy upgrade command for ${fault.host}`"
          @click="copyToClipboard(fault.command, 'Upgrade command')"
        >
          <code class="truncate">{{ fault.command }}</code>
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
        icon="i-lucide-x"
        aria-label="Close"
        class="shrink-0"
        @click="dismiss(fault.id)"
      />
    </div>
  </section>
</template>
