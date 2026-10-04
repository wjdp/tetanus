<script setup lang="ts">
import { interfaceLabel } from "#shared/hardware";
import { formatDuration } from "#shared/hostFreshness";
import {
  fieldDescription,
  INVENTORY_FIELDS,
  type InventoryKey,
  isFieldVisible,
} from "#shared/inventory-fields";
import { bareModel, displayModel } from "#shared/model";
import type { DiskPatch } from "#shared/schemas/disks";
import type { StatusCounter } from "#shared/smart/counters";
import { temperatureColour } from "#shared/temperature";
import { usageDetail } from "#shared/usage";
import type { InlineItem, InlineValue } from "~/components/inline/InlineField.vue";
import { DEVICE_STATUS_VOCABULARY, STATUS_TEXT_CLASS } from "~/utils/vocabulary";
import { fleetSuggestions } from "./fleetSuggestions";
import { specFooter, specRows } from "./specRows";
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

const SMART_TAB = { query: { tab: "smart" } };
const SYSTEM_MOUNT_PATHS = ["/", "/boot"];
const INFERRED_WRITTEN_TITLE =
  "Estimated: LBAs written × logical block size, the drive does not say its unit";

const { saving, errors, save, saveWith } = useDiskFieldSave(
  () => props.disk.id,
  (disk) => emit("updated", disk),
);

const fieldNamed = (key: InventoryKey) => {
  const field = INVENTORY_FIELDS.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`No inventory field ${key}`);
  return field;
};

const choicesOf = (values: readonly string[], label = (value: string) => value) => [
  { label: "—", value: null },
  ...values.map((value) => ({ label: label(value), value })),
];

const modelShortField = fieldNamed("modelShort");
const recordingField = fieldNamed("recordingTech");
const purposeField = fieldNamed("purpose");
const bpidField = fieldNamed("seagateBpid");
const storageField = fieldNamed("storageLocation");
const shuckedFromField = fieldNamed("shuckedFrom");

const recordingItems: InlineItem[] =
  "values" in recordingField
    ? choicesOf(recordingField.values, (value) => value.toUpperCase())
    : [];
const purposeItems: InlineItem[] =
  "values" in purposeField ? choicesOf(purposeField.values) : [];

const inventoryValue = (key: InventoryKey): InlineValue =>
  props.disk.inventory[key] ?? null;

const BAY_DESCRIPTION =
  "Where the disk sits, as you call it. The label belongs to the place, so a disk moved here takes it.";

const saveBay = (value: InlineValue) => {
  const { bay, id, lastSeenHostId } = props.disk;
  if (!bay || lastSeenHostId === null) return;
  return saveWith("bay", async () => {
    await $fetch(`/api/hosts/${lastSeenHostId}/bays`, {
      method: "PATCH",
      body: { [bay.locationKey]: value === null ? null : String(value) },
    });
    return await $fetch<DiskDetail>(`/api/disks/${id}`);
  });
};

const saveInventory = (key: InventoryKey, value: InlineValue) =>
  save(key, { inventory: { [key]: value } } as DiskPatch);

const model = computed(() => {
  const name = displayModel(props.disk.model, props.disk.vendor);
  if (!name) return null;
  const vendor =
    props.disk.vendor && props.disk.vendor !== "other"
      ? vendorLabel(props.disk.vendor)
      : null;
  return vendor ? `${vendor} ${name}` : name;
});

const wwn = computed(
  () => props.disk.keys.find((key) => key.kind === "wwn")?.value ?? null,
);

const modelShortSource = computed(() =>
  props.disk.specs?.line && props.disk.modelShort === props.disk.specs.line
    ? "from spec line"
    : "from model",
);

const media = computed(() => {
  const { disk } = props;
  if (disk.media === "ssd") return "SSD";
  if (disk.media !== "hdd") return "unknown";
  return [
    "HDD",
    disk.rotationRate ? `${disk.rotationRate} rpm` : null,
    disk.specs?.isHelium ? "helium" : null,
  ]
    .filter(Boolean)
    .join(" · ");
});

const showsRecording = computed(() => isFieldVisible(recordingField, props.disk));
const showsBpid = computed(() => isFieldVisible(bpidField, props.disk));
const showsStorage = computed(() => isFieldVisible(storageField, props.disk));
const showsShuckedFrom = computed(() =>
  isFieldVisible(shuckedFromField, props.disk),
);
const storageSuggestions = computed(() =>
  fleetSuggestions(props.disks, "storageLocation"),
);
const shuckedFromSuggestions = computed(() =>
  fleetSuggestions(props.disks, "shuckedFrom"),
);

const resolvedRecording = computed(() =>
  knownRecordingTech(props.disk.recordingTech)?.toUpperCase() ?? null,
);

const recordingInferred = computed(
  () =>
    props.disk.hardware?.recordingTechInferred === true &&
    !props.disk.inventory.recordingTech,
);

const interfaceText = computed(() =>
  interfaceDetail(
    interfaceLabel(props.disk.interface, props.disk.link),
    props.disk.hardware,
  ),
);

const linkSpeed = computed(() => linkSpeedDisplay(props.disk.hardware));

const trim = computed(() =>
  props.disk.media === "ssd" && props.disk.trimSupported !== null
    ? props.disk.trimSupported
      ? "yes"
      : "no"
    : null,
);

const specs = computed(() =>
  props.disk.specs
    ? { rows: specRows(props.disk.specs), footer: specFooter(props.disk.specs) }
    : null,
);

const unmatchedModel = computed(
  () => bareModel(props.disk.model) ?? props.disk.model ?? "this disk",
);

const mismatches = computed(() => props.disk.hardware?.specMismatch ?? []);

const hostLink = computed(() =>
  props.disk.hostName && props.disk.lastSeenHostId !== null
    ? `/hosts/${props.disk.lastSeenHostId}`
    : null,
);

const usage = computed(() =>
  usageDetail(props.disk.usage, props.disk.membership?.poolName ?? null),
);

const inferredFromPath = computed(() => {
  const paths = props.disk.usage.mounts.map((mount) => mount.path);
  return SYSTEM_MOUNT_PATHS.find((path) => paths.includes(path)) ?? "/";
});

const lastReading = computed(() => {
  const at = props.disk.latestReadingAt;
  if (!at) return null;
  return {
    text: `${formatDuration(Date.now() - Date.parse(at))} ago`,
    title: new Date(at).toLocaleString("en-GB"),
  };
});

const smartStatus = computed(
  () => DEVICE_STATUS_VOCABULARY[props.disk.latestStatus],
);

const temperatureClass = computed(() => {
  const colour = temperatureColour(
    props.disk.latestTemp,
    props.disk.tempThresholds,
  );
  return colour === "neutral" ? undefined : STATUS_TEXT_CLASS[colour];
});

interface CounterRow {
  id: string;
  label: string;
  counter: StatusCounter;
  suffix?: string;
}

const counterRows = computed(() => {
  const { counters, media } = props.disk;
  const rows = [
    { id: "reallocated", label: "Reallocated", counter: counters.reallocated },
    {
      id: "pending",
      label: "Pending",
      counter: media === "ssd" ? null : counters.pending,
    },
    {
      id: "uncorrectable",
      label: "Uncorrectable",
      counter: counters.uncorrectable,
    },
    {
      id: "wear",
      label: "Wear",
      counter: media === "hdd" ? null : counters.wearPercent,
      suffix: " %",
    },
  ];
  return rows.filter((row): row is CounterRow => row.counter !== null);
});

const hasFaults = computed(() => {
  const { error, warning, acknowledged } = props.disk.faultCounts;
  return error + warning + acknowledged > 0;
});

const formatCount = (value: number | null) =>
  value === null ? null : value.toLocaleString("en-GB");

const optionalDate = (value: string | null) =>
  value === null ? null : formatDate(value);
</script>

<template>
  <div class="lg:columns-2 lg:gap-x-4 [&>*]:mb-4" data-testid="disk-overview">
    <DiskFactGroup
      title="Health"
      data-testid="group-health"
    >
      <DiskFact label="SMART">
        <span class="inline-flex flex-wrap items-center gap-2">
          <UBadge
            color="neutral"
            variant="outline"
            :label="smartStatus.label"
            data-testid="overview-smart-status"
          >
            <template #leading>
              <TopologyStatusDot
                :colour="smartStatus.colour"
                :shape="smartStatus.shape"
              />
            </template>
          </UBadge>
          <span v-if="disk.latestReadingAt" class="text-dimmed text-xs">
            read {{ formatDate(disk.latestReadingAt) }}
          </span>
        </span>
      </DiskFact>
      <DiskFact
        label="Temperature"
        :value="formatCelsius(disk.latestTemp)"
        :class="temperatureClass"
        data-testid="overview-temperature"
      />
      <DiskFact
        v-if="disk.latestPowerOnHours !== null"
        label="Power-on"
        :value="formatHours(disk.latestPowerOnHours)"
      />
      <DiskFact
        v-if="disk.latestPowerCycles !== null"
        label="Power cycles"
        :value="formatCount(disk.latestPowerCycles)"
      />
      <DiskFact
        v-for="row in counterRows"
        :key="row.id"
        :label="row.label"
        :data-counter="row.id"
      >
        <NuxtLink :to="SMART_TAB" class="inline-flex hover:underline">
          <InventoryStatusCounter :counter="row.counter" :suffix="row.suffix" />
        </NuxtLink>
      </DiskFact>
      <DiskFact
        v-if="disk.counters.bytesWritten !== null"
        label="Written"
        data-counter="written"
      >
        <NuxtLink
          :to="SMART_TAB"
          class="hover:underline"
          :title="
            disk.counters.bytesWrittenInferred ? INFERRED_WRITTEN_TITLE : undefined
          "
          >{{ disk.counters.bytesWrittenInferred ? "~" : ""
          }}{{ formatBytes(disk.counters.bytesWritten) }}</NuxtLink
        >
      </DiskFact>
      <DiskFact v-if="hasFaults" label="Faults" data-testid="fact-faults">
        <DiskFaultBadges :disk-id="disk.id" :counts="disk.faultCounts" />
      </DiskFact>
    </DiskFactGroup>

    <DiskFactGroup
      title="Placement"
      data-testid="group-placement"
    >
      <DiskFact label="Host">
        <ULink
          v-if="hostLink"
          :to="hostLink"
          class="text-default hover:text-primary"
          >{{ disk.hostName }}</ULink
        >
        <span v-else class="text-dimmed">—</span>
      </DiskFact>
      <DiskFact v-if="disk.lastDevicePath" label="Device" mono>
        <span
          :class="{ 'text-dimmed': !disk.present }"
          :title="disk.present ? undefined : 'last known'"
          data-testid="fact-device"
          >{{ disk.lastDevicePath }}</span
        >
      </DiskFact>
      <InlineField
        v-if="showsStorage"
        type="text"
        :label="storageField.label"
        :description="fieldDescription(storageField)"
        :value="inventoryValue('storageLocation')"
        :suggestions="storageSuggestions"
        :saving="saving.storageLocation"
        :error="errors.storageLocation"
        data-field="storageLocation"
        @commit="saveInventory('storageLocation', $event)"
      />
      <InlineField
        v-if="disk.bay"
        type="text"
        label="Bay"
        :description="BAY_DESCRIPTION"
        :value="disk.bay.label"
        :saving="saving.bay"
        :error="errors.bay"
        data-field="bay"
        @commit="saveBay"
      >
        <template #display="{ text }">
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
      </InlineField>
      <DiskFact v-if="disk.membership" label="Pool">
        <DiskPoolBreadcrumb :membership="disk.membership" />
      </DiskFact>
      <DiskFact
        label="Usage"
        :value="usage"
        :class="{ 'text-dimmed': disk.usage.kind === 'empty' }"
      />
      <InlineField
        type="enum"
        :label="purposeField.label"
        :description="fieldDescription(purposeField)"
        :value="inventoryValue('purpose')"
        :items="purposeItems"
        :saving="saving.purpose"
        :error="errors.purpose"
        data-field="purpose"
        @commit="saveInventory('purpose', $event)"
      >
        <template #display>
          <UBadge
            v-if="disk.purpose"
            color="neutral"
            :variant="disk.purposeInferred ? 'outline' : 'subtle'"
            :label="disk.purpose"
          />
          <span v-else class="text-dimmed">—</span>
        </template>
        <template v-if="disk.purpose && disk.purposeInferred" #hint>
          inferred from mount at {{ inferredFromPath }}
        </template>
      </InlineField>
      <DiskFact
        v-if="disk.firstSeenAt"
        label="First seen"
        :value="optionalDate(disk.firstSeenAt)"
      />
      <DiskFact
        v-if="disk.lastSeenAt"
        label="Last seen"
        :value="optionalDate(disk.lastSeenAt)"
      />
      <DiskFact v-if="lastReading" label="Last reading">
        <span :title="lastReading.title">{{ lastReading.text }}</span>
      </DiskFact>
    </DiskFactGroup>

    <DiskFactGroup title="Identity" data-testid="group-identity">
      <DiskFact label="Model" :value="model" data-testid="fact-model" />
      <DiskFact label="Serial" :value="disk.serial" mono />
      <InlineField
        v-if="showsBpid"
        type="text"
        :label="bpidField.label"
        :description="fieldDescription(bpidField)"
        :value="inventoryValue('seagateBpid')"
        :saving="saving.seagateBpid"
        :error="errors.seagateBpid"
        data-field="seagateBpid"
        @commit="saveInventory('seagateBpid', $event)"
      />
      <DiskFact v-if="wwn" label="WWN" :value="wwn" mono />
      <InlineField
        v-if="showsShuckedFrom"
        type="text"
        :label="shuckedFromField.label"
        :description="fieldDescription(shuckedFromField)"
        :value="inventoryValue('shuckedFrom')"
        :suggestions="shuckedFromSuggestions"
        :saving="saving.shuckedFrom"
        :error="errors.shuckedFrom"
        data-field="shuckedFrom"
        @commit="saveInventory('shuckedFrom', $event)"
      />
      <DiskFact v-if="disk.firmware" label="Firmware" :value="disk.firmware" mono />
      <InlineField
        type="text"
        :label="modelShortField.label"
        :description="fieldDescription(modelShortField)"
        :value="inventoryValue('modelShort')"
        :saving="saving.modelShort"
        :error="errors.modelShort"
        data-field="modelShort"
        @commit="saveInventory('modelShort', $event)"
      >
        <template #display="{ text }">
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
      </InlineField>
    </DiskFactGroup>

    <DiskFactGroup title="Hardware" data-testid="group-hardware">
      <DiskFact label="Capacity" :value="formatBytes(disk.capacityBytes)" />
      <DiskFact label="Media" :value="media" data-testid="fact-media" />
      <InlineField
        v-if="showsRecording"
        type="enum"
        :label="recordingField.label"
        :value="inventoryValue('recordingTech')"
        :items="recordingItems"
        :saving="saving.recordingTech"
        :error="errors.recordingTech"
        data-field="recordingTech"
        @commit="saveInventory('recordingTech', $event)"
      >
        <template #display="{ text }">
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
      </InlineField>
      <DiskFact label="Interface" data-testid="fact-interface">
        <span v-if="interfaceText"
          >{{ interfaceText
          }}<template v-if="linkSpeed">
            ·
            <span
              :class="{ 'text-error': linkSpeed.belowMax }"
              :title="linkSpeed.title"
              >{{ linkSpeed.text }}</span
            ></template
          ></span
        >
        <span v-else class="text-dimmed">—</span>
      </DiskFact>
      <DiskFact v-if="disk.formFactor" label="Form factor" :value="disk.formFactor" />
      <DiskFact v-if="disk.sectorFormat" label="Sectors" :value="disk.sectorFormat" />
      <DiskFact v-if="trim" label="TRIM" :value="trim" />
      <template v-if="specs">
        <DiskFact
          v-for="row in specs.rows"
          :key="row.label"
          :label="row.label"
          :value="row.value"
          data-testid="spec-row"
        />
      </template>
      <DiskFact v-else label="Specs" data-testid="specs-missing">
        <span class="text-dimmed">none for {{ unmatchedModel }}</span>
      </DiskFact>

      <template v-if="specs || mismatches.length" #footer>
        <div class="text-dimmed flex flex-col gap-1 text-xs">
          <p v-if="specs" data-testid="specs-footer">{{ specs.footer }}</p>
          <ul v-if="mismatches.length" data-testid="spec-mismatch">
            <li v-for="line in mismatches" :key="line">
              Observed differs from dataset: {{ line }}
            </li>
          </ul>
        </div>
      </template>
    </DiskFactGroup>

    <DiskOwnership
      :disk="disk"
      :disks="disks"
      @updated="emit('updated', $event)"
    />

    <DiskNotes
      :disk="disk"
      @updated="emit('updated', $event)"
    />
  </div>
</template>
