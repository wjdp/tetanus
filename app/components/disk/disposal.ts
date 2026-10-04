const twoDigits = (value: number) => String(value).padStart(2, "0");

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}
