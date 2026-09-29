<script setup lang="ts">
import type { DriveSpec } from "#shared/drive-spec";
import { bareModel } from "#shared/model";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();

const BACKBLAZE_QUARTER = /^Backblaze thru Q\d \d{4}/;

const yesNo = (value: boolean | null) =>
  value === null ? null : value ? "Yes" : "No";

const withUnit = (value: number | null, unit: string) =>
  value === null ? null : `${value.toLocaleString("en-GB")} ${unit}`;

function failureRate(specs: DriveSpec): string | null {
  if (specs.afrPct === null) return null;
  const source =
    specs.reliabilitySource?.match(BACKBLAZE_QUARTER)?.[0] ??
    "Backblaze Drive Stats";
  return [
    `${Number(specs.afrPct.toFixed(2))} %`,
    withUnit(specs.reliabilityDriveCount, "drives"),
    source,
  ]
    .filter(Boolean)
    .join(" · ");
}

const rows = computed(() => {
  const { specs } = props.disk;
  if (!specs) return [];
  const all: { label: string; value: string | null }[] = [
    {
      label: "Line",
      value: specs.line ? `${specs.brand} ${specs.line}` : null,
    },
    { label: "Class", value: specs.driveClass },
    { label: "Cache", value: withUnit(specs.cacheMb, "MB") },
    { label: "TLER/ERC", value: yesNo(specs.ercTler) },
    { label: "Helium", value: yesNo(specs.isHelium) },
    { label: "NAND", value: specs.nandType },
    { label: "DRAM", value: yesNo(specs.hasDram) },
    { label: "PLP", value: yesNo(specs.hasPlp) },
    { label: "TBW", value: withUnit(specs.tbwTb, "TB") },
    { label: "DWPD", value: specs.dwpd?.toString() ?? null },
    {
      label: "Sustained write",
      value: withUnit(specs.sustainedWriteMbps, "MB/s"),
    },
    { label: "AFR", value: failureRate(specs) },
    { label: "In production", value: yesNo(specs.inProduction) },
    {
      label: "Also sold as",
      value: specs.alsoSoldAs.length ? specs.alsoSoldAs.join(", ") : null,
    },
  ];
  return all.filter((row) => row.value !== null);
});

const footer = computed(() => {
  const { specs } = props.disk;
  if (!specs) return null;
  const parts = [
    specs.source === "local"
      ? "Specs: local override"
      : "Specs: nasdisks.com (CC BY 4.0) · Failure rates: Backblaze Drive Stats",
    specs.snapshot ? `snapshot ${specs.snapshot}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
});

const unmatchedModel = computed(
  () => bareModel(props.disk.model) ?? props.disk.model,
);

const mismatches = computed(() => props.disk.hardware?.specMismatch ?? []);
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="disk-specs">
    <h2 class="text-highlighted text-lg font-semibold">Specs</h2>

    <template v-if="disk.specs">
      <dl
        v-if="rows.length"
        class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5"
      >
        <div v-for="row in rows" :key="row.label" class="flex flex-col">
          <dt class="text-dimmed text-xs">{{ row.label }}</dt>
          <dd class="tabular">{{ row.value }}</dd>
        </div>
      </dl>
      <p class="text-dimmed text-xs" data-testid="specs-footer">{{ footer }}</p>
    </template>
    <p v-else class="text-dimmed text-sm" data-testid="specs-missing">
      No spec match for {{ unmatchedModel ?? "this disk" }}
    </p>

    <div
      v-if="mismatches.length"
      class="text-dimmed flex items-start gap-1.5 text-xs"
      data-testid="spec-mismatch"
    >
      <UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />
      <ul>
        <li v-for="line in mismatches" :key="line">
          Observed differs from dataset: {{ line }}
        </li>
      </ul>
    </div>
  </section>
</template>
