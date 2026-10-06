<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { describeDisk } from "#shared/disk";
import {
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
  { id: "disk", header: "Disk" },
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
      <UTooltip
        v-else
        :disabled="deviceDetails(row.original.node).length === 0"
        :ui="{ content: 'h-auto' }"
      >
        <span
          class="flex items-center gap-1.5 font-mono text-sm"
          :class="row.original.node.children.length ? 'text-toned' : 'text-highlighted'"
          :style="{ paddingLeft: `${row.original.depth * 1.25}rem` }"
          data-testid="vdev-name"
        >
          <VdevTypeIcon
            v-if="row.original.showsTypeIcon"
            :type="row.original.node.type"
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
        </span>
        <template #content>
          <div class="font-mono" data-testid="vdev-details">
            <div v-for="line in deviceDetails(row.original.node)" :key="line">
              {{ line }}
            </div>
          </div>
        </template>
      </UTooltip>
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
    <template #used-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev' && row.original.node.sizeBytes !== null"
        class="text-muted tabular whitespace-nowrap"
      >
        {{ formatZfsBytes(row.original.node.allocBytes) }} /
        {{ formatZfsBytes(row.original.node.sizeBytes) }}
      </span>
    </template>
    <template #frag-cell="{ row }">
      <span
        v-if="row.original.kind === 'vdev' && row.original.node.frag !== null"
        class="text-muted tabular"
      >
        {{ row.original.node.frag }} %
      </span>
    </template>
    <template #disk-cell="{ row }">
      <template v-if="row.original.kind === 'vdev'">
        <span v-if="row.original.node.disk" class="flex items-center gap-1.5">
          <TopologyStatusDot
            :colour="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].colour"
            :shape="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].shape"
            :title="DEVICE_STATUS_VOCABULARY[row.original.node.disk.latestStatus].label"
            class="size-1.5!"
          />
          <NuxtLink
            :to="`/disks/${row.original.node.disk.id}`"
            class="text-highlighted font-semibold hover:underline"
          >
            {{ describeDisk({ ...row.original.node.disk, model: row.original.node.disk.modelShort }) }}
          </NuxtLink>
        </span>
        <span
          v-else-if="row.original.node.children.length === 0"
          class="text-dimmed"
        >
          unlinked
        </span>
      </template>
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
