<script setup lang="ts">
import type { InventoryFieldType } from "#shared/inventory-fields";
import { currencyStep, currencySymbol, formatMoney } from "#shared/money";

export type InlineValue = string | number | boolean | null;

export interface InlineItem {
  label: string;
  value: InlineValue;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    type: InventoryFieldType | "alias";
    value: InlineValue;
    label?: string;
    description?: string | null;
    ariaLabel?: string;
    items?: InlineItem[];
    placeholder?: string;
    format?: (value: InlineValue) => string;
    hint?: string;
    saving?: boolean;
    error?: string | null;
    compact?: boolean;
  }>(),
  {
    label: undefined,
    description: null,
    ariaLabel: undefined,
    items: undefined,
    placeholder: "—",
    format: undefined,
    hint: undefined,
    saving: false,
    error: null,
    compact: false,
  },
);

const emit = defineEmits<{ commit: [value: InlineValue] }>();

defineSlots<{
  display?(props: { value: InlineValue; text: string | null }): unknown;
  hint?(): unknown;
}>();

const BOOLEAN_ITEMS: InlineItem[] = [
  { label: "—", value: null },
  { label: "yes", value: true },
  { label: "no", value: false },
];

const SUCCESS_MS = 1000;
const NON_TYPING_KEYS = ["Enter", "Escape", "Tab"];

const currency = useCurrency();

const editing = ref(false);
const selectOpen = ref(false);
const draft = ref("");
const awaiting = ref(false);
const pending = ref<InlineValue>(null);
const succeeded = ref(false);
const typedSinceChange = ref(false);
let successTimer: ReturnType<typeof setTimeout> | undefined;

const showLabel = computed(() => !!props.label && !props.compact);

const choices = computed<InlineItem[] | null>(() => {
  if (props.items) return props.items;
  return props.type === "boolean" ? BOOLEAN_ITEMS : null;
});

const choiceKey = (value: InlineValue) =>
  String(choices.value?.findIndex((item) => item.value === value) ?? -1);

const selectItems = computed(() =>
  (choices.value ?? []).map((item, index) => ({
    label: item.label,
    value: String(index),
  })),
);

const shownValue = computed(() =>
  awaiting.value ? pending.value : props.value,
);

const text = computed<string | null>(() => {
  const value = shownValue.value;
  if (value === null || value === "") return null;
  if (props.format) return props.format(value);
  if (choices.value)
    return choices.value.find((item) => item.value === value)?.label ?? null;
  if (props.type === "money" && typeof value === "number")
    return formatMoney(value, currency.value);
  return String(value);
});

const inputType = computed(() => {
  if (props.type === "date") return "date";
  if (props.type === "money") return "number";
  return "text";
});

const controlLabel = computed(
  () => props.ariaLabel ?? props.label ?? props.type,
);

const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>("input");

watch(editing, async (isEditing) => {
  if (!isEditing) return;
  await nextTick();
  input.value?.inputRef?.focus();
});

const startEdit = () => {
  draft.value =
    props.value === null || typeof props.value === "boolean"
      ? ""
      : String(props.value);
  typedSinceChange.value = false;
  editing.value = true;
  selectOpen.value = true;
};

const parse = (raw: string): InlineValue => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (props.type === "money") {
    const amount = Number(trimmed);
    return Number.isNaN(amount) ? null : amount;
  }
  return trimmed;
};

const submit = (value: InlineValue) => {
  editing.value = false;
  if (value === props.value) return;
  pending.value = value;
  awaiting.value = true;
  emit("commit", value);
};

const commit = () => {
  if (!editing.value) return;
  submit(parse(draft.value));
};

const cancel = () => {
  editing.value = false;
};

const onKeydown = (event: KeyboardEvent) => {
  if (!NON_TYPING_KEYS.includes(event.key)) typedSinceChange.value = true;
};

const onDateChange = () => {
  if (props.type !== "date") return;
  if (!typedSinceChange.value) commit();
  typedSinceChange.value = false;
};

const pick = (key: unknown) => {
  const item = choices.value?.[Number(key)];
  if (!editing.value || !item) return;
  submit(item.value);
};

const onSelectOpen = (open: boolean) => {
  selectOpen.value = open;
  if (!open && editing.value) cancel();
};

const flashSuccess = () => {
  succeeded.value = true;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    succeeded.value = false;
  }, SUCCESS_MS);
};

watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (saving || !wasSaving || !awaiting.value) return;
    awaiting.value = false;
    if (props.error) {
      editing.value = true;
      selectOpen.value = false;
    } else {
      flashSuccess();
    }
  },
);

watch(
  () => props.value,
  () => {
    if (!props.saving) awaiting.value = false;
  },
  { flush: "post" },
);

onBeforeUnmount(() => clearTimeout(successTimer));

const ROW_FITTED_BASE = "h-6 py-0.5 text-sm/5 md:text-sm/5";

const box = computed(() => {
  if (props.type === "alias") return "-mx-2 px-2 py-0.5";
  return "-mx-2 h-6 px-2";
});

const inputUi = computed(() => ({
  leading: "pointer-events-none",
  base:
    props.type === "alias"
      ? "px-2 py-0.5 [font:inherit] md:[font:inherit]"
      : ROW_FITTED_BASE,
}));

const statusIcon = computed(() => {
  if (props.saving) return "i-lucide-loader-circle";
  if (succeeded.value) return "i-lucide-check";
  return "i-lucide-pencil";
});
</script>

<template>
  <dt v-if="showLabel" class="text-dimmed inline-flex items-center gap-1 py-0.5">
    {{ label }}
    <UPopover v-if="description" :content="{ side: 'top', align: 'start' }">
      <button
        type="button"
        class="hover:text-default focus-visible:outline-primary inline-flex rounded-sm focus-visible:outline-2"
        :aria-label="`About ${label}`"
        data-testid="inline-description"
      >
        <UIcon name="i-lucide-info" class="size-3.5" />
      </button>
      <template #content>
        <p class="text-default max-w-xs p-3 text-sm">{{ description }}</p>
      </template>
    </UPopover>
  </dt>
  <component
    :is="showLabel ? 'dd' : 'div'"
    v-bind="$attrs"
    class="flex min-w-0 flex-col gap-1"
    :class="{ 'text-sm': compact }"
    data-inline-field
  >
    <div
      v-if="editing"
      class="flex min-w-0 flex-col gap-1"
      :class="[
        compact ? 'w-full' : 'max-w-xs',
        '-mx-2',
      ]"
    >
      <USelect
        v-if="choices"
        :model-value="choiceKey(value)"
        :items="selectItems"
        :open="selectOpen"
        size="xs"
        :ui="{ base: ROW_FITTED_BASE }"
        :aria-label="controlLabel"
        class="w-full"
        @update:model-value="pick"
        @update:open="onSelectOpen"
      />
      <UInput
        v-else
        ref="input"
        :model-value="draft"
        :type="inputType"
        :min="type === 'money' ? 0 : undefined"
        :step="type === 'money' ? currencyStep(currency) : undefined"
        size="xs"
        :aria-label="controlLabel"
        :ui="inputUi"
        class="w-full"
        @update:model-value="(typed) => (draft = String(typed ?? ''))"
        @keydown="onKeydown"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
        @change="onDateChange"
      >
        <template v-if="type === 'money'" #leading>
          <span class="text-muted text-sm" data-testid="currency-symbol">{{
            currencySymbol(currency)
          }}</span>
        </template>
      </UInput>
      <p
        v-if="error"
        class="text-error text-xs"
        role="alert"
        data-testid="inline-error"
      >
        {{ error }}
      </p>
    </div>

    <div v-else class="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <button
        type="button"
        class="group hover:bg-elevated hover:ring-accented focus-visible:outline-primary inline-flex min-w-0 items-center gap-1.5 rounded-md text-start transition-colors hover:ring hover:ring-inset focus-visible:outline-2"
        :class="box"
        :aria-label="`Edit ${controlLabel}`"
        data-testid="inline-display"
        @click="startEdit"
      >
        <slot name="display" :value="shownValue" :text="text">
          <span
            class="tabular truncate"
            :class="{ 'text-dimmed': text === null }"
            >{{ text ?? placeholder }}</span
          >
        </slot>
        <UIcon
          :name="statusIcon"
          class="size-3.5 shrink-0"
          :class="
            saving || succeeded
              ? ['text-dimmed', { 'animate-spin': saving }]
              : 'text-dimmed opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100'
          "
          :data-status="saving ? 'saving' : succeeded ? 'saved' : 'idle'"
        />
      </button>
      <span
        v-if="!compact && (hint || $slots.hint)"
        class="text-dimmed text-xs"
        data-testid="inline-hint"
      >
        <slot name="hint">{{ hint }}</slot>
      </span>
    </div>
  </component>
</template>
