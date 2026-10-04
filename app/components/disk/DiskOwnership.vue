<script setup lang="ts">
import {
  fieldDescription,
  fieldGroup,
  INVENTORY_FIELDS,
  type InventoryKey,
  isFieldVisible,
  suggestsFleetValues,
} from "#shared/inventory-fields";
import { formatMoneyPerTb } from "#shared/money";
import type { DiskPatch } from "#shared/schemas/disks";
import { effectiveWarranty, warrantySuggestion } from "#shared/warranty";
import { warrantyCheckUrl } from "#shared/warranty-links";
import type { InlineItem, InlineValue } from "~/components/inline/InlineField.vue";
import { warrantyClass } from "~/components/inventory/types";
import { diskLabel } from "./displayName";
import { fleetSuggestions } from "./fleetSuggestions";
import type { DiskDetail, ReplacementCandidate } from "./types";
import { useDiskFieldSave } from "./useDiskFieldSave";

const props = withDefaults(
  defineProps<{
    disk: DiskDetail;
    disks?: ReplacementCandidate[];
  }>(),
  { disks: () => [] },
);
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const PIN_ITEMS: InlineItem[] = [
  { label: "—", value: null },
  { label: "taped", value: true },
  { label: "not taped", value: false },
];

const currency = useCurrency();
const { saving, errors, save } = useDiskFieldSave(
  () => props.disk.id,
  (disk) => emit("updated", disk),
);

const fields = computed(() =>
  INVENTORY_FIELDS.filter(
    (field) =>
      fieldGroup(field) === "ownership" && isFieldVisible(field, props.disk),
  ),
);

type OwnershipField = (typeof fields.value)[number];

const itemsFor = (field: OwnershipField): InlineItem[] | undefined => {
  if (field.key === "pin33Taped") return PIN_ITEMS;
  if (!("values" in field)) return undefined;
  return [
    { label: "—", value: null },
    ...field.values.map((value) => ({ label: value, value })),
  ];
};

const suggestionsFor = (field: OwnershipField) =>
  field.type === "tags" || suggestsFleetValues(field)
    ? fleetSuggestions(props.disks, field.key)
    : undefined;

const inventoryValue = (key: InventoryKey): InlineValue =>
  props.disk.inventory[key] ?? null;

const saveInventory = (key: InventoryKey, value: InlineValue) =>
  save(key, { inventory: { [key]: value } } as DiskPatch);

const ageHint = computed(() =>
  props.disk.ageDays === null ? undefined : `${formatDays(props.disk.ageDays)} old`,
);

const pricePerTbHint = computed(() => {
  const perTb = formatMoneyPerTb(
    props.disk.inventory.purchasePrice ?? null,
    props.disk.capacityBytes,
    currency.value,
  );
  return perTb ? `${perTb}/TB` : undefined;
});

const warrantyLeft = computed(() => {
  const days = props.disk.warrantyDaysLeft;
  if (days === null) return null;
  return {
    text: days < 0 ? `expired ${formatDays(-days)} ago` : `${formatDays(days)} left`,
    class: warrantyClass(days) || undefined,
  };
});

const hintFor = (key: InventoryKey) => {
  if (key === "purchaseDate") return ageHint.value;
  if (key === "purchasePrice") return pricePerTbHint.value;
  return undefined;
};

const replacementCandidates = computed(() =>
  props.disks.filter(
    (candidate) =>
      candidate.id !== props.disk.id &&
      (candidate.id === props.disk.replacesDiskId ||
        (candidate.disposal?.kind === "rma" &&
          (candidate.replacedByDiskId === null ||
            candidate.replacedByDiskId === props.disk.id))),
  ),
);

const replacesItems = computed<InlineItem[]>(() => [
  { label: "—", value: null },
  ...replacementCandidates.value.map((candidate) => ({
    label: diskLabel(candidate),
    value: candidate.id,
  })),
]);

const replaced = computed(() =>
  replacementCandidates.value.find(
    (candidate) => candidate.id === props.disk.replacesDiskId,
  ),
);

const warrantyCheck = computed(() =>
  props.disk.disposal ? null : warrantyCheckUrl(props.disk),
);

const blankWarranty = computed(() => !props.disk.inventory.warrantyExpiry);

const countdownKey = computed<InventoryKey | null>(() => {
  const warranty = effectiveWarranty(props.disk.inventory);
  if (!warranty) return null;
  return warranty.source === "seller" ? "sellerWarrantyExpiry" : "warrantyExpiry";
});

const suggestedWarranty = computed(() =>
  warrantySuggestion(props.disk.inventory, props.disk.specs?.line),
);

const copyableWarranty = computed(() =>
  blankWarranty.value ? (replaced.value?.inventory.warrantyExpiry ?? null) : null,
);

const showsCountdown = (key: InventoryKey) =>
  warrantyLeft.value !== null && key === countdownKey.value;

const showsWarrantyHint = (key: InventoryKey) =>
  showsCountdown(key) ||
  (key === "warrantyExpiry" &&
    (suggestedWarranty.value !== null || copyableWarranty.value !== null));
</script>

<template>
  <DiskFactGroup title="Ownership" data-testid="group-ownership">
    <template v-if="warrantyCheck" #actions>
      <DiskWarrantyCheck
        :check="warrantyCheck"
        :vendor-name="vendorLabel(disk.vendor)"
      />
    </template>
    <InlineField
      v-for="field in fields"
      :key="field.key"
      :type="field.key === 'pin33Taped' ? 'enum' : field.type"
      :label="field.label"
      :description="fieldDescription(field)"
      :value="inventoryValue(field.key)"
      :items="itemsFor(field)"
      :suggestions="suggestionsFor(field)"
      :placeholder="field.key === 'pin33Taped' ? 'not recorded' : undefined"
      :hint="hintFor(field.key)"
      :saving="saving[field.key]"
      :error="errors[field.key]"
      :data-field="field.key"
      @commit="saveInventory(field.key, $event)"
    >
      <template v-if="showsWarrantyHint(field.key)" #hint>
        <span
          v-if="warrantyLeft && showsCountdown(field.key)"
          :class="warrantyLeft.class"
          data-testid="warranty-left"
          >{{ warrantyLeft.text }}</span
        >
        <span
          v-else-if="suggestedWarranty && field.key === 'warrantyExpiry'"
          data-testid="warranty-suggestion"
        >
          {{ suggestedWarranty.text }}
          <UButton
            size="xs"
            color="neutral"
            variant="link"
            label="Apply"
            class="p-0"
            @click="saveInventory('warrantyExpiry', suggestedWarranty.date)"
          />
        </span>
        <UButton
          v-if="copyableWarranty && replaced && field.key === 'warrantyExpiry'"
          size="xs"
          color="neutral"
          variant="link"
          class="p-0"
          :label="`Copy from ${diskLabel(replaced)}`"
          :title="`Warranty until ${copyableWarranty}`"
          data-testid="warranty-copy"
          @click="saveInventory('warrantyExpiry', copyableWarranty)"
        />
      </template>
    </InlineField>

    <InlineField
      v-if="replacementCandidates.length > 0"
      type="enum"
      label="Replaces"
      :value="disk.replacesDiskId"
      :items="replacesItems"
      :saving="saving.replacesDiskId"
      :error="errors.replacesDiskId"
      data-field="replacesDiskId"
      @commit="
        save('replacesDiskId', {
          replacesDiskId: typeof $event === 'number' ? $event : null,
        })
      "
    />
  </DiskFactGroup>
</template>
