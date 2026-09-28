<script setup lang="ts">
import MarkdownIt from "markdown-it";

const props = defineProps<{ source: string }>();

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

const rendered = computed(() => markdown.render(props.source));
</script>

<template>
  <div
    class="text-default flex flex-col gap-2 text-sm break-words [&_a]:text-highlighted [&_a]:underline [&_a:hover]:text-primary [&_blockquote]:border-default [&_blockquote]:text-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:bg-elevated [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-highlighted [&_h1]:font-semibold [&_h2]:text-highlighted [&_h2]:font-semibold [&_h3]:text-highlighted [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:bg-elevated [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5"
    data-testid="markdown"
    v-html="rendered"
  />
</template>
