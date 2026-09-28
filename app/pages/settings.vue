<script setup lang="ts">
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("Settings") });

const { data: settings } = await useFetch("/api/settings");

const toast = useToast();

const copyEnrolToken = async () => {
  if (!settings.value) return;
  try {
    await navigator.clipboard.writeText(settings.value.enrolToken);
    toast.add({ title: "Enrol token copied", color: "success" });
  } catch {
    toast.add({ title: "Could not copy the enrol token", color: "error" });
  }
};
</script>

<template>
  <AppPanel title="Settings" class="flex max-w-2xl flex-col gap-6">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Settings
    </h1>

    <section class="flex flex-col gap-4">
      <h2 class="text-highlighted text-lg font-semibold">Collectors</h2>

      <UFormField
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
    </section>
  </AppPanel>
</template>
