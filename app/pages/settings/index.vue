<script setup lang="ts">
import { currencyItems } from "#shared/money";

const { data: settings } = await useSettings();

const demo = useRuntimeConfig().public.demo;
const copyToClipboard = useCopyToClipboard();

const copyEnrolToken = () => {
  if (!settings.value) return;
  return copyToClipboard(settings.value.enrolToken, "Enrol token");
};

const currencyOptions = currencyItems();
const toast = useToast();

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
  </div>
</template>
