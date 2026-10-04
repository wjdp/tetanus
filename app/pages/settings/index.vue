<script setup lang="ts">
import { currencyItems } from "#shared/money";

const { data: settings } = await useSettings();

const demo = useRuntimeConfig().public.demo;
const copyToClipboard = useCopyToClipboard();
const toast = useToast();

const copyEnrolToken = () => {
  if (!settings.value) return;
  return copyToClipboard(settings.value.enrolToken, "Enrol token");
};

const { data: databaseSize } = await useFetch("/api/database", {
  key: "database-size",
});
const optimising = ref(false);

const optimiseDatabase = async () => {
  optimising.value = true;
  try {
    const { before, after } = await $fetch("/api/database/optimise", {
      method: "POST",
    });
    databaseSize.value = after;
    toast.add({
      title: "Database optimised",
      description: `${formatBytes(before.bytes)} → ${formatBytes(after.bytes)}`,
      color: "success",
    });
  } catch (error) {
    toast.add({
      title: "Could not optimise the database",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    optimising.value = false;
  }
};

const currencyOptions = currencyItems();

const saveCurrency = async (currency: string) => {
  try {
    settings.value = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { currency } },
    });
  } catch (error) {
    toast.add({
      title: "Could not save the currency",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  }
};
</script>

<template>
  <div class="flex flex-col gap-8">
    <section class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Display</h2>

      <UFormField
        label="Currency"
        name="currency"
        description="Prices are shown in this currency. Changing it relabels stored prices; it does not convert them."
      >
        <USelectMenu
          :model-value="settings?.config.currency"
          :items="currencyOptions"
          value-key="value"
          class="w-full sm:w-80"
          data-testid="currency"
          @update:model-value="saveCurrency"
        />
      </UFormField>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Replication</h2>
      <ReplicationThresholdsForm
        :config="settings?.config"
        @saved="settings = $event"
      />
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Collectors</h2>

      <UFormField
        v-if="!demo"
        label="Enrol token"
        name="enrolToken"
        description="Host collectors send this token when posting to the ingest API."
      >
        <UInput
          :model-value="settings?.enrolToken"
          readonly
          class="w-full font-mono"
          data-testid="enrol-token"
        >
          <template #trailing>
            <UButton
              color="neutral"
              variant="link"
              size="sm"
              icon="i-lucide-copy"
              aria-label="Copy enrol token"
              @click="copyEnrolToken"
            />
          </template>
        </UInput>
      </UFormField>
      <p v-else class="text-muted text-sm" data-testid="demo-collectors-note">
        Collectors are disabled in the demo.
      </p>
    </section>

    <section v-if="!demo" class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Database</h2>

      <UFormField
        label="Optimise"
        name="optimise"
        description="Rebuilds the database file to reclaim space left by deleted rows and refreshes the query planner's statistics. Ingest pauses while it runs."
      >
        <div class="flex flex-wrap items-center gap-4">
          <UButton
            icon="i-lucide-database-zap"
            color="neutral"
            variant="outline"
            :loading="optimising"
            data-testid="optimise-database"
            @click="optimiseDatabase"
          >
            Optimise database
          </UButton>
          <span
            v-if="databaseSize"
            class="text-muted text-sm"
            data-testid="database-size"
          >
            {{ formatBytes(databaseSize.bytes) }},
            {{ formatBytes(databaseSize.reclaimableBytes) }} reclaimable
          </span>
        </div>
      </UFormField>
    </section>
  </div>
</template>
