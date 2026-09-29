<script setup lang="ts">
const { data: settings } = await useFetch("/api/settings");

const demo = useRuntimeConfig().public.demo;
const copyToClipboard = useCopyToClipboard();

const copyEnrolToken = () => {
  if (!settings.value) return;
  return copyToClipboard(settings.value.enrolToken, "Enrol token");
};
</script>

<template>
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
</template>
