export function isDemo(): boolean {
  return useRuntimeConfig().public.demo === true;
}

export function demoForbidden(message: string): never {
  throw createError({ statusCode: 403, statusMessage: message });
}

export function presentSettings<
  T extends { enrolToken: string; config: { notifications: unknown } },
>(settings: T): T {
  if (!isDemo()) return settings;
  return {
    ...settings,
    enrolToken: "demo",
    config: {
      ...settings.config,
      notifications: { pushover: null, webhook: null },
    },
  };
}
