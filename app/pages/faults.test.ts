// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import type { FaultView } from "#shared/faults";
import { FakeEventSource } from "~~/test/fakeEventSource";
import FaultsPage from "./faults.vue";

const DAY_MS = 24 * 60 * 60_000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

const fault = (
  id: number,
  overrides: Partial<FaultView> & Pick<FaultView, "kind" | "data">,
): FaultView => ({
  category: "disk",
  severity: "error",
  state: "open",
  key: String(id),
  note: "",
  openedAt: daysAgo(6),
  lastSeenAt: daysAgo(0),
  resolvedAt: null,
  stateChangedAt: daysAgo(6),
  subject: { type: "disk", id: 12, label: "A7", hostName: "atlas" },
  id,
  ...overrides,
});

const FAULTS: FaultView[] = [
  fault(1, {
    kind: "smart-attribute",
    data: {
      attrId: "5",
      name: "Reallocated Sectors Count",
      value: 24,
      trend: "worsening",
    },
  }),
  fault(2, {
    kind: "pool-degraded",
    category: "zfs",
    severity: "warning",
    openedAt: daysAgo(1),
    data: { poolName: "vault", state: "DEGRADED" },
    subject: { type: "pool", id: 3, label: "vault", hostName: "styx" },
  }),
  fault(3, {
    kind: "smart-attribute",
    state: "acknowledged",
    severity: "warning",
    note: "Watching it",
    data: {
      attrId: "197",
      name: "Current Pending Sector Count",
      value: 2,
      acceptedValue: 2,
      acceptanceKind: "acknowledge",
    },
    subject: { type: "disk", id: 13, label: "A12", hostName: "atlas" },
  }),
  fault(4, {
    kind: "collector-outdated",
    category: "host",
    severity: "warning",
    data: { version: "0.3.0", currentVersion: "0.3.1" },
    subject: { type: "host", id: 4, label: "bench", hostName: "bench" },
  }),
  fault(5, {
    kind: "pool-degraded",
    category: "zfs",
    severity: "warning",
    state: "resolved",
    resolvedAt: daysAgo(3),
    data: { poolName: "tank", state: "DEGRADED" },
    subject: { type: "pool", id: 4, label: "tank", hostName: "styx" },
  }),
];

let faults = FAULTS;
const listQueries: Record<string, string>[] = [];
registerEndpoint("/api/faults", (event) => {
  const query = Object.fromEntries(
    new URL(event.path, "http://x").searchParams,
  );
  listQueries.push(query);
  const states = (query.state ?? "open,acknowledged").split(",");
  return {
    faults: faults.filter((row) => states.includes(row.state)),
    counts: { open: 3, acknowledged: 1, accepted: 2, resolved: 31 },
    badge: 1,
  };
});

const actions: { method: string; path: string; body: unknown }[] = [];
const recordAction = async (event: {
  method: string;
  path: string;
  node: { req: unknown };
}) => {
  const { readBody } = await import("h3");
  const body =
    event.method === "POST"
      ? await readBody(event as Parameters<typeof readBody>[0])
      : undefined;
  actions.push({
    method: event.method,
    path: event.path.replace(/^\/_/, ""),
    body,
  });
  return {};
};
for (const id of [1, 2, 3, 4]) {
  registerEndpoint(`/api/faults/${id}/acknowledge`, {
    method: "POST",
    handler: recordAction,
  });
  registerEndpoint(`/api/faults/${id}/accept`, {
    method: "POST",
    handler: recordAction,
  });
  registerEndpoint(`/api/faults/${id}/acknowledgement`, {
    method: "DELETE",
    handler: recordAction,
  });
}

registerEndpoint("/api/hosts", () => [
  { id: 1, name: "atlas", displayName: null, lastSeenAt: daysAgo(0.01) },
  { id: 2, name: "styx", displayName: null, lastSeenAt: daysAgo(1) },
]);

const smartRequests: string[] = [];
registerEndpoint("/api/disks/12/smart", (event) => {
  smartRequests.push(event.path);
  return {
    reading: null,
    attributes: [
      {
        attrId: "5",
        name: "Reallocated Sectors Count",
        transformedValue: 24,
        trend: "worsening",
        takenAt: daysAgo(0),
        failureRate: null,
        metadata: null,
        acceptance: null,
      },
    ],
    acceptances: [],
    history: { attributes: {}, temperature: [] },
  };
});

type Page = VueWrapper;

const rows = (page: Page) => page.findAll('[data-testid="fault-row"]');
const row = (page: Page, text: string) => {
  const found = rows(page).find((candidate) => candidate.text().includes(text));
  if (!found) throw new Error(`No row containing ${text}`);
  return found;
};
const button = (scope: ReturnType<typeof row>, label: string) => {
  const found = scope
    .findAll("button")
    .find((candidate) => candidate.text() === label);
  if (!found) throw new Error(`No ${label} button`);
  return found;
};

const mounted: Page[] = [];

const mountPage = async (
  route = "/faults",
  settled = '[data-testid="fault-row"]',
) => {
  const page = await mountSuspended(FaultsPage, {
    route,
    attachTo: document.body,
  });
  mounted.push(page);
  await vi.waitFor(() => expect(page.find(settled).exists()).toBe(true));
  return page;
};

beforeEach(() => {
  for (const page of mounted.splice(0)) page.unmount();
  FakeEventSource.install();
  clearNuxtData();
  faults = FAULTS;
  listQueries.length = 0;
  actions.length = 0;
  smartRequests.length = 0;
});

describe("faults page", () => {
  it("shows live faults by default", async () => {
    const page = await mountPage();

    expect(listQueries.at(-1)).toEqual({ state: "open,acknowledged" });
    expect(rows(page)).toHaveLength(4);
    expect(page.text()).toContain("Live4");
    expect(page.text()).toContain("Accepted2");
    expect(page.text()).toContain("Resolved31");
    expect(page.text()).toContain("All37");
  });

  it("renders host, subject, title, age and note", async () => {
    const page = await mountPage();

    const smart = row(page, "Reallocated");
    expect(smart.text()).toContain("atlas");
    expect(smart.text()).toContain("A7");
    expect(smart.text()).toContain("Reallocated Sectors Count 24, worsening");
    expect(smart.text()).toContain("since 6 d");
    expect(row(page, "Pending").get('[data-testid="fault-note"]').text()).toBe(
      "Watching it",
    );
    expect(row(page, "Pool vault DEGRADED").text()).toContain("styx");
  });

  it("colours the gutter by state and severity", async () => {
    const page = await mountPage("/faults?state=all");

    expect(row(page, "Reallocated").classes()).toContain("border-s-error");
    expect(row(page, "vault").classes()).toContain("border-s-warning");
    expect(row(page, "Pending").classes()).toContain("border-s-warning");
    const resolved = row(page, "tank");
    expect(resolved.classes()).toContain("border-s-transparent");
    expect(resolved.classes()).toContain("opacity-60");
    expect(resolved.text()).toContain("resolved 3 d ago");
    expect(resolved.findAll("button")).toHaveLength(0);
  });

  it("reads every filter from the query string", async () => {
    await mountPage(
      "/faults?state=resolved&category=zfs&severity=warning&host=styx",
    );

    expect(listQueries.at(-1)).toEqual({
      state: "resolved",
      category: "zfs",
      severity: "warning",
      host: "styx",
    });
  });

  it("ignores unknown filter values", async () => {
    await mountPage("/faults?state=bogus&category=nope");

    expect(listQueries.at(-1)).toEqual({ state: "open,acknowledged" });
  });

  it("writes the state filter back to the query string", async () => {
    const page = await mountPage("/faults?category=zfs");

    const tab = page
      .findAll('[role="tab"]')
      .find((candidate) => candidate.text().startsWith("Resolved"));
    expect(tab).toBeDefined();
    await tab?.trigger("mousedown", { button: 0 });

    const router = useRouter();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({
        category: "zfs",
        state: "resolved",
      }),
    );
    await flushPromises();
    expect(listQueries.at(-1)).toEqual({ state: "resolved", category: "zfs" });
  });

  it("opens the acceptance dialog for a SMART attribute", async () => {
    const page = await mountPage();

    await button(row(page, "Reallocated"), "Acknowledge").trigger("click");
    await flushPromises();

    expect(smartRequests.length).toBeGreaterThan(0);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Acknowledge Reallocated Sectors Count",
      ),
    );
    expect(actions).toEqual([]);
  });

  it("offers accept and clear on an acknowledged SMART attribute", async () => {
    const page = await mountPage();

    const acknowledged = row(page, "Pending");
    expect(
      acknowledged.findAll("button").map((candidate) => candidate.text()),
    ).toEqual(["Accept", "Clear"]);

    await button(acknowledged, "Clear").trigger("click");

    await vi.waitFor(() =>
      expect(actions).toEqual([
        {
          method: "DELETE",
          path: "/api/faults/3/acknowledgement",
          body: undefined,
        },
      ]),
    );
  });

  it("acknowledges other kinds with a note", async () => {
    const page = await mountPage();

    const pool = row(page, "vault");
    expect(pool.findAll("button").map((candidate) => candidate.text())).toEqual(
      ["Acknowledge", "Accept"],
    );

    await button(pool, "Acknowledge").trigger("click");
    const textarea = await vi.waitFor(() => {
      const found = document.body.querySelector<HTMLTextAreaElement>(
        'form[aria-label="Acknowledge"] textarea',
      );
      if (!found) throw new Error("note popover not open");
      return found;
    });
    textarea.value = "Resilvering onto the new disk";
    textarea.dispatchEvent(new Event("input"));
    document.body
      .querySelector('form[aria-label="Acknowledge"]')
      ?.dispatchEvent(new Event("submit"));

    await vi.waitFor(() =>
      expect(actions).toEqual([
        {
          method: "POST",
          path: "/api/faults/2/acknowledge",
          body: { note: "Resilvering onto the new disk" },
        },
      ]),
    );
  });

  it("offers only acknowledge and the upgrade command for a collector fault", async () => {
    const page = await mountPage();

    const collector = row(page, "Collector 0.3.0 is behind 0.3.1");
    expect(collector.get("code").text()).toMatch(/install\.sh \| sudo bash$/);
    expect(
      collector
        .findAll("button")
        .map((candidate) => candidate.text())
        .filter((label) => !label.includes("install.sh")),
    ).toEqual(["Acknowledge"]);
  });

  it("links each row to its subject", async () => {
    const page = await mountPage();

    const href = (text: string) =>
      row(page, text)
        .get('[data-testid="fault-subject-link"]')
        .attributes("href");
    expect(href("Reallocated")).toBe("/disks/12");
    expect(href("vault")).toBe("/zfs/3");
    expect(href("Collector")).toBe("/settings/hosts");
  });

  it("says nothing needs attention when the live view is empty", async () => {
    faults = [];
    const page = await mountPage("/faults", '[data-testid="faults-empty"]');

    const empty = page.get('[data-testid="faults-empty"]');
    expect(empty.text()).toContain("Nothing needs attention");
    expect(empty.text()).toContain("Last ingest 14 min ago");
  });

  it("says no faults match when a filtered view is empty", async () => {
    faults = [];
    const page = await mountPage(
      "/faults?host=styx",
      '[data-testid="faults-empty"]',
    );

    expect(page.get('[data-testid="faults-empty"]').text()).toBe(
      "No faults match these filters.",
    );
  });
});
