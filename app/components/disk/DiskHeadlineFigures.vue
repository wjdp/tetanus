<script setup lang="ts">
import { smartResetHours } from "#shared/smart/farm";
import { temperatureColour } from "#shared/temperature";
import { type EffectiveWarranty, effectiveWarranty } from "#shared/warranty";
import { warrantyClass } from "~/components/inventory/types";
import { STATUS_TEXT_CLASS } from "~/utils/vocabulary";
import { ATTRIBUTE_STATUS_DOT } from "./attributeRows";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();

const SMART_TAB = { query: { tab: "smart" } };
const NuxtLink = resolveComponent("NuxtLink");

interface Figure {
  id: string;
  label: string;
  value: string;
  note?: string;
  class?: string;
  toSmart?: boolean;
}

const figures = computed<Figure[]>(() => {
  const { disk } = props;
  const list: (Figure | null)[] = [
    { id: "capacity", label: "Capacity", value: formatBytes(disk.capacityBytes) },
    {
      id: "temperature",
      label: "Temperature",
      value: formatCelsius(disk.latestTemp),
      class: temperatureClass(disk),
      toSmart: true,
    },
    powerOnFigure(disk),
    disk.ageDays === null
      ? null
      : {
          id: "age",
          label: "Age",
          value: formatDays(disk.ageDays),
          note: disk.inventory.purchaseDate
            ? `bought ${disk.inventory.purchaseDate}`
            : undefined,
        },
    warrantyFigure(disk.warrantyDaysLeft, effectiveWarranty(disk.inventory)),
    wearFigure(disk),
  ];
  return list.filter((figure): figure is Figure => figure !== null);
});

function powerOnFigure(disk: DiskDetail): Figure | null {
  if (disk.latestPowerOnHours === null) return null;
  const cycles =
    disk.latestPowerCycles === null
      ? undefined
      : `${disk.latestPowerCycles.toLocaleString("en-GB")} cycles`;
  const farmHours = disk.latestFarm?.powerOnHours;
  const reset =
    disk.latestFarm && smartResetHours(disk.latestFarm, disk.latestPowerOnHours) !== null;
  return {
    id: "power-on",
    label: "Powered on",
    value: formatHours(disk.latestPowerOnHours),
    note: reset && farmHours !== undefined ? `FARM ${formatHours(farmHours)}` : cycles,
    class: reset ? STATUS_TEXT_CLASS.warning : undefined,
    toSmart: true,
  };
}

function temperatureClass(disk: DiskDetail): string | undefined {
  if (disk.latestTemp === null) return "text-dimmed";
  const colour = temperatureColour(disk.latestTemp, disk.tempThresholds);
  return colour === "neutral" ? undefined : STATUS_TEXT_CLASS[colour];
}

function warrantyFigure(
  days: number | null,
  warranty: EffectiveWarranty | null,
): Figure | null {
  if (days === null) return null;
  const expired = days < 0;
  const seller = warranty?.source === "seller" ? "seller, " : "";
  const until = warranty ? `${seller}until ${warranty.expiry}` : undefined;
  return {
    id: "warranty",
    label: "Warranty",
    value: expired ? "Expired" : `${formatDays(days)} left`,
    note: expired ? `${seller}${formatDays(-days)} ago` : until,
    class: warrantyClass(days) || undefined,
  };
}

function wearFigure(disk: DiskDetail): Figure | null {
  const { counters, media } = disk;
  if (media === "ssd" && counters.wearPercent) {
    const dot = ATTRIBUTE_STATUS_DOT[counters.wearPercent.status];
    return {
      id: "wear",
      label: "Wear",
      value: `${counters.wearPercent.value} %`,
      note:
        counters.bytesWritten === null
          ? undefined
          : `${counters.bytesWrittenInferred ? "~" : ""}${formatBytes(counters.bytesWritten)} written`,
      class: dot ? STATUS_TEXT_CLASS[dot.colour] : undefined,
      toSmart: true,
    };
  }
  if (counters.bytesWritten !== null) {
    return {
      id: "written",
      label: "Written",
      value: `${counters.bytesWrittenInferred ? "~" : ""}${formatBytes(counters.bytesWritten)}`,
      toSmart: true,
    };
  }
  return null;
}
</script>

<template>
  <dl
    class="divide-default grid grid-cols-2 gap-y-4 sm:grid-cols-3 lg:flex lg:divide-x"
    data-testid="headline-figures"
  >
    <div
      v-for="figure in figures"
      :key="figure.id"
      class="flex min-w-0 flex-col-reverse gap-0.5 pe-6 lg:px-6 lg:first:ps-0 lg:last:pe-0"
      :data-figure="figure.id"
    >
      <dt class="text-dimmed text-xs">
        {{ figure.label
        }}<span v-if="figure.note" class="text-dimmed/70"> · {{ figure.note }}</span>
      </dt>
      <dd class="tabular text-xl font-semibold tracking-tight">
        <component
          :is="figure.toSmart ? NuxtLink : 'span'"
          :to="figure.toSmart ? SMART_TAB : undefined"
          :class="figure.class ?? 'text-highlighted'"
          >{{ figure.value }}</component
        >
      </dd>
    </div>
  </dl>
</template>
