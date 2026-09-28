const DAY_SECONDS = 24 * 60 * 60;

const pad = (value: number) => String(value).padStart(2, "0");

const localDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const localTime = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const isMidnight = (date: Date) =>
  date.getHours() === 0 && date.getMinutes() === 0;

export function formatTick(epochSeconds: number, incrementSeconds: number) {
  const date = new Date(epochSeconds * 1000);
  return incrementSeconds >= DAY_SECONDS || isMidnight(date)
    ? localDate(date)
    : localTime(date);
}

export function formatLegendTime(epochSeconds: number | null) {
  if (epochSeconds === null || !Number.isFinite(epochSeconds)) return "—";
  const date = new Date(epochSeconds * 1000);
  return `${localDate(date)} ${localTime(date)}`;
}
