<script setup lang="ts">
import { APP_NAME } from "#shared/app";
import { interfaceLabel } from "#shared/hardware";
import { formatDuration } from "#shared/hostFreshness";
import { bareModel, displayModel } from "#shared/model";
import type { StatusCounter } from "#shared/smart/counters";
import { temperatureColour } from "#shared/temperature";
import { usageDetail } from "#shared/usage";
import { DEVICE_STATUS_VOCABULARY, STATUS_TEXT_CLASS } from "~/utils/vocabulary";
import { ATTRIBUTE_STATUS_DOT } from "./attributeRows";
import { farmHoursCheck } from "./farmRows";
import { specFooter, specRows } from "./specRows";
import type { DiskDetail, ReplacementCandidate } from "./types";

const props = withDefaults(
  defineProps<{
    disk: DiskDetail;
    disks?: ReplacementCandidate[];
  }>(),
  { disks: () => [] },
);

const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const SMART_TAB = { query: { tab: "smart" } };
const INFERRED_WRITTEN_TITLE =
  "Estimated: LBAs written × logical block size, the drive does not say its unit";

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
  usageDetail(
    props.disk.usage,
    props.disk.membership?.poolName ?? null,
    props.disk.poolsKnown,
  ),
);

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

const FARM_TAB = { query: { tab: "farm" } };
const FARM_CHECK_CLASS = {
  agrees: "text-default",
  reset: "text-warning",
  "not-comparable": "text-dimmed",
} as const;

const farmCheck = computed(() =>
  props.disk.latestFarm
    ? farmHoursCheck(props.disk.latestFarm, props.disk.latestPowerOnHours)
    : null,
);

const DRIVE_VERDICT = {
  passed: { text: "Passed", class: undefined },
  warning: { text: "Warning", class: "text-warning" },
  failed: { text: "Failed", class: "text-error" },
  unknown: { text: "Not reported", class: "text-dimmed" },
} as const;

const attributeSummary = computed(() => {
  const counts = props.disk.smartVerdict?.attributes;
  if (!counts || counts.failed + counts.warning === 0) {
    return { text: "All within limits", class: "text-default" };
  }
  const parts = [
    counts.failed && `${counts.failed} failed`,
    counts.warning && `${counts.warning} warning`,
  ].filter(Boolean);
  return {
    text: parts.join(", "),
    class: counts.failed ? "text-error" : "text-warning",
  };
});
</script>

<template>
  <div class="lg:columns-2 lg:gap-x-4 [&>*]:mb-4" data-testid="disk-overview">
    <DiskFactGroup
      title="Health"
      data-testid="group-health"
    >
      <DiskFact label="Overall">
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
      <template v-if="disk.smartVerdict">
        <DiskFact
          label="Drive verdict"
          :class="DRIVE_VERDICT[disk.smartVerdict.drive].class"
          data-testid="overview-drive-verdict"
        >
          {{ DRIVE_VERDICT[disk.smartVerdict.drive].text }}
          <span class="text-dimmed text-xs">· the drive's own SMART check</span>
        </DiskFact>
        <DiskFact label="Attributes" data-testid="overview-attributes">
          <NuxtLink
            :to="SMART_TAB"
            class="hover:underline"
            :class="attributeSummary.class"
            >{{ attributeSummary.text }}</NuxtLink
          >
          <span class="text-dimmed text-xs"> · checked by {{ APP_NAME }}</span>
        </DiskFact>
      </template>
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
        v-if="farmCheck"
        label="FARM"
        :data-verdict="farmCheck.verdict"
        data-testid="overview-farm"
      >
        <NuxtLink
          :to="FARM_TAB"
          class="hover:underline"
          :class="FARM_CHECK_CLASS[farmCheck.verdict]"
          >{{ farmCheck.text }}</NuxtLink
        >
      </DiskFact>
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
        <span class="inline-flex items-center gap-2">
          <NuxtLink :to="SMART_TAB" class="inline-flex hover:underline">
            <InventoryStatusCounter :counter="row.counter" :suffix="row.suffix" />
          </NuxtLink>
          <UProgress
            v-if="row.id === 'wear'"
            :model-value="Math.min(row.counter.value, 100)"
            :color="ATTRIBUTE_STATUS_DOT[row.counter.status]?.colour ?? 'neutral'"
            size="2xs"
            class="w-32"
            data-testid="overview-wear-bar"
          />
        </span>
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
      <DiskEditableField
        field-key="storageLocation"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
      <DiskEditableField
        field-key="bay"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
      <DiskFact v-if="disk.membership" label="Pool">
        <DiskPoolBreadcrumb :membership="disk.membership" />
      </DiskFact>
      <DiskFact
        label="Usage"
        :value="usage"
        :class="{ 'text-dimmed': disk.usage.kind === 'empty' }"
      />
      <DiskEditableField
        field-key="purpose"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
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
      <DiskEditableField
        field-key="vendorOverride"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
      <DiskFact label="Serial" :value="disk.serial" mono />
      <DiskEditableField
        field-key="seagateBpid"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
      <DiskFact v-if="wwn" label="WWN" :value="wwn" mono />
      <DiskEditableField
        field-key="shuckedFrom"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
      <DiskFact v-if="disk.firmware" label="Firmware" :value="disk.firmware" mono />
      <DiskEditableField
        field-key="modelShort"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
    </DiskFactGroup>

    <DiskFactGroup title="Hardware" data-testid="group-hardware">
      <DiskFact label="Capacity" :value="formatBytes(disk.capacityBytes)" />
      <DiskFact label="Media" :value="media" data-testid="fact-media" />
      <DiskEditableField
        field-key="recordingTech"
        :disk="disk"
        :disks="disks"
        @updated="emit('updated', $event)"
      />
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
