<script setup lang="ts">
import { isWhiteLabel } from "#shared/inventory-fields";
import { displayModel } from "#shared/model";
import { needsBpid } from "#shared/warranty-links";
import { DEVICE_STATUS_VOCABULARY } from "~/utils/vocabulary";
import { displayName } from "./displayName";
import type { DiskDetail } from "./types";
import { useDiskFieldSave } from "./useDiskFieldSave";

const props = withDefaults(
  defineProps<{ disk: DiskDetail; replacesLabel?: string | null }>(),
  { replacesLabel: null },
);
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const name = computed(() => displayName(props.disk));

const bpidMissing = computed(
  () => !props.disk.disposal && needsBpid(props.disk),
);

const pinNote = computed(
  () => isWhiteLabel(props.disk.specs) && props.disk.inventory.pin33Taped == null,
);

const smartStatus = computed(
  () => DEVICE_STATUS_VOCABULARY[props.disk.latestStatus],
);

const { saving, errors, save } = useDiskFieldSave(
  () => props.disk.id,
  (updated) => emit("updated", updated),
);

const saveAlias = (alias: unknown) =>
  save("alias", { alias: typeof alias === "string" ? alias : null });
</script>

<template>
  <header class="flex flex-col gap-4">
    <div class="flex min-w-0 flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">
        <InlineField
          type="alias"
          :value="disk.alias"
          aria-label="Alias"
          :saving="saving.alias"
          :error="errors.alias"
          data-testid="nameplate-alias"
          @commit="saveAlias"
        >
          <template #display>
            <span
              class="truncate"
              :class="name ? 'text-highlighted' : 'text-dimmed italic'"
              >{{ name ?? "unnamed" }}</span
            >
          </template>
        </InlineField>
      </h1>
      <p class="text-muted flex flex-wrap items-center gap-1.5">
        <MediaGlyph :media="disk.media" :size="20" class="text-muted" />
        {{ displayModel(disk.model, disk.vendor) ?? "Unknown model" }}
        <span v-if="disk.serial" class="text-default font-mono text-sm">
          · {{ disk.serial }}
        </span>
        <span
          v-if="disk.inventory.seagateBpid"
          class="text-default font-mono text-sm"
          data-testid="nameplate-bpid"
        >
          · BPID {{ disk.inventory.seagateBpid }}
        </span>
        <span
          v-else-if="bpidMissing"
          class="text-warning text-sm"
          title="Seagate's warranty checker asks for the BPID printed on the drive label"
          data-testid="nameplate-needs-bpid"
        >
          · BPID not recorded
        </span>
      </p>
      <p
        v-if="pinNote"
        class="text-muted flex items-center gap-1.5 text-sm"
        data-testid="nameplate-pin-note"
      >
        <UIcon name="i-lucide-plug-zap" class="size-4" />
        White-label drive: it may need the 3.3 V pin masked to power up in a
        standard bay.
      </p>
      <p
        v-if="disk.replacesDiskId"
        class="text-muted flex items-center gap-1.5 text-sm"
        data-testid="nameplate-replaces"
      >
        <UIcon name="i-lucide-replace" class="size-4" />
        Replaces
        <NuxtLink
          :to="`/disks/${disk.replacesDiskId}`"
          class="text-default hover:text-primary font-medium"
        >
          {{ replacesLabel ?? "another disk" }}
        </NuxtLink>
      </p>
    </div>

    <div
      class="flex items-center gap-x-4 gap-y-2 overflow-x-auto sm:flex-wrap"
      data-testid="status-strip"
    >
      <NuxtLink
        :to="{ query: { tab: 'smart' } }"
        class="shrink-0"
        data-testid="nameplate-smart-status"
      >
        <UBadge color="neutral" variant="outline" :label="smartStatus.label">
          <template #leading>
            <TopologyStatusDot
              :colour="smartStatus.colour"
              :shape="smartStatus.shape"
            />
          </template>
        </UBadge>
      </NuxtLink>
      <DiskStateControl
        :disk="disk"
        class="shrink-0"
        @updated="emit('updated', $event)"
      />
      <DiskPoolBreadcrumb
        v-if="disk.membership"
        :membership="disk.membership"
        show-state
        class="shrink-0"
      />
      <DiskFaultBadges
        :disk-id="disk.id"
        :counts="disk.faultCounts"
        class="shrink-0"
      />
    </div>
  </header>
</template>
