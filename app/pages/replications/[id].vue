<script setup lang="ts">
import type { DropdownMenuItem, TabsItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { replicationLabel } from "#shared/replications";
import { hostLabel } from "~/components/replication/groups";
import { patchReplication } from "~/components/replication/patch";
import { REPLICATION_DIRECTION_LABEL } from "~/utils/vocabulary";

const CLOCK_TICK_MS = 60_000;

const route = useRoute();
const page = ref(1);

const {
  data: replication,
  error,
  refresh,
} = await useFetch(`/api/replications/${route.params.id}`, {
  query: { page },
});

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage,
  });
}

const label = computed(() =>
  replication.value
    ? replicationLabel({
        sourceName: replication.value.source?.dataset.name ?? null,
        targetName: replication.value.target.dataset.name,
      })
    : "Replication",
);

useSeoMeta({ title: () => getPageTitle(label.value) });

const now = ref(Date.now());
let clockHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockHandle = setInterval(() => {
    now.value = Date.now();
  }, CLOCK_TICK_MS);
});
onUnmounted(() => {
  if (clockHandle) clearInterval(clockHandle);
});

const toast = useToast();
const archiveOpen = ref(false);
const unarchiving = ref(false);

const unarchive = async () => {
  if (!replication.value) return;
  unarchiving.value = true;
  try {
    await patchReplication(replication.value.id, { archived: false });
    await refresh();
  } catch {
    toast.add({ title: `Could not unarchive ${label.value}`, color: "error" });
  } finally {
    unarchiving.value = false;
  }
};

const menuItems = computed<DropdownMenuItem[]>(() => [
  replication.value?.archivedAt
    ? {
        label: "Unarchive",
        icon: "i-lucide-archive-restore",
        onSelect: unarchive,
      }
    : {
        label: "No longer replicated…",
        icon: "i-lucide-archive",
        onSelect: () => {
          archiveOpen.value = true;
        },
      },
]);

const activeTab = ref("syncs");

const tabs = computed<TabsItem[]>(() => [
  {
    label: "Syncs",
    slot: "syncs",
    value: "syncs",
    badge: replication.value?.syncCount || undefined,
  },
  {
    label: "Snapshots",
    slot: "snapshots",
    value: "snapshots",
    badge: replication.value?.ladder.length || undefined,
  },
  { label: "Diary", slot: "diary", value: "diary" },
]);
</script>

<template>
  <AppPanel :title="label" class="max-w-7xl">
    <div v-if="replication" class="flex flex-col gap-6">
      <header class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1
            class="text-highlighted min-w-0 text-2xl font-semibold tracking-tight break-all"
          >
            {{ label }}
          </h1>
          <ReplicationStatusLabel :status="replication.status" />
          <UBadge color="neutral" variant="subtle" data-testid="direction">
            {{ REPLICATION_DIRECTION_LABEL[replication.direction] }}
          </UBadge>
          <div class="ms-auto flex items-center gap-2">
            <SimulateFaultMenu
              subject-type="replication"
              :subject-id="replication.id"
              size="sm"
            />
            <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-ellipsis-vertical"
                aria-label="Replication actions"
                data-testid="replication-menu"
              />
            </UDropdownMenu>
          </div>
          <ReplicationArchiveModal
            v-model:open="archiveOpen"
            :replication-id="replication.id"
            :label="label"
            @archived="refresh"
          />
        </div>
        <p
          class="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          data-testid="endpoints"
        >
          <template v-if="replication.source">
            <span>{{ hostLabel(replication.source) }}</span>
            <NuxtLink
              :to="`/datasets/${replication.source.dataset.id}`"
              class="text-toned font-mono hover:underline"
            >
              {{ replication.source.dataset.name }}
            </NuxtLink>
          </template>
          <span v-else class="text-dimmed">source not monitored</span>
          <UIcon name="i-lucide-arrow-right" class="text-dimmed size-4" />
          <span>{{ hostLabel(replication.target) }}</span>
          <NuxtLink
            :to="`/datasets/${replication.target.dataset.id}`"
            class="text-toned font-mono hover:underline"
          >
            {{ replication.target.dataset.name }}
          </NuxtLink>
        </p>
        <div
          v-if="replication.archivedAt"
          data-testid="replication-archived-banner"
          class="bg-elevated border-default border-s-accented text-muted flex items-center gap-3 rounded-md border border-s-[3px] py-1.5 ps-4 pe-2 text-sm"
        >
          <UIcon name="i-lucide-archive" class="size-4 shrink-0" />
          <span class="flex-1">
            No longer replicated since {{ formatDate(replication.archivedAt) }}<template v-if="replication.archivedNote"> · {{ replication.archivedNote }}</template>
          </span>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-archive-restore"
            label="Unarchive"
            :loading="unarchiving"
            @click="unarchive"
          />
        </div>
      </header>

      <ReplicationFaults :replication-id="replication.id" :now="now" />

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReplicationCadencePanel
          :replication="replication"
          :now="now"
          @saved="refresh"
        />
        <ReplicationSourcePanel :replication="replication" @saved="refresh" />
      </div>

      <UTabs v-model="activeTab" :items="tabs" variant="link" class="w-full">
        <template #syncs>
          <ReplicationSyncLog
            v-model:page="page"
            :syncs="replication.syncs"
            :interval-sec="replication.intervalSec"
          />
        </template>

        <template #snapshots>
          <ReplicationSnapshotLadder
            :ladder="replication.ladder"
            :source-monitored="replication.source !== null"
          />
        </template>

        <template #diary>
          <div class="py-4">
            <DiaryTimeline
              :entries="replication.diary"
              :show-subject="false"
              empty="Nothing in the diary for this replication yet."
              @changed="refresh"
            />
          </div>
        </template>
      </UTabs>
    </div>
  </AppPanel>
</template>
