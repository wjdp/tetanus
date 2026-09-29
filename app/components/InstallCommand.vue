<script setup lang="ts">
const props = defineProps<{
  url: string;
  token: string;
}>();

const command = computed(
  () =>
    `curl -fsSL ${props.url}/host/install.sh \\\n  | sudo bash -s -- --url ${props.url} --token ${props.token}`,
);
</script>

<template>
  <CommandBlock :command="command" label="Install command" />
</template>
