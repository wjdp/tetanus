<script setup lang="ts">
defineProps<{ title: string }>();

defineSlots<{
  default(): unknown;
  actions?(): unknown;
  footer?(): unknown;
}>();
</script>

<template>
  <section
    class="border-default flex min-w-0 break-inside-avoid flex-col gap-3 rounded-lg border p-4"
  >
    <div class="flex min-h-7 items-center justify-between gap-2">
      <h2 class="text-highlighted font-semibold">{{ title }}</h2>
      <slot name="actions" />
    </div>
    <dl
      class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <slot />
    </dl>
    <slot name="footer" />
  </section>
</template>
