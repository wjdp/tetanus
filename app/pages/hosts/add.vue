<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { HOST_TOOL_REQUIREMENTS } from "#shared/hostTools";

useSeoMeta({ title: getPageTitle("Add host") });

const NEW_HOST_POLL_MS = 10_000;

const { openzfs, smartmontools } = HOST_TOOL_REQUIREMENTS;

const demo = useRuntimeConfig().public.demo;
const requestUrl = useRequestURL();

const [{ data: settings }, { data: hosts, refresh }] = await Promise.all([
  useSettings(),
  useFetch("/api/hosts", { default: () => [] }),
]);

const knownHostIds = new Set((hosts.value ?? []).map((host) => host.id));
const newHosts = computed(() =>
  (hosts.value ?? []).filter((host) => !knownHostIds.has(host.id)),
);

let pollHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  if (!demo) pollHandle = setInterval(refresh, NEW_HOST_POLL_MS);
});
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const CHECK_COMMAND = [
  "systemctl list-timers 'tetanus-collect-*'",
  "journalctl -u 'tetanus-collect@*'",
].join("\n");

const INSTALLED_FILES = [
  ["/usr/local/bin/tetanus-collect", "the collector"],
  [
    "/etc/systemd/system/tetanus-collect-{zfs,smart,snapshots}.timer",
    "every 10 minutes for ZFS, hourly for SMART and snapshots",
  ],
  ["/etc/zfs/zed.d/all-tetanus.sh", "ZED hook, sends every ZFS event"],
  ["/etc/tetanus/collect.env", "server URL and enrol token, mode 600"],
];
</script>

<template>
  <AppPanel title="Add host" class="flex max-w-4xl flex-col gap-8">
    <div class="flex flex-col items-start gap-1">
      <UButton
        to="/hosts"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Hosts"
        class="-ml-2.5"
      />
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Add host
      </h1>
      <p class="text-muted text-sm">
        Install the collector on a NAS host. It runs read-only ZFS, SMART and
        udev commands on a timer and sends their output here.
      </p>
    </div>

    <UAlert
      v-if="demo"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Installing collectors is disabled in the demo."
      data-testid="add-host-demo"
    />

    <template v-else>
      <UAlert
        v-for="host in newHosts"
        :key="host.id"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="`${host.name} reported`"
        :actions="[{ label: 'Open host', to: `/hosts/${host.id}` }]"
        data-testid="new-host"
      />

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted font-semibold">Requirements</h2>
        <p class="text-muted text-sm" data-testid="requirements">
          bash, curl, OpenZFS {{ openzfs.minVersion }}+ and smartmontools
          {{ smartmontools.minVersion }}+, with systemd. Ubuntu 26.04, Debian 13
          or similar. Older OpenZFS or smartmontools still installs, but the
          host is marked degraded: no pool data, or no SMART data.
        </p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted font-semibold">Install</h2>
        <p class="text-muted text-sm">
          Run this as a sudoer on the host. It includes the enrol token from
          <NuxtLink
            to="/settings"
            class="text-highlighted hover:text-primary underline"
          >
            Settings</NuxtLink
          >, so keep it private.
        </p>
        <InstallCommand
          v-if="settings"
          :url="requestUrl.origin"
          :token="settings.enrolToken"
        />
        <ul class="text-muted list-disc ps-5 text-sm">
          <li>
            The host reports as <code class="font-mono">hostname -s</code>;
            add <code class="font-mono">--host &lt;name&gt;</code> to override
            it.
          </li>
          <li>
            It collects once straight away; add
            <code class="font-mono">--no-collect</code> to wait for the timers.
          </li>
          <li>Re-running it updates the collector and keeps the config.</li>
        </ul>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted font-semibold">What it installs</h2>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <template v-for="[path, purpose] in INSTALLED_FILES" :key="path">
            <dt class="font-mono text-xs leading-5 break-all">{{ path }}</dt>
            <dd class="text-muted">{{ purpose }}</dd>
          </template>
        </dl>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted font-semibold">Check it</h2>
        <p class="text-muted text-sm">
          The host appears on this page once it reports. If it does not, the
          journal has one line per source with the HTTP status.
        </p>
        <CommandBlock :command="CHECK_COMMAND" label="Check commands" />
      </section>
    </template>
  </AppPanel>
</template>
