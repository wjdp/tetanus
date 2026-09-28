export const SPARKLINE_WIDTH = 80;
export const SPARKLINE_HEIGHT = 20;
const STROKE_INSET = 1;

export function sparklinePoints(
  values: number[],
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
): string {
  if (values.length === 0) return "";
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const drawableHeight = height - 2 * STROKE_INSET;
  const step = width / (series.length - 1);
  const yOf = (value: number) =>
    span === 0
      ? height / 2
      : STROKE_INSET + drawableHeight * (1 - (value - min) / span);
  return series
    .map((value, index) => `${round(index * step)},${round(yOf(value))}`)
    .join(" ");
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
