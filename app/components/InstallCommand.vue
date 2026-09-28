<script setup lang="ts">
const props = defineProps<{
  url: string;
  token: string;
}>();

const command = computed(
  () =>
    `curl -fsSL ${props.url}/host/install.sh \\\n  | sudo bash -s -- --url ${props.url} --token ${props.token}`,
);

const toast = useToast();

const copy = async () => {
  try {
    await navigator.clipboard.writeText(command.value);
    toast.add({ title: "Install command copied", color: "success" });
  } catch {
    toast.add({ title: "Could not copy the install command", color: "error" });
  }
};
</script>

<template>
  <div class="bg-muted border-default relative rounded-md border">
    <pre
      data-testid="install-command"
      class="overflow-x-auto p-3 pe-10 font-mono text-xs whitespace-pre"
    ><code>{{ command }}</code></pre>
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-copy"
      aria-label="Copy install command"
      class="absolute top-1.5 right-1.5"
      @click="copy"
    />
  </div>
</template>
