<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui";

const { isOpen, close, toggle } = useCommandPalette();

// Items navigate through `onSelect` rather than `to`: a link item picks up the
// route-active styling, which reads as a second highlight next to the keyboard
// one whenever the palette lists the page you are already on.
const goTo = (to: string) => {
  close();
  return navigateTo(to);
};

const groups: CommandPaletteGroup<CommandPaletteItem>[] = [
  {
    id: "navigation",
    label: "Go to",
    items: NAVIGATION.map(({ label, icon, to }) => ({
      label,
      icon,
      onSelect: () => goTo(to),
    })),
  },
  {
    id: "settings",
    label: "Settings",
    items: SETTINGS_NAVIGATION.map(({ label, icon, to }) => ({
      label,
      icon,
      onSelect: () => goTo(to),
    })),
  },
];

defineShortcuts({
  meta_k: toggle,
});
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Command palette"
    description="Jump to a page"
    :ui="{
      content: 'top-4 translate-y-0 sm:top-1/2 sm:-translate-y-1/2 sm:max-w-2xl',
    }"
  >
    <template #content>
      <UCommandPalette
        :groups="groups"
        placeholder="Search pages"
        close
        class="h-[calc(100dvh-2rem)] sm:h-96"
        @update:open="close"
      />
    </template>
  </UModal>
</template>
