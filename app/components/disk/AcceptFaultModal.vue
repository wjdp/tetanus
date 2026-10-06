<script setup lang="ts">
import type { AcceptanceKind } from "#shared/smart/status";
import { SUBSTITUTE_SOURCE_LABELS } from "#shared/smart/substituteDefects";
import {
  acceptanceSummary,
  type HistoryPoint,
  REFERENCE_AGES_DAYS,
  referenceValue,
} from "~/utils/acceptanceSummary";
import {
  ACCEPTANCE_KIND_VOCABULARY,
  ATTRIBUTE_TREND_COLOUR,
} from "./attributeRows";
import type { LatestAttribute, SmartOverview } from "./types";

const props = defineProps<{
  diskId: number;
  attribute: LatestAttribute | null;
  kind: AcceptanceKind;
}>();

const emit = defineEmits<{ accepted: [] }>();

const open = defineModel<boolean>("open", { default: false });

const toast = useToast();
const note = ref("");
const kind = ref<AcceptanceKind>(props.kind);
const vocabulary = computed(() => ACCEPTANCE_KIND_VOCABULARY[kind.value]);
const KIND_ORDER: AcceptanceKind[] = ["acknowledge", "accept"];
const kindItems = computed(() =>
  KIND_ORDER.filter(
    (candidate) => candidate !== props.attribute?.acceptance?.kind,
  ).map((value) => ({
    value,
    label: ACCEPTANCE_KIND_VOCABULARY[value].option,
    description: ACCEPTANCE_KIND_VOCABULARY[value].description,
  })),
);
const saving = ref(false);
const history = ref<HistoryPoint[]>([]);
const loadingHistory = ref(false);

const loadHistory = async (attrId: string) => {
  loadingHistory.value = true;
  try {
    const overview = await $fetch<SmartOverview>(
      `/api/disks/${props.diskId}/smart`,
      { query: { range: "all" } },
    );
    history.value = overview.history.attributes[attrId] ?? [];
  } catch {
    history.value = [];
  } finally {
    loadingHistory.value = false;
  }
};

watch(
  [open, () => props.attribute?.attrId],
  ([isOpen, attrId]) => {
    if (!isOpen || !attrId) return;
    note.value = "";
    kind.value = props.kind;
    history.value = [];
    if (!props.attribute?.source) loadHistory(attrId);
  },
  { immediate: true },
);

const substituteSource = computed(() => {
  const source = props.attribute?.source;
  return source ? SUBSTITUTE_SOURCE_LABELS[source] : null;
});

const unit = computed(() => props.attribute?.metadata?.transformValueUnit);
const referenceTime = computed(() =>
  props.attribute ? Date.parse(props.attribute.takenAt) : Date.now(),
);

const withUnit = (value: number) => {
  const formatted = value.toLocaleString("en-GB");
  return unit.value ? `${formatted} ${unit.value}` : formatted;
};

const references = computed(() =>
  (substituteSource.value ? [] : REFERENCE_AGES_DAYS).map((days) => {
    const value = referenceValue(history.value, days, referenceTime.value);
    return {
      label: `${days} d ago`,
      value: value === null ? "no data" : withUnit(value),
    };
  }),
);

const summary = computed(() => {
  if (!props.attribute) return "";
  if (substituteSource.value) {
    return `${withUnit(props.attribute.transformedValue)}, read from ${substituteSource.value}; no history is kept`;
  }
  return acceptanceSummary(
    history.value,
    props.attribute.transformedValue,
    props.attribute.trend,
    referenceTime.value,
    unit.value,
  );
});

const failureRate = computed(() => {
  const rate = props.attribute?.failureRate;
  return rate === null || rate === undefined
    ? "—"
    : `${(rate * 100).toFixed(1)} %`;
});

const isConflict = (error: unknown) =>
  (error as { statusCode?: number })?.statusCode === 409;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const attributeName = computed(() =>
  props.attribute
    ? (props.attribute.metadata?.displayName ?? props.attribute.name)
    : "",
);

const confirm = async () => {
  const attribute = props.attribute;
  if (!attribute) return;
  const { action, verb } = vocabulary.value;
  saving.value = true;
  try {
    await $fetch(`/api/disks/${props.diskId}/accept`, {
      method: "POST",
      body: { attrId: attribute.attrId, kind: kind.value, note: note.value },
    });
    toast.add({
      title: `${capitalise(verb)} ${attributeName.value}`,
      color: "neutral",
    });
    open.value = false;
    emit("accepted");
  } catch (error) {
    toast.add(
      isConflict(error)
        ? { title: `Already ${verb}`, color: "neutral" }
        : {
            title: `Could not ${action.toLowerCase()} the fault`,
            color: "error",
          },
    );
    if (isConflict(error)) {
      open.value = false;
      emit("accepted");
    }
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="attribute ? `${vocabulary.action} ${attributeName}` : `${vocabulary.action} fault`"
    :description="vocabulary.description"
  >
    <template #body>
      <div v-if="attribute" class="flex flex-col gap-4 text-sm">
        <p class="text-muted">
          {{ attribute.metadata?.description || "No description for this attribute." }}
        </p>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt class="text-muted">Current</dt>
          <dd class="flex items-center gap-2">
            <span class="text-highlighted tabular">
              {{ withUnit(attribute.transformedValue) }}
            </span>
            <UBadge
              v-if="!substituteSource"
              data-testid="acceptance-trend"
              :color="ATTRIBUTE_TREND_COLOUR[attribute.trend]"
              variant="soft"
              size="sm"
              :label="attribute.trend"
            />
          </dd>
          <template v-for="reference in references" :key="reference.label">
            <dt class="text-muted">{{ reference.label }}</dt>
            <dd
              class="tabular"
              :class="reference.value === 'no data' ? 'text-dimmed' : 'text-default'"
            >
              {{ reference.value }}
            </dd>
          </template>
          <dt class="text-muted">Failure rate</dt>
          <dd class="tabular">{{ failureRate }}</dd>
        </dl>

        <p class="text-highlighted" data-testid="acceptance-summary">
          <UIcon
            v-if="loadingHistory"
            name="i-lucide-loader-circle"
            class="text-dimmed mr-1 animate-spin align-middle"
          />
          {{ summary }}
        </p>

        <URadioGroup
          v-model="kind"
          :items="kindItems"
          variant="table"
          size="sm"
          data-testid="acceptance-kind"
        />

        <UFormField label="Note" name="note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            :placeholder="vocabulary.notePlaceholder"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton
          color="primary"
          :label="vocabulary.action"
          :loading="saving"
          :disabled="!attribute"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
