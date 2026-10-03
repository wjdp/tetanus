<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui";
import { useDatasetSearch } from "~/components/dataset/useDatasetSearch";
import { ENTITY_ICON } from "~/utils/vocabulary";

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
  badge?: CommandPaletteItem["badge"];
}

const toItem = ({
  label,
  icon,
  to,
  badge,
}: PaletteTarget): CommandPaletteItem => ({
  label,
  icon,
  badge,
  onSelect: () => goTo(to),
});

const {
  disks,
  pools,
  loading: entitiesLoading,
  load: loadEntities,
} = useEntitySearch();

const searchTerm = ref("");
const { results: datasets, loading: datasetsLoading } =
  useDatasetSearch(searchTerm);

const datasetItems = computed(() =>
  datasets.value.map((dataset) =>
    toItem({
      label: datasetLabel(dataset),
      icon: ENTITY_ICON.dataset,
      to: `/datasets/${dataset.id}`,
    }),
  ),
);

watch(isOpen, (open) => {
  if (open) loadEntities();
  else searchTerm.value = "";
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
  {
    id: "datasets",
    label: "Datasets",
    items: datasetItems.value,
    ignoreFilter: true,
  },
]);

defineShortcuts({
  meta_k: toggle,
});
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Command palette"
    description="Jump to a page, disk, pool or dataset"
    :ui="{
      content: 'top-4 translate-y-0 sm:top-1/2 sm:-translate-y-1/2 sm:max-w-2xl',
    }"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="searchTerm"
        :groups="groups"
        placeholder="Search pages, disks, pools and datasets"
        :loading="entitiesLoading || datasetsLoading"
        close
        class="h-[calc(100dvh-2rem)] sm:h-96"
        @update:open="close"
      />
    </template>
  </UModal>
</template>
