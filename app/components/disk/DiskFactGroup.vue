<script setup lang="ts">
defineProps<{ title: string }>();

defineSlots<{
  default(): unknown;
  actions?(): unknown;
  footer?(): unknown;
}>();
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3">
    <div class="flex min-h-7 items-center justify-between gap-2">
      <h3 class="text-muted text-sm font-medium">{{ title }}</h3>
      <slot name="actions" />
    </div>
    <dl
      class="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <slot />
    </dl>
    <slot name="footer" />
  </section>
</template>
