// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrutinyImportResult } from "#shared/schemas/import";
import { emitTask, FakeEventSource } from "~~/test/fakeEventSource";
import ImportPage from "./import.vue";

const TASK_ID = 7;

const preview: ScrutinyImportResult<string> = {
  dryRun: true,
  devices: [
    {
      key: "0x5000ccad5ed6ee0c",
      model: "WDC WD120EMAZ-11BLFA0",
      serial: "1AQLP5ME",
      matched: "wwn",
      diskId: 4,
      cutoff: "2026-09-10T12:00:00.000Z",
      readings: 25,
      temperatures: 80,
      skipped: 1,
    },
    {
      key: "0x5000c50bd5ec0ece",
      model: "ST16000NM001G-2KK103",
      serial: "PH8Y0FJQ",
      matched: "created",
      diskId: null,
      cutoff: null,
      readings: 1,
      temperatures: 1,
      skipped: 0,
    },
    {
      key: "453939583131",
      model: "Samsung SSD 970 EVO Plus",
      serial: "453939583131",
      matched: "serial",
      diskId: 5,
      cutoff: null,
      readings: 0,
      temperatures: 0,
      skipped: 0,
      error: "scrutiny returned HTTP 500",
    },
  ],
};

const summary: ScrutinyImportResult<string> = {
  dryRun: false,
  devices: preview.devices.map((device) =>
    device.matched === "created" ? { ...device, diskId: 12 } : device,
  ),
};

const posted: unknown[] = [];

registerEndpoint("/api/hosts", () => [
  { id: 1, name: "mars", displayName: null, lastRuns: {} },
  { id: 2, name: "venus", displayName: "Venus", lastRuns: {} },
]);

registerEndpoint("/api/import/scrutiny", {
  method: "POST",
  handler: async (event) => {
    const body = await readBody(event);
    posted.push(body);
    return body.dryRun ? preview : { taskId: TASK_ID };
  },
});

registerEndpoint(`/api/import/scrutiny/${TASK_ID}`, () => summary);

beforeEach(() => {
  FakeEventSource.install();
  posted.length = 0;
});

function button(
  page: Awaited<ReturnType<typeof mountSuspended>>,
  label: string,
) {
  const found = page
    .findAll("button")
    .find((candidate: { text(): string }) => candidate.text() === label);
  if (!found) throw new Error(`No ${label} button`);
  return found;
}

const devices = '[data-testid="scrutiny-devices"]';

async function submitPreview(page: Awaited<ReturnType<typeof mountSuspended>>) {
  await page.get("form").trigger("submit");
  await vi.waitFor(() => expect(page.find(devices).exists()).toBe(true));
}

describe("import settings page", () => {
  it("defaults to mars's scrutiny and the first host, with Import disabled", async () => {
    const page = await mountSuspended(ImportPage);

    expect(
      (page.get('input[type="url"]').element as HTMLInputElement).value,
    ).toBe("https://scrutiny.wjdp.uk");
    expect(page.text()).toContain("mars");
    expect(page.text()).toContain("daily resolution");
    expect(button(page, "Import").attributes("disabled")).toBeDefined();
  });

  it("previews the devices with their match, disk and cut-off", async () => {
    const page = await mountSuspended(ImportPage);

    await submitPreview(page);

    expect(posted).toEqual([
      { url: "https://scrutiny.wjdp.uk", hostId: 1, dryRun: true },
    ]);
    const table = page.get(devices);
    expect(table.text()).toContain("Would import 26 SMART points");
    expect(table.text()).toContain("WDC WD120EMAZ-11BLFA0");
    expect(table.text()).toContain("WWN");
    expect(table.text()).toContain("New disk");
    expect(table.text()).toContain("2026-09-10");
    expect(table.text()).toContain("all");
    expect(table.text()).toContain("scrutiny returned HTTP 500");
    expect(table.get('a[href="/disks/4"]').text()).toBe("#4");
    expect(button(page, "Import").attributes("disabled")).toBeUndefined();
  });

  it("imports through the task queue and shows the summary when done", async () => {
    const page = await mountSuspended(ImportPage);
    await submitPreview(page);

    await button(page, "Import").trigger("click");
    await vi.waitFor(() =>
      expect(posted.at(-1)).toEqual({
        url: "https://scrutiny.wjdp.uk",
        hostId: 1,
        dryRun: false,
      }),
    );
    await flushPromises();

    emitTask({
      id: TASK_ID,
      name: "import:scrutiny",
      state: "in_progress",
      message: "1 / 3 devices",
    });
    await nextTick();
    expect(page.get('[data-testid="import-progress"]').text()).toBe(
      "1 / 3 devices",
    );

    emitTask({ id: TASK_ID, name: "import:scrutiny", state: "done" });
    await vi.waitFor(() => {
      expect(page.get(devices).text()).toContain("Imported 26 SMART points");
    });
    expect(page.get(devices).find('a[href="/disks/12"]').exists()).toBe(true);
  });
});

describe("import page in the demo", () => {
  beforeEach(() => {
    useRuntimeConfig().public.demo = true;
  });

  afterEach(() => {
    useRuntimeConfig().public.demo = false;
  });

  it("shows a disabled note instead of the form", async () => {
    const page = await mountSuspended(ImportPage);
    expect(page.find('[data-testid="demo-disabled-note"]').exists()).toBe(true);
    expect(page.find('[data-testid="scrutiny-import"]').exists()).toBe(false);
  });
});
