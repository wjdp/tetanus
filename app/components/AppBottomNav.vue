<script setup lang="ts">
import { useDashboard } from "@nuxt/ui/utils/dashboard";

const { toggleSidebar } = useDashboard();

const route = useRoute();

const navigationCounts = useNavigationCounts();

const links = computed(() =>
  NAVIGATION.filter(({ bottomNav }) => bottomNav).map((entry) => ({
    label: entry.label,
    icon: entry.icon,
    to: entry.to,
    active: isNavigationActive(entry, route.path),
    chip:
      entry.badge && navigationChipColour(navigationCounts.value[entry.badge]),
  })),
);

const itemClass =
  "flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-xs font-medium";
</script>

<template>
  <nav
    aria-label="Sections"
    class="bg-elevated border-default flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
  >
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      v-slot="{ href, navigate }"
      :to="link.to"
      custom
    >
      <a
        :href="href ?? undefined"
        :aria-current="link.active ? 'page' : undefined"
        :class="[itemClass, link.active ? 'text-highlighted' : 'text-muted']"
        @click="navigate"
      >
        <UChip :show="!!link.chip" :color="link.chip" inset>
          <UIcon :name="link.icon" class="size-5" />
        </UChip>
        {{ link.label }}
      </a>
    </NuxtLink>
    <button
      type="button"
      :class="[itemClass, 'text-muted']"
      @click="toggleSidebar?.()"
    >
      <UIcon name="i-lucide-menu" class="size-5" />
      More
    </button>
  </nav>
</template>
