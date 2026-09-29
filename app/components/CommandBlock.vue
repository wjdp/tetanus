<script setup lang="ts">
const props = defineProps<{
  command: string;
  label: string;
}>();

const toast = useToast();

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.command);
    toast.add({ title: `${props.label} copied`, color: "success" });
  } catch {
    toast.add({
      title: `Could not copy the ${props.label.toLowerCase()}`,
      color: "error",
    });
  }
};
</script>

<template>
  <div class="bg-muted border-default relative rounded-md border">
    <pre
      data-testid="command"
      class="overflow-x-auto p-3 pe-10 font-mono text-xs whitespace-pre"
    ><code>{{ command }}</code></pre>
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-copy"
      :aria-label="`Copy ${label.toLowerCase()}`"
      class="absolute top-1.5 right-1.5"
      @click="copy"
    />
  </div>
</template>
