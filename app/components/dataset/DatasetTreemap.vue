<script setup lang="ts">
import {
  buildSpaceHierarchy,
  type SpaceBox,
  type SpaceNode,
  spaceSplit,
} from "./spaceHierarchy";
import {
  BRANCH_SLOTS,
  branchSlots,
  growthScale,
  hasHeader,
  type LaidOut,
  layoutSpace,
} from "./spaceLayout";
import { lastSegment } from "./treeRows";
import type { DatasetTreeRow } from "./types";

type ColourMode = "branch" | "growth";

const props = defineProps<{ datasets: DatasetTreeRow[] }>();

const COLOUR_MODE_STORAGE_KEY = "datasetTreemap.colourMode";
const SHOW_FREE_STORAGE_KEY = "datasetTreemap.showFree";
const MIN_TILE_PX = 2;

const colourMode = ref<ColourMode>("branch");
const showFree = ref(false);
const zoomId = ref<number | null>(null);
const hoveredKey = ref<string | null>(null);
const pointer = ref({ x: 0, y: 0 });
const width = ref(0);
const height = ref(0);

const container = useTemplateRef<HTMLDivElement>("container");
let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  try {
    colourMode.value =
      localStorage.getItem(COLOUR_MODE_STORAGE_KEY) === "growth"
        ? "growth"
        : "branch";
    showFree.value = localStorage.getItem(SHOW_FREE_STORAGE_KEY) === "true";
  } catch {
    colourMode.value = "branch";
  }
  if (!container.value) return;
  width.value = container.value.clientWidth;
  height.value = container.value.clientHeight;
  resizeObserver = new ResizeObserver(([entry]) => {
    width.value = Math.floor(entry?.contentRect.width ?? 0);
    height.value = Math.floor(entry?.contentRect.height ?? 0);
  });
  resizeObserver.observe(container.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or a full quota: the choice just doesn't persist.
  }
};
const setColourMode = (mode: ColourMode) => {
  colourMode.value = mode;
  remember(COLOUR_MODE_STORAGE_KEY, mode);
};
watch(showFree, (shown) => remember(SHOW_FREE_STORAGE_KEY, String(shown)));

const rowsById = computed(
  () => new Map(props.datasets.map((row) => [row.id, row])),
);
const fullRoot = computed(() =>
  buildSpaceHierarchy(props.datasets, { free: showFree.value }),
);
const slots = computed(() =>
  fullRoot.value
    ? branchSlots(fullRoot.value)
    : new Map<number, number | null>(),
);

function findBox(box: SpaceBox, id: number): SpaceBox[] | null {
  if (box.dataset.id === id) return [box];
  for (const child of box.children) {
    if (child.kind !== "dataset") continue;
    const path = findBox(child, id);
    if (path) return [box, ...path];
  }
  return null;
}

const zoomPath = computed<SpaceBox[]>(() => {
  const root = fullRoot.value;
  if (!root) return [];
  return (zoomId.value !== null && findBox(root, zoomId.value)) || [root];
});
const zoomBox = computed(() => zoomPath.value.at(-1));

const laid = computed(() =>
  zoomBox.value && width.value > 0 && height.value > 0
    ? layoutSpace(zoomBox.value, width.value, height.value)
    : null,
);
type VisibleNode = LaidOut & { data: SpaceNode };

const visibleNodes = computed(() =>
  (laid.value?.descendants() ?? []).filter(
    (node): node is VisibleNode =>
      node.depth > 0 &&
      node.data.kind !== "own" &&
      node.x1 - node.x0 >= MIN_TILE_PX &&
      node.y1 - node.y0 >= MIN_TILE_PX,
  ),
);
const nodesByKey = computed(
  () => new Map(visibleNodes.value.map((node) => [node.data.key, node])),
);

const allGrowths = computed(() =>
  (fullRoot.value ? flatten(fullRoot.value) : []).map((node) =>
    node.kind === "dataset" ? null : node.growth,
  ),
);
function flatten(node: SpaceNode): SpaceNode[] {
  return node.kind === "dataset"
    ? [node, ...node.children.flatMap(flatten)]
    : [node];
}
const scale = computed(() => growthScale(allGrowths.value));

const poolBytes = computed(() => {
  const root = fullRoot.value?.dataset;
  if (!root) return 0;
  return root.used + (showFree.value ? root.available : 0);
});

function growthOf(node: SpaceNode) {
  if (node.kind === "dataset") return node.dataset.growth?.used ?? null;
  return node.growth;
}

function colourOf(node: SpaceNode) {
  if (node.kind === "free") return "transparent";
  if (colourMode.value === "growth") {
    const growth = growthOf(node);
    if (growth === null) return "var(--space-none)";
    const position = scale.value.position(growth);
    const pole = position >= 0 ? "--space-grow" : "--space-shrink";
    return `color-mix(in oklab, var(${pole}) ${Math.round(Math.abs(position) * 100)}%, var(--space-mid))`;
  }
  const slot = slots.value.get(node.dataset.id);
  return slot === null || slot === undefined
    ? "var(--space-other)"
    : `var(--space-${slot + 1})`;
}

function nodeStyle(node: VisibleNode) {
  const colour = colourOf(node.data);
  return {
    left: `${node.x0}px`,
    top: `${node.y0}px`,
    width: `${node.x1 - node.x0}px`,
    height: `${node.y1 - node.y0}px`,
    backgroundColor:
      node.data.kind === "dataset"
        ? `color-mix(in oklab, ${colour} 30%, var(--ui-bg))`
        : colour,
  };
}

const childBoxes = (box: SpaceBox) =>
  box.children.filter((child): child is SpaceBox => child.kind === "dataset");

/** The first-level box under the zoom root that holds `node`. */
function branchOf(node: LaidOut): LaidOut | undefined {
  return node.ancestors().find((ancestor) => ancestor.depth === 1);
}

function activate(node: LaidOut) {
  const branch = branchOf(node);
  if (branch?.data.kind !== "dataset") return;
  if (childBoxes(branch.data).length > 0) {
    zoomId.value = branch.data.dataset.id;
    hoveredKey.value = null;
  } else {
    navigateTo(`/datasets/${branch.data.dataset.id}`);
  }
}

function zoomOut() {
  const parent = zoomPath.value.at(-2);
  zoomId.value = parent ? parent.dataset.id : null;
}

const nodeFrom = (target: EventTarget | null) => {
  const element = (target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-key]",
  );
  return element?.dataset.key ? nodesByKey.value.get(element.dataset.key) : undefined;
};

function onPointerMove(event: PointerEvent) {
  const node = nodeFrom(event.target);
  hoveredKey.value = node?.data.key ?? null;
  const bounds = container.value?.getBoundingClientRect();
  if (bounds) {
    pointer.value = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }
}

function onFocusIn(event: FocusEvent) {
  const node = nodeFrom(event.target);
  if (!node) return;
  hoveredKey.value = node.data.key;
  pointer.value = { x: node.x0 + 8, y: node.y0 + 8 };
}

function onClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("a")) return;
  const node = nodeFrom(event.target);
  if (node) activate(node);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && zoomPath.value.length > 1) {
    event.preventDefault();
    zoomOut();
  } else if (event.key === "Enter") {
    const node = nodeFrom(event.target);
    if (node && !(event.target as HTMLElement).closest("a")) activate(node);
  }
}

const KIND_LABELS = {
  data: "Data",
  snapshots: "Snapshots",
  reserved: "Reserved (refreservation)",
  free: "Free",
} as const;

const formatShare = (bytes: number) =>
  poolBytes.value > 0
    ? `${((bytes / poolBytes.value) * 100).toFixed(1)} % of pool`
    : "";

const formatGrowth = (bytes: number | null, sinceAt: string | undefined) => {
  if (bytes === null || !sinceAt) return "No history yet";
  const sign = bytes > 0 ? "+" : bytes < 0 ? "−" : "±";
  return `${sign}${formatZfsBytes(Math.abs(bytes))} since ${formatDate(sinceAt)}`;
};

const tooltip = computed(() => {
  const node = hoveredKey.value
    ? nodesByKey.value.get(hoveredKey.value)
    : undefined;
  if (!node) return null;
  const space = node.data;
  const row = rowsById.value.get(space.dataset.id);
  const bytes = space.kind === "dataset" ? space.dataset.used : space.bytes;
  const lines: string[] = [];
  if (space.kind === "dataset") {
    const split = spaceSplit(
      space.dataset,
      childBoxes(space).reduce((sum, child) => sum + child.dataset.used, 0),
    );
    lines.push(
      `Data ${formatZfsBytes(split.data)} · snapshots ${formatZfsBytes(split.snapshots)} · children ${formatZfsBytes(split.children)}`,
    );
    if (split.reserved > 0) lines.push(`Reserved ${formatZfsBytes(split.reserved)}`);
    if (row?.compressRatio) lines.push(`Compression ${row.compressRatio.toFixed(2)}×`);
  }
  if (space.kind !== "free") {
    lines.push(formatGrowth(growthOf(space), space.dataset.growth?.sinceAt));
  }
  if (space.kind === "snapshots") {
    lines.push("Includes space shared with clones");
  }
  return {
    title: space.dataset.name,
    kind: space.kind === "dataset" ? null : KIND_LABELS[space.kind],
    size: `${formatZfsBytes(bytes)} · ${formatShare(bytes)}`,
    lines,
    left: Math.min(pointer.value.x + 12, Math.max(0, width.value - 280)),
    top: pointer.value.y + 16,
  };
});

const legendBranches = computed(() => {
  const root = fullRoot.value;
  if (!root) return [];
  const branches = childBoxes(root).sort(
    (a, b) => b.dataset.used - a.dataset.used,
  );
  return [
    ...branches.slice(0, BRANCH_SLOTS).map((branch, index) => ({
      label: lastSegment(branch.dataset.name),
      colour: `var(--space-${index + 1})`,
    })),
    {
      label: branches.length > BRANCH_SLOTS ? "Other, pool root" : "Pool root",
      colour: "var(--space-other)",
    },
  ];
});

const { formatZfsBytes } = useZfsByteSystem();
</script>

<template>
  <div class="space-map flex flex-col gap-3 py-4" data-testid="dataset-treemap">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Zoom" class="flex flex-wrap items-center gap-1 text-sm">
        <template v-for="(box, index) in zoomPath" :key="box.key">
          <UIcon
            v-if="index > 0"
            name="i-lucide-chevron-right"
            class="text-dimmed size-4"
          />
          <span
            v-if="index === zoomPath.length - 1"
            class="text-highlighted font-mono"
            aria-current="location"
          >
            {{ index === 0 ? box.dataset.name : lastSegment(box.dataset.name) }}
          </span>
          <UButton
            v-else
            color="neutral"
            variant="link"
            size="sm"
            class="px-0 font-mono"
            @click="zoomId = index === 0 ? null : box.dataset.id"
          >
            {{ index === 0 ? box.dataset.name : lastSegment(box.dataset.name) }}
          </UButton>
        </template>
      </nav>
      <div class="flex items-center gap-4">
        <USwitch v-model="showFree" label="Free space" />
        <UFieldGroup>
          <UButton
            color="neutral"
            :variant="colourMode === 'branch' ? 'subtle' : 'outline'"
            :aria-pressed="colourMode === 'branch'"
            label="By branch"
            @click="setColourMode('branch')"
          />
          <UButton
            color="neutral"
            :variant="colourMode === 'growth' ? 'subtle' : 'outline'"
            :aria-pressed="colourMode === 'growth'"
            label="By growth"
            @click="setColourMode('growth')"
          />
        </UFieldGroup>
      </div>
    </div>

    <div
      ref="container"
      role="application"
      aria-label="Dataset space map"
      class="relative h-[80vh] min-h-90 w-full overflow-hidden rounded-md"
      @pointermove="onPointerMove"
      @pointerleave="hoveredKey = null"
      @focusin="onFocusIn"
      @focusout="hoveredKey = null"
      @click="onClick"
      @keydown="onKeydown"
    >
      <p v-if="!fullRoot" class="text-dimmed py-4 text-sm">
        No datasets reported.
      </p>
      <div
        v-for="node in visibleNodes"
        :key="node.data.key"
        :data-key="node.data.key"
        :data-kind="node.data.kind"
        class="space-node absolute"
        :class="[
          `space-${node.data.kind}`,
          { 'space-hovered': node.data.key === hoveredKey },
        ]"
        :style="nodeStyle(node)"
        :tabindex="hasHeader(node) ? 0 : undefined"
        :role="hasHeader(node) ? 'button' : undefined"
        :aria-label="
          hasHeader(node)
            ? `${node.data.dataset.name}, ${formatZfsBytes(node.data.dataset.used)}`
            : undefined
        "
      >
        <div
          v-if="hasHeader(node)"
          class="flex h-5 min-w-0 items-center gap-2 px-1 text-xs"
        >
          <NuxtLink
            :to="`/datasets/${node.data.dataset.id}`"
            class="text-highlighted truncate font-mono hover:underline"
            :title="node.data.dataset.name"
          >
            {{ lastSegment(node.data.dataset.name) }}
          </NuxtLink>
          <span class="text-muted tabular shrink-0">
            {{ formatZfsBytes(node.data.dataset.used) }}
          </span>
        </div>
      </div>
      <div
        v-if="tooltip"
        class="bg-default ring-default pointer-events-none absolute z-10 flex max-w-72 flex-col gap-0.5 rounded-md px-3 py-2 text-xs shadow-lg ring"
        :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"
        role="tooltip"
      >
        <span class="text-highlighted font-mono break-all">{{ tooltip.title }}</span>
        <span v-if="tooltip.kind" class="text-muted">{{ tooltip.kind }}</span>
        <span class="text-highlighted tabular">{{ tooltip.size }}</span>
        <span v-for="line in tooltip.lines" :key="line" class="text-muted tabular">
          {{ line }}
        </span>
      </div>
    </div>

    <div class="text-muted flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <template v-if="colourMode === 'branch'">
        <span
          v-for="entry in legendBranches"
          :key="entry.label"
          class="flex items-center gap-1.5"
        >
          <span class="size-3 rounded-sm" :style="{ backgroundColor: entry.colour }" />
          <span class="font-mono">{{ entry.label }}</span>
        </span>
      </template>
      <template v-else>
        <span v-if="scale.clamp > 0" class="flex items-center gap-1.5">
          <span class="tabular">−{{ formatZfsBytes(scale.clamp) }}</span>
          <span class="space-diverging h-3 w-32 rounded-sm" />
          <span class="tabular">+{{ formatZfsBytes(scale.clamp) }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span class="size-3 rounded-sm" style="background-color: var(--space-none)" />
          No history
        </span>
      </template>
      <span class="flex items-center gap-1.5">
        <span class="space-snapshots size-3 rounded-sm" style="background-color: var(--space-other)" />
        Snapshots
      </span>
      <span class="flex items-center gap-1.5">
        <span class="space-reserved size-3 rounded-sm" style="background-color: var(--space-other)" />
        Reserved
      </span>
      <span v-if="showFree" class="flex items-center gap-1.5">
        <span class="space-free size-3 rounded-sm" />
        Free
      </span>
      <span class="text-dimmed ml-auto">
        Click a box to zoom in, Escape to zoom out
      </span>
    </div>
  </div>
</template>

<style scoped>
.space-map {
  --space-1: #2a78d6;
  --space-2: #eb6834;
  --space-3: #1baf7a;
  --space-4: #eda100;
  --space-5: #e87ba4;
  --space-6: #008300;
  --space-7: #4a3aa7;
  --space-other: #a3a29c;
  --space-grow: #e34948;
  --space-shrink: #2a78d6;
  --space-mid: #f0efec;
  --space-none: var(--ui-bg-accented);
  --space-hatch: rgb(255 255 255 / 0.5);
}

:global(.dark) .space-map {
  --space-1: #3987e5;
  --space-2: #d95926;
  --space-3: #199e70;
  --space-4: #c98500;
  --space-5: #d55181;
  --space-6: #008300;
  --space-7: #9085e9;
  --space-other: #6b6a65;
  --space-grow: #e66767;
  --space-shrink: #3987e5;
  --space-mid: #383835;
  --space-hatch: rgb(0 0 0 / 0.45);
}

.space-node {
  transition:
    left 200ms ease,
    top 200ms ease,
    width 200ms ease,
    height 200ms ease;
}

.space-node:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
  z-index: 1;
}

.space-hovered:not(.space-dataset) {
  filter: brightness(1.1);
}

.space-snapshots {
  background-image: repeating-linear-gradient(
    45deg,
    var(--space-hatch) 0 2px,
    transparent 2px 6px
  );
}

.space-reserved {
  background-image: radial-gradient(var(--space-hatch) 1px, transparent 1.5px);
  background-size: 5px 5px;
}

.space-free {
  border: 1px dashed var(--ui-border-accented);
}

.space-diverging {
  background: linear-gradient(
    to right,
    var(--space-shrink),
    var(--space-mid),
    var(--space-grow)
  );
}

@media (prefers-reduced-motion: reduce) {
  .space-node {
    transition: none;
  }
}
</style>
