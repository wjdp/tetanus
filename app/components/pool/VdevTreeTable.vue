<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { describeDisk } from "#shared/disk";
import {
  capacityColour,
  DEVICE_STATUS_VOCABULARY,
  STATUS_TEXT_CLASS,
  vdevTypeVocabulary,
  zfsStateColour,
} from "~/utils/vocabulary";
import type { PoolVdev } from "./types";
import { type VdevTableRow, vdevTableRows } from "./vdevRows";

const props = defineProps<{
  poolId: number;
  root: PoolVdev | null;
  slowIoThreshold: number;
}>();

type Row = VdevTableRow<PoolVdev>;

const rows = computed(() => vdevTableRows(props.root));
const expanded = ref<Record<string, boolean>>({});

const rowId = (row: Row) =>
  row.kind === "section" ? `section-${row.role}` : row.node.guid;

const columns: TableColumn<Row>[] = [
  { id: "expand", header: "", meta: { class: { td: "w-8 pe-0" } } },
  { id: "name", header: "Name" },
  { id: "type", header: "Type" },
  { id: "state", header: "State" },
  { id: "read", header: "Read" },
  { id: "write", header: "Write" },
  { id: "cksum", header: "Cksum" },
  { id: "slow", header: "Slow IOs" },
  { id: "used", header: "Alloc / size" },
  { id: "frag", header: "Frag" },
];

const counterClass = (count: number | null) =>
  count ? "text-error font-mono tabular" : "text-dimmed font-mono tabular";

const slowClass = (count: number | null) => {
  if (!count) return "text-dimmed font-mono tabular";
  const isOverThreshold =
    props.slowIoThreshold > 0 && count >= props.slowIoThreshold;
  return isOverThreshold
    ? "text-warning font-mono tabular"
    : "text-highlighted font-mono tabular";
};

const deviceDetails = (node: PoolVdev) =>
  [
    node.path && `path ${node.path}`,
    node.devid && `devid ${node.devid}`,
    node.physPath && `phys path ${node.physPath}`,
  ].filter((line): line is string => Boolean(line));

const leafName = (node: PoolVdev) => node.name.split("/").at(-1);

const isUnlinkedLeaf = (node: PoolVdev) =>
  !node.disk && node.children.length === 0;

const nameClass = (node: PoolVdev) => {
  if (node.disk) return "text-dimmed text-xs";
  return node.children.length
    ? "text-toned text-sm"
    : "text-highlighted text-sm";
};

const allocPercent = (node: PoolVdev) =>
  node.allocBytes !== null && node.sizeBytes
    ? Math.round((node.allocBytes / node.sizeBytes) * 100)
    : null;

type AllocUnit = "bytes" | "percent";

const ALLOC_UNIT_OPTIONS: { unit: AllocUnit; label: string; title: string }[] =
  [
    { unit: "bytes", label: "Bytes", title: "Allocated and total size" },
    { unit: "percent", label: "%", title: "Allocated as a share of size" },
  ];

const allocUnit = ref<AllocUnit>("bytes");

const { formatZfsBytes } = useZfsByteSystem();
</script>

<template>
  <UTable
    v-model:expanded="expanded"
    :data="rows"
    :columns="columns"
    :get-row-id="rowId"
    empty="No vdevs reported."
    data-testid="vdev-tree"
  >
    <template #expand-cell="{ row }">
      <UButton
        v-if="row.original.kind === 'vdev'"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :aria-label="`${row.getIsExpanded() ? 'Hide' : 'Show'} history of ${row.original.node.name}`"
        :aria-expanded="row.getIsExpanded()"
        data-testid="vdev-expand"
        @click="row.toggleExpanded()"
      />
    </template>
    <template #name-cell="{ row }">
      <span
        v-if="row.original.kind === 'section'"
        class="text-muted flex items-center gap-1.5 text-sm font-semibold"
        data-testid="vdev-section"
      >
        <UIcon
          v-if="vdevTypeVocabulary(row.original.role)"
          :name="vdevTypeVocabulary(row.original.role)?.icon ?? ''"
          class="size-4 shrink-0"
        />
        {{ row.original.label }}
      </span>
      <div
        v-else
        class="flex flex-col items-start gap-0.5"
        :class="{ '-my-2': row.original.node.disk }"
        :style="{ paddingLeft: `${row.original.depth * 1.25}rem` }"
      >
        <span v-if="row.original.node.disk" class="flex items-center gap-1.5">
          <span class="flex size-4 shrink-0 items-center justify-center">
            <TopologyStatusDot
              :colour="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].colour"
              :shape="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].shape"
              :title="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].label"
              class="size-1.5!"
            />
          </span>
          <NuxtLink
            :to="`/disks/${row.original.node.disk.id}`"
            class="text-highlighted text-sm font-semibold whitespace-nowrap hover:underline"
          >
            {{ describeDisk({ ...row.original.node.disk, model: row.original.node.disk.modelShort }) }}
          </NuxtLink>
        </span>
        <UTooltip
          :disabled="deviceDetails(row.original.node).length === 0"
          :ui="{ content: 'h-auto' }"
        >
          <span
            class="flex items-center gap-1.5 font-mono"
            :class="nameClass(row.original.node)"
            data-testid="vdev-name"
          >
            <VdevTypeIcon
              v-if="row.original.showsTypeIcon && !row.original.node.disk"
              :type="row.original.node.type"
            />
            <span
              v-else-if="row.original.node.children.length === 0"
              class="size-4 shrink-0"
            />
            <span class="max-w-64 truncate">{{ leafName(row.original.node) }}</span>
            <UBadge
              v-if="row.original.node.spareState"
              :color="zfsStateColour(row.original.node.spareState)"
              variant="subtle"
              size="sm"
              data-testid="spare-state"
            >
              {{ row.original.node.spareState }}
            </UBadge>
            <UBadge
              v-if="isUnlinkedLeaf(row.original.node)"
              color="neutral"
              variant="subtle"
              size="sm"
              class="font-sans"
            >
              unlinked
            </UBadge>
          </span>
          <template #content>
            <div class="font-mono" data-testid="vdev-details">
              <div v-for="line in deviceDetails(row.original.node)" :key="line">
                {{ line }}
              </div>
            </div>
          </template>
        </UTooltip>
      </div>
    </template>
    <template #type-cell="{ row }">
      <span v-if="row.original.kind === 'vdev'" class="text-muted">
        {{ row.original.node.type }}
      </span>
    </template>
    <template #state-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev'"
        :class="STATUS_TEXT_CLASS[zfsStateColour(row.original.node.state)]"
        data-testid="vdev-state"
      >
        {{ row.original.node.state }}
      </span>
    </template>
    <template #read-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev'"
        :class="counterClass(row.original.node.readErrors)"
      >
        {{ row.original.node.readErrors }}
      </span>
    </template>
    <template #write-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev'"
        :class="counterClass(row.original.node.writeErrors)"
      >
        {{ row.original.node.writeErrors }}
      </span>
    </template>
    <template #cksum-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev'"
        :class="counterClass(row.original.node.checksumErrors)"
      >
        {{ row.original.node.checksumErrors }}
      </span>
    </template>
    <template #slow-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev'"
        :class="slowClass(row.original.node.slowIos)"
        data-testid="vdev-slow"
      >
        {{ row.original.node.slowIos ?? "—" }}
      </span>
    </template>
    <template #used-header>
      <span class="flex items-center gap-2">
        Alloc / size
        <UFieldGroup size="xs" aria-label="Alloc / size units">
          <UButton
            v-for="option in ALLOC_UNIT_OPTIONS"
            :key="option.unit"
            color="neutral"
            :variant="allocUnit === option.unit ? 'subtle' : 'outline'"
            :aria-pressed="allocUnit === option.unit"
            :label="option.label"
            :title="option.title"
            :data-testid="`vdev-alloc-unit-${option.unit}`"
            @click="allocUnit = option.unit"
          />
        </UFieldGroup>
      </span>
    </template>
    <template #used-cell="{ row }">
      <div
        v-if="row.original.kind === 'vdev' && row.original.node.sizeBytes !== null"
        class="-my-1 flex flex-col gap-1"
      >
        <span
          class="text-muted tabular whitespace-nowrap"
          data-testid="vdev-alloc"
        >
          <template v-if="allocUnit === 'percent'">
            {{ allocPercent(row.original.node) ?? "—" }} %
          </template>
          <template v-else>
            {{ formatZfsBytes(row.original.node.allocBytes) }} /
            {{ formatZfsBytes(row.original.node.sizeBytes) }}
          </template>
        </span>
        <UProgress
          v-if="allocPercent(row.original.node) !== null"
          :model-value="allocPercent(row.original.node)"
          :color="capacityColour(allocPercent(row.original.node))"
          size="2xs"
          data-testid="vdev-alloc-bar"
        />
      </div>
    </template>
    <template #frag-cell="{ row }">
      <div
        v-if="row.original.kind === 'vdev' && row.original.node.frag !== null"
        class="-my-1 flex min-w-12 flex-col gap-1"
      >
        <span class="text-muted tabular">{{ row.original.node.frag }} %</span>
        <UProgress
          :model-value="row.original.node.frag"
          color="neutral"
          size="2xs"
          data-testid="vdev-frag-bar"
        />
      </div>
    </template>
    <template #expanded="{ row }">
      <PoolVdevHistory
        v-if="row.original.kind === 'vdev'"
        :pool-id="poolId"
        :vdev-id="row.original.node.id"
      />
    </template>
  </UTable>
</template>
