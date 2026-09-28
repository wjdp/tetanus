<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { zfsStateColour } from "~/utils/statusColour";
import type { TopologyVdev } from "../topology/groupDisks";
import { STATUS_TEXT_CLASS } from "../topology/statusClasses";
import { flattenVdevs } from "./vdevRows";

const props = defineProps<{ root: TopologyVdev | null }>();

type Row = { node: TopologyVdev; depth: number };

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
        class="font-mono text-sm"
        :class="row.original.node.children.length ? 'text-toned' : 'text-highlighted'"
        :style="{ paddingLeft: `${row.original.depth * 1.25}rem` }"
      >
        {{ row.original.node.name }}
      </span>
    </template>
    <template #type-cell="{ row }">
      <span class="text-muted">{{ row.original.node.type }}</span>
    </template>
    <template #state-cell="{ row }">
      <span
        :class="
          row.original.node.state === 'ONLINE'
            ? 'text-muted'
            : STATUS_TEXT_CLASS[zfsStateColour(row.original.node.state)]
        "
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
      <NuxtLink
        v-if="row.original.node.disk"
        :to="`/disks/${row.original.node.disk.id}`"
        class="text-highlighted font-semibold hover:underline"
      >
        {{ row.original.node.disk.alias ?? `#${row.original.node.disk.id}` }}
      </NuxtLink>
      <span
        v-else-if="row.original.node.children.length === 0"
        class="text-dimmed"
      >
        unlinked
      </span>
    </template>
  </UTable>
</template>
