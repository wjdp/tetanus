<script setup lang="ts">
import type { WarrantyCheck } from "#shared/warranty-links";

const props = defineProps<{ check: WarrantyCheck; vendorName: string | null }>();

const copyToClipboard = useCopyToClipboard();

const entries = computed(() => Object.entries(props.check.copy));
</script>

<template>
  <UPopover :content="{ align: 'start' }">
    <UButton
      size="xs"
      variant="link"
      color="neutral"
      icon="i-lucide-shield-check"
      label="Check warranty"
      data-testid="warranty-check"
    />
    <template #content>
      <div class="flex max-w-xs flex-col gap-3 p-3 text-sm" data-testid="warranty-check-panel">
        <dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
          <template v-for="[label, value] in entries" :key="label">
            <dt class="text-muted">{{ label }}</dt>
            <dd class="truncate font-mono">{{ value }}</dd>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-copy"
              :aria-label="`Copy ${label}`"
              @click="copyToClipboard(value, label)"
            />
          </template>
        </dl>
        <p v-if="check.note" class="text-muted">{{ check.note }}</p>
        <ULink
          :to="check.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary inline-flex items-center gap-1 font-medium"
          data-testid="warranty-check-link"
        >
          {{ vendorName ? `Open ${vendorName} warranty page` : "Open warranty page" }}
          <UIcon name="i-lucide-external-link" class="size-3.5" />
        </ULink>
      </div>
    </template>
  </UPopover>
</template>
