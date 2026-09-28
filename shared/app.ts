export const APP_NAME = "diskbot";

export function getPageTitle(pageTitle: string | string[]): string {
  const segments = Array.isArray(pageTitle) ? pageTitle : [pageTitle];
  return [...segments, APP_NAME].join(" › ");
}
