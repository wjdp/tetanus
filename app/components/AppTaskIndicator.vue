<script setup lang="ts">
import type { SseTask } from "#shared/sse";

defineProps<{ collapsed?: boolean }>();

const tasks = ref<SseTask[]>([]);

const isRunning = (state: SseTask["state"]) =>
  state === "pending" || state === "in_progress";

const activeTask = computed(() =>
  tasks.value.reduce<SseTask | null>(
    (newest, candidate) =>
      isRunning(candidate.state) && (!newest || candidate.id > newest.id)
        ? candidate
        : newest,
    null,
  ),
);

const { onMessage } = useSseClient();
onMessage("task", (event) => {
  const existing = tasks.value.find((task) => task.id === event.id);
  if (existing) {
    Object.assign(existing, event);
    return;
  }
  tasks.value.push(event);
});

onMounted(async () => {
  try {
    const existingTasks = await $fetch("/api/tasks");
    for (const task of existingTasks) {
      if (isRunning(task.state) && !tasks.value.some((t) => t.id === task.id)) {
        tasks.value.push(task);
      }
    }
  } catch (error) {
    console.error("Could not read existing tasks:", error);
  }
});
</script>

<template>
  <div
    v-if="activeTask"
    data-testid="task-indicator"
    role="status"
    class="border-default flex flex-col gap-1.5 rounded-md border p-2"
    :title="activeTask.message"
  >
    <div class="flex items-center gap-2">
      <UIcon
        name="i-lucide-loader-circle"
        class="text-primary size-4 shrink-0 animate-spin"
      />
      <span v-if="!collapsed" class="text-highlighted truncate text-xs">
        {{ humaniseTaskName(activeTask.name) }}
      </span>
    </div>

    <template v-if="!collapsed">
      <UProgress
        v-if="activeTask.progress !== undefined"
        :model-value="activeTask.progress"
        :max="1"
        size="sm"
      />
      <span v-if="activeTask.message" class="text-muted truncate text-xs">
        {{ activeTask.message }}
      </span>
    </template>
  </div>
</template>
