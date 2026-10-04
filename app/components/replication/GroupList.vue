<script setup lang="ts">
import type { ReplicationRow, ReplicationStatus } from "#shared/replications";
import {
  REPLICATION_STATUS_VOCABULARY,
  STATUS_TEXT_CLASS,
} from "~/utils/vocabulary";
import { groupReplications, statusSummary, targetParts } from "./groups";
import { dueText, lastSyncText } from "./timing";

const props = defineProps<{ rows: ReplicationRow[]; now: number }>();

const groups = computed(() => groupReplications(props.rows));

const isQuiet = (row: ReplicationRow) =>
  row.status === "ok" || row.status === "archived";

const showStatus = computed(() =>
  props.rows.some((row) => !isQuiet(row)),
);
const columnCount = computed(() => (showStatus.value ? 6 : 5));

const statusTextClass = (status: ReplicationStatus) => {
  const { colour } = REPLICATION_STATUS_VOCABULARY[status];
  return colour === "neutral" ? "text-muted" : STATUS_TEXT_CLASS[colour];
};

const open = (row: ReplicationRow) => navigateTo(`/replications/${row.id}`);
</script>

<template>
  <div data-testid="replication-groups">
    <div class="flex flex-col gap-6 md:hidden" data-testid="replication-list">
      <section
        v-for="group in groups"
        :key="group.key"
        data-testid="replication-list-group"
      >
        <h3
          class="text-toned flex flex-wrap items-center gap-x-2 pb-2 text-sm font-semibold"
        >
          <TopologyStatusDot
            :colour="REPLICATION_STATUS_VOCABULARY[group.status].colour"
            :shape="REPLICATION_STATUS_VOCABULARY[group.status].shape"
          />
          <span v-if="group.sourceHost">{{ group.sourceHost }}</span>
          <span v-else class="text-dimmed font-normal">
            source not monitored
          </span>
          <UIcon name="i-lucide-arrow-right" class="text-dimmed size-4" />
          <span>{{ group.targetHost }}</span>
          <span class="text-dimmed tabular font-normal">
            {{ group.rows.length }}
          </span>
          <span
            v-if="statusSummary(group.rows)"
            class="font-normal"
            :class="statusTextClass(group.status)"
          >
            {{ statusSummary(group.rows) }}
          </span>
        </h3>
        <NuxtLink
          v-for="row in group.rows"
          :key="row.id"
          :to="`/replications/${row.id}`"
          class="border-default hover:bg-elevated/50 grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t py-2.5 text-sm"
          data-testid="replication-list-item"
        >
          <TopologyStatusDot
            class="self-center"
            :colour="REPLICATION_STATUS_VOCABULARY[row.status].colour"
            :shape="REPLICATION_STATUS_VOCABULARY[row.status].shape"
          />
          <span
            class="truncate font-mono"
            :class="row.source?.dataset.present ? 'text-toned' : 'text-dimmed'"
          >
            {{ row.source?.dataset.name ?? "source not monitored" }}
          </span>
          <span class="tabular text-right" :class="statusTextClass(row.status)">
            {{ dueText(row, now) }}
          </span>
          <span
            class="col-start-2 col-end-4 truncate font-mono"
            :class="
              row.target.dataset.present ? 'text-highlighted' : 'text-dimmed'
            "
          >
            <span class="text-dimmed">→ {{ targetParts(row).prefix }}</span
            >{{ targetParts(row).mirrored }}
          </span>
          <span
            class="text-muted col-start-2 col-end-4 text-xs"
            data-testid="replication-list-meta"
          >
            <span v-if="!isQuiet(row)" :class="statusTextClass(row.status)">
              {{ REPLICATION_STATUS_VOCABULARY[row.status].label }} ·
            </span>
            <ReplicationCadence
              :interval-sec="row.intervalSec"
              :manual="row.intervalManual"
            />
            · {{ lastSyncText(row, now) }}
          </span>
        </NuxtLink>
      </section>
    </div>
    <div class="hidden overflow-x-auto md:block">
    <table class="w-full min-w-3xl table-fixed text-sm">
      <colgroup>
        <col class="w-6" />
        <col />
        <col />
        <col v-if="showStatus" class="w-24" />
        <col class="w-28" />
        <col class="w-28" />
        <col class="w-32" />
      </colgroup>
      <thead>
        <tr class="text-highlighted border-default border-b text-left">
          <th scope="col"><span class="sr-only">Status</span></th>
          <th scope="col" class="py-2 pr-4 font-semibold">Source</th>
          <th scope="col" class="py-2 pr-4 font-semibold">Target</th>
          <th v-if="showStatus" scope="col" class="py-2 pr-4 font-semibold">
            Status
          </th>
          <th scope="col" class="py-2 pr-4 font-semibold">Cadence</th>
          <th scope="col" class="py-2 pr-4 font-semibold">Last sync</th>
          <th scope="col" class="py-2 font-semibold">Next due</th>
        </tr>
      </thead>
      <tbody
        v-for="group in groups"
        :key="group.key"
        data-testid="replication-group"
        :data-status="group.status"
      >
        <tr>
          <td class="pt-6 pb-2 align-middle">
            <TopologyStatusDot
              :colour="REPLICATION_STATUS_VOCABULARY[group.status].colour"
              :shape="REPLICATION_STATUS_VOCABULARY[group.status].shape"
            />
          </td>
          <th
            scope="rowgroup"
            :colspan="columnCount"
            class="text-toned pt-6 pb-2 text-left font-semibold"
          >
            <span class="flex items-center gap-2">
              <span v-if="group.sourceHost">{{ group.sourceHost }}</span>
              <span v-else class="text-dimmed font-normal">
                source not monitored
              </span>
              <UIcon name="i-lucide-arrow-right" class="text-dimmed size-4" />
              <span>{{ group.targetHost }}</span>
              <span class="text-dimmed tabular font-normal">
                {{ group.rows.length }}
              </span>
              <span
                v-if="statusSummary(group.rows)"
                class="font-normal"
                :class="statusTextClass(group.status)"
              >
                {{ statusSummary(group.rows) }}
              </span>
            </span>
          </th>
        </tr>
        <tr
          v-for="row in group.rows"
          :key="row.id"
          class="border-default hover:bg-elevated/50 cursor-pointer border-t"
          data-testid="replication-row"
          @click="open(row)"
        >
          <td class="py-2.5 align-middle">
            <TopologyStatusDot
              :colour="REPLICATION_STATUS_VOCABULARY[row.status].colour"
              :shape="REPLICATION_STATUS_VOCABULARY[row.status].shape"
            />
          </td>
          <td class="py-2.5 pr-4">
            <span
              v-if="row.source"
              class="block truncate font-mono"
              :class="row.source.dataset.present ? 'text-toned' : 'text-dimmed'"
              :title="row.source.dataset.name"
            >
              {{ row.source.dataset.name }}
            </span>
            <span v-else class="text-dimmed">not monitored</span>
          </td>
          <td class="py-2.5 pr-4">
            <NuxtLink
              :to="`/replications/${row.id}`"
              class="block truncate font-mono hover:underline"
              :class="
                row.target.dataset.present ? 'text-highlighted' : 'text-dimmed'
              "
              :title="row.target.dataset.name"
              @click.stop
            >
              <span class="text-dimmed">{{ targetParts(row).prefix }}</span
              >{{ targetParts(row).mirrored }}
            </NuxtLink>
          </td>
          <td
            v-if="showStatus"
            class="py-2.5 pr-4"
            :class="statusTextClass(row.status)"
          >
            <span v-if="!isQuiet(row)">
              {{ REPLICATION_STATUS_VOCABULARY[row.status].label }}
            </span>
          </td>
          <td class="py-2.5 pr-4">
            <ReplicationCadence
              :interval-sec="row.intervalSec"
              :manual="row.intervalManual"
            />
          </td>
          <td
            class="tabular py-2.5 pr-4"
            :class="row.lastSyncAt ? 'text-muted' : 'text-dimmed'"
          >
            {{ lastSyncText(row, now) }}
          </td>
          <td class="tabular py-2.5" :class="statusTextClass(row.status)">
            {{ dueText(row, now) }}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>
</template>
