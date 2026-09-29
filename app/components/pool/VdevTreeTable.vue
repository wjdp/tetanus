<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  DEVICE_STATUS_VOCABULARY,
  STATUS_TEXT_CLASS,
  zfsStateColour,
} from "~/utils/vocabulary";
import type { TopologyVdev } from "../topology/groupDisks";
import { flattenVdevs, isVdev, type VdevRow } from "./vdevRows";

const props = defineProps<{ root: TopologyVdev | null }>();

type Row = VdevRow<TopologyVdev>;

const rows = computed(() => flattenVdevs(props.root));

const columns: TableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "type", header: "Type" },
  { id: "state", header: "State" },
  { id: "read", header: "Read" },
  { id: "write", header: "Write" },
  { id: "cksum", header: "Cksum" },
  { id: "slow", header: "Slow IOs" },
  { id: "disk", header: "Disk" },
];

const counterClass = (count: number | null) =>
  count ? "text-error font-mono tabular" : "text-dimmed font-mono tabular";
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    empty="No vdevs reported."
    data-testid="vdev-tree"
  >
    <template #name-cell="{ row }">
      <span
        class="flex items-center gap-1.5 font-mono text-sm"
        :class="row.original.node.children.length ? 'text-toned' : 'text-highlighted'"
        :style="{ paddingLeft: `${row.original.depth * 1.25}rem` }"
      >
        <VdevTypeIcon v-if="isVdev(row.original)" :type="row.original.node.type" />
        {{ row.original.node.name }}
      </span>
    </template>
    <template #type-cell="{ row }">
      <span class="text-muted">{{ row.original.node.type }}</span>
    </template>
    <template #state-cell="{ row }">
      <span
        :class="STATUS_TEXT_CLASS[zfsStateColour(row.original.node.state)]"
        data-testid="vdev-state"
      >
        {{ row.original.node.state }}
      </span>
    </template>
    <template #read-cell="{ row }">
      <span :class="counterClass(row.original.node.readErrors)">
        {{ row.original.node.readErrors }}
      </span>
    </template>
    <template #write-cell="{ row }">
      <span :class="counterClass(row.original.node.writeErrors)">
        {{ row.original.node.writeErrors }}
      </span>
    </template>
    <template #cksum-cell="{ row }">
      <span :class="counterClass(row.original.node.checksumErrors)">
        {{ row.original.node.checksumErrors }}
      </span>
    </template>
    <template #slow-cell="{ row }">
      <span :class="counterClass(row.original.node.slowIos)">
        {{ row.original.node.slowIos ?? "—" }}
      </span>
    </template>
    <template #disk-cell="{ row }">
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
          {{ row.original.node.disk.alias ?? `#${row.original.node.disk.id}` }}
        </NuxtLink>
      </span>
      <span
        v-else-if="row.original.node.children.length === 0"
        class="text-dimmed"
      >
        unlinked
      </span>
    </template>
  </UTable>
</template>
