<script setup lang="ts">
import {
  fieldDescription,
  INVENTORY_FIELDS,
  type InventoryKey,
  isFieldVisible,
} from "#shared/inventory-fields";
import type { DiskPatch } from "#shared/schemas/disks";
import { VENDORS, type Vendor } from "#shared/vendor";
import type { InlineItem, InlineValue } from "~/components/inline/InlineField.vue";
import { fleetSuggestions } from "./fleetSuggestions";
import type { DiskDetail, ReplacementCandidate } from "./types";
import { useDiskFieldSave } from "./useDiskFieldSave";

export type EditableFieldKey =
  | "bay"
  | "modelShort"
  | "purpose"
  | "recordingTech"
  | "seagateBpid"
  | "shuckedFrom"
  | "storageLocation"
  | "vendorOverride";

const props = withDefaults(
  defineProps<{
    fieldKey: EditableFieldKey;
    disk: DiskDetail;
    disks?: ReplacementCandidate[];
  }>(),
  { disks: () => [] },
);

const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const SYSTEM_MOUNT_PATHS = ["/", "/boot"];
const BAY_DESCRIPTION =
  "Where the disk sits, as you call it. The label belongs to the place, so a disk moved here takes it.";

const { saving, errors, save, saveWith } = useDiskFieldSave(
  () => props.disk.id,
  (disk) => emit("updated", disk),
);

const inventoryField = computed(() =>
  props.fieldKey === "bay"
    ? null
    : (INVENTORY_FIELDS.find((field) => field.key === props.fieldKey) ?? null),
);

const visible = computed(() => {
  if (props.fieldKey === "bay") return props.disk.bay !== null;
  return inventoryField.value
    ? isFieldVisible(inventoryField.value, props.disk)
    : false;
});

const choicesOf = (values: readonly string[], label = (value: string) => value) => [
  { label: "—", value: null },
  ...values.map((value) => ({ label: label(value), value })),
];

const items = computed<InlineItem[] | undefined>(() => {
  const field = inventoryField.value;
  if (!field || !("values" in field)) return undefined;
  if (field.key === "vendorOverride")
    return choicesOf(VENDORS, (vendor) => vendorLabel(vendor as Vendor) ?? vendor);
  if (field.key === "recordingTech")
    return choicesOf(field.values, (value) => value.toUpperCase());
  return choicesOf(field.values);
});

const suggestions = computed(() =>
  props.fieldKey === "storageLocation" || props.fieldKey === "shuckedFrom"
    ? fleetSuggestions(props.disks, props.fieldKey)
    : undefined,
);

const value = computed<InlineValue>(() => {
  if (props.fieldKey === "bay") return props.disk.bay?.label ?? null;
  return props.disk.inventory[props.fieldKey as InventoryKey] ?? null;
});

const saveBay = (label: InlineValue) => {
  const { bay, id, lastSeenHostId } = props.disk;
  if (!bay || lastSeenHostId === null) return;
  return saveWith("bay", async () => {
    await $fetch(`/api/hosts/${lastSeenHostId}/bays`, {
      method: "PATCH",
      body: { [bay.locationKey]: label === null ? null : String(label) },
    });
    return await $fetch<DiskDetail>(`/api/disks/${id}`);
  });
};

const commit = (next: InlineValue) =>
  props.fieldKey === "bay"
    ? saveBay(next)
    : save(props.fieldKey, {
        inventory: { [props.fieldKey]: next },
      } as DiskPatch);

const vendorOverridden = computed(() => {
  const override = props.disk.inventory.vendorOverride;
  return Boolean(override) && override !== props.disk.detectedVendor;
});

const inferredFromPath = computed(() => {
  const paths = props.disk.usage.mounts.map((mount) => mount.path);
  return SYSTEM_MOUNT_PATHS.find((path) => paths.includes(path)) ?? "/";
});

const modelShortSource = computed(() =>
  props.disk.specs?.line && props.disk.modelShort === props.disk.specs.line
    ? "from spec line"
    : "from model",
);

const resolvedRecording = computed(() =>
  knownRecordingTech(props.disk.recordingTech)?.toUpperCase() ?? null,
);

const recordingInferred = computed(
  () =>
    props.disk.hardware?.recordingTechInferred === true &&
    !props.disk.inventory.recordingTech,
);
</script>

<template>
  <InlineField
    v-if="visible"
    :type="inventoryField?.type ?? 'text'"
    :label="inventoryField?.label ?? 'Bay'"
    :description="inventoryField ? fieldDescription(inventoryField) : BAY_DESCRIPTION"
    :value="value"
    :items="items"
    :suggestions="suggestions"
    :saving="saving[fieldKey]"
    :error="errors[fieldKey]"
    :data-field="fieldKey"
    @commit="commit"
  >
    <template v-if="fieldKey === 'bay' && disk.bay" #display="{ text }">
      <span
        v-if="text"
        class="truncate"
        :class="{ 'text-dimmed': !disk.present }"
        :title="disk.present ? undefined : 'last known'"
        >{{ text }}</span
      >
      <span
        v-else
        class="text-dimmed truncate"
        :title="disk.bay.locationKey"
        data-testid="bay-default"
        >{{ disk.bay.defaultLabel }}</span
      >
    </template>
    <template v-else-if="fieldKey === 'purpose'" #display>
      <UBadge
        v-if="disk.purpose"
        color="neutral"
        :variant="disk.purposeInferred ? 'outline' : 'subtle'"
        :label="disk.purpose"
      />
      <span v-else class="text-dimmed">—</span>
    </template>
    <template v-else-if="fieldKey === 'vendorOverride'" #display>
      <span v-if="disk.vendor">{{ vendorLabel(disk.vendor) }}</span>
      <span v-else class="text-dimmed">—</span>
    </template>
    <template v-else-if="fieldKey === 'modelShort'" #display="{ text }">
      <span v-if="text" class="truncate">{{ text }}</span>
      <span
        v-else-if="disk.modelShort"
        class="text-dimmed truncate"
        :title="modelShortSource"
        data-testid="model-short-fallback"
        >{{ disk.modelShort }}</span
      >
      <span v-else class="text-dimmed">—</span>
    </template>
    <template v-else-if="fieldKey === 'recordingTech'" #display="{ text }">
      <span v-if="text">{{ text }}</span>
      <span v-else-if="resolvedRecording">
        {{ resolvedRecording }}
        <span
          v-if="recordingInferred"
          class="text-dimmed"
          title="Inferred from TRIM support"
          >inferred</span
        >
      </span>
      <span v-else class="text-dimmed">—</span>
    </template>

    <template v-if="fieldKey === 'purpose' && disk.purpose && disk.purposeInferred" #hint>
      inferred from mount at {{ inferredFromPath }}
    </template>
    <template v-else-if="fieldKey === 'vendorOverride' && vendorOverridden" #hint>
      detected as {{ vendorLabel(disk.detectedVendor) ?? "unknown" }}
    </template>
  </InlineField>
</template>
