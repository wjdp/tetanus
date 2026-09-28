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

interface PaletteTarget {
  label: string;
  icon: string;
  to: string;
}

const toItem = ({ label, icon, to }: PaletteTarget): CommandPaletteItem => ({
  label,
  icon,
  onSelect: () => goTo(to),
});

const {
  disks,
  pools,
  loading: entitiesLoading,
  load: loadEntities,
} = useEntitySearch();

watch(isOpen, (open) => {
  if (open) loadEntities();
});

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  {
    id: "navigation",
    label: "Go to",
    items: NAVIGATION.map(toItem),
  },
  {
    id: "settings",
    label: "Settings",
    items: SETTINGS_NAVIGATION.map(toItem),
  },
  { id: "disks", label: "Disks", items: (disks.value ?? []).map(toItem) },
  { id: "pools", label: "Pools", items: (pools.value ?? []).map(toItem) },
]);

defineShortcuts({
  meta_k: toggle,
});
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Command palette"
    description="Jump to a page, disk or pool"
    :ui="{
      content: 'top-4 translate-y-0 sm:top-1/2 sm:-translate-y-1/2 sm:max-w-2xl',
    }"
  >
    <template #content>
      <UCommandPalette
        :groups="groups"
        placeholder="Search pages, disks and pools"
        :loading="entitiesLoading"
        close
        class="h-[calc(100dvh-2rem)] sm:h-96"
        @update:open="close"
      />
    </template>
  </UModal>
</template>
