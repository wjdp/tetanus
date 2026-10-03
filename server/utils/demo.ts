import { type CadenceOverrides, DEMO_CADENCES } from "#shared/hostFreshness";
import { simulatorEnabled } from "#shared/simulator";

export function isDemo(): boolean {
  return useRuntimeConfig().public.demo === true;
}

export function collectorCadences(): CadenceOverrides {
  return isDemo() ? DEMO_CADENCES : {};
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

export function requireSimulator() {
  const { demo, faultSimulator } = useRuntimeConfig().public;
  const enabled = simulatorEnabled({
    dev: import.meta.dev,
    demo: demo === true,
    faultSimulator: faultSimulator === true,
  });
  if (!enabled) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
}
