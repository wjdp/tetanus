<script setup lang="ts">
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { alignSeries, type TimeSeries } from "./alignSeries";
import { formatLegendTime, formatTick } from "./timeAxis";

const props = withDefaults(
  defineProps<{ series: TimeSeries[]; unit?: string; height?: number }>(),
  { unit: "", height: 200 },
);

const SERIES_TOKENS = [
  "--ui-text-highlighted",
  "--ui-text-muted",
  "--ui-text-dimmed",
];

const container = useTemplateRef<HTMLDivElement>("container");
const colourMode = useColorMode();
const hasPoints = computed(() =>
  props.series.some((entry) => entry.points.length > 0),
);

let chart: uPlot | undefined;
let resizeObserver: ResizeObserver | undefined;

const cssToken = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const formatValue = (value: number | null) =>
  value === null || value === undefined
    ? "—"
    : `${value}${props.unit ? ` ${props.unit}` : ""}`;

function options(width: number): uPlot.Options {
  const axisColour = cssToken("--ui-text-muted");
  const gridColour = cssToken("--ui-border");
  const axis: uPlot.Axis = {
    stroke: axisColour,
    grid: { stroke: gridColour, width: 1 },
    ticks: { stroke: gridColour, width: 1 },
  };
  return {
    width,
    height: props.height,
    cursor: { points: { size: 8 } },
    legend: { show: true, live: true },
    scales: { x: { time: true } },
    axes: [
      {
        ...axis,
        values: (_chart, splits, _axisIndex, _space, increment) =>
          splits.map((split) => formatTick(split, increment)),
      },
      axis,
    ],
    series: [
      { value: (_chart, value) => formatLegendTime(value) },
      ...props.series.map((entry, index) => ({
        label: entry.label,
        stroke: cssToken(SERIES_TOKENS[index % SERIES_TOKENS.length]),
        width: 2,
        spanGaps: true,
        points: { show: false },
        value: (_chart: uPlot, value: number | null) => formatValue(value),
      })),
    ],
  };
}

function destroyChart() {
  chart?.destroy();
  chart = undefined;
}

async function render() {
  destroyChart();
  const element = container.value;
  if (!element || !hasPoints.value) return;
  const { default: UPlot } = await import("uplot");
  destroyChart();
  chart = new UPlot(
    options(element.clientWidth),
    alignSeries(props.series) as uPlot.AlignedData,
    element,
  );
}

onMounted(() => {
  render();
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!chart || !entry) return;
    chart.setSize({ width: entry.contentRect.width, height: props.height });
  });
  if (container.value) resizeObserver.observe(container.value);
});

watch(
  () => [props.series, props.unit, props.height, colourMode.value],
  () => nextTick(render),
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  destroyChart();
});
</script>

<template>
  <div class="w-full">
    <div ref="container" class="w-full text-xs" />
    <p v-if="!hasPoints" class="text-muted text-sm">No readings in range.</p>
  </div>
</template>
