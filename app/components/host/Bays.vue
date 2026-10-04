<script setup lang="ts">
import type { HostBays } from "#shared/bays";
import type { InlineValue } from "~/components/inline/InlineField.vue";
import type { BayRow } from "./BaysTable.vue";

const props = defineProps<{ hostId: number }>();

const toast = useToast();
const { data: bays } = useFetch<HostBays>(
  () => `/api/hosts/${props.hostId}/bays`,
);
const saving = reactive<Record<string, boolean>>({});
const errors = reactive<Record<string, string | null>>({});

const enclosureTitle = (enclosure: HostBays["enclosures"][number]) =>
  [enclosure.vendor, enclosure.model].filter(Boolean).join(" ") ||
  `Enclosure ${enclosure.name}`;

const enclosureRows = (enclosure: HostBays["enclosures"][number]): BayRow[] =>
  enclosure.slots.map((slot) => ({ ...slot }));

const otherRows = computed<BayRow[]>(() => [
  ...(bays.value?.paths ?? []).map((bay) => ({
    ...bay,
    status: null,
    fault: null,
  })),
  ...(bays.value?.orphans ?? []).map((bay) => ({
    ...bay,
    disk: null,
    status: null,
    fault: null,
  })),
]);

const isEmpty = computed(
  () =>
    !!bays.value &&
    bays.value.enclosures.length === 0 &&
    otherRows.value.length === 0,
);

const saveLabel = async (locationKey: string, value: InlineValue) => {
  saving[locationKey] = true;
  errors[locationKey] = null;
  try {
    bays.value = await $fetch<HostBays>(`/api/hosts/${props.hostId}/bays`, {
      method: "PATCH",
      body: { [locationKey]: value === null ? null : String(value) },
    });
  } catch (error) {
    errors[locationKey] = fetchErrorMessage(error) ?? "Could not save";
    if (isNetworkFailure(error))
      toast.add({ title: "Could not reach the server", color: "error" });
  } finally {
    saving[locationKey] = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="host-bays">
    <p v-if="isEmpty" class="text-dimmed text-sm">
      No locations reported yet. Collector 0.5.0 or later reports SES enclosure
      slots and each disk's port.
    </p>

    <section
      v-for="enclosure in bays?.enclosures ?? []"
      :key="enclosure.enclosureId"
      class="flex flex-col gap-2"
      data-testid="bay-enclosure"
    >
      <h3 class="text-muted text-sm font-medium">
        {{ enclosureTitle(enclosure) }}
        <span class="text-dimmed font-mono text-xs">{{ enclosure.name }}</span>
      </h3>
      <HostBaysTable
        :rows="enclosureRows(enclosure)"
        :saving="saving"
        :errors="errors"
        @commit="saveLabel"
      />
    </section>

    <section v-if="otherRows.length" class="flex flex-col gap-2" data-testid="bay-paths">
      <h3 class="text-muted text-sm font-medium">Other locations</h3>
      <HostBaysTable
        :rows="otherRows"
        :saving="saving"
        :errors="errors"
        :with-status="false"
        @commit="saveLabel"
      />
    </section>
  </div>
</template>
