// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it, vi } from "vitest";
import Diary from "./Diary.vue";

let entries = [{ title: "tank scrub finished with 0 errors" }];
let requests = 0;

registerEndpoint("/api/pools/7/diary", () => {
  requests += 1;
  const items = entries.map((entry, index) => ({
    id: entries.length - index,
    subjectType: "pool",
    subjectId: 7,
    at: new Date(Date.UTC(2026, 8, 1, 0, entries.length - index)).toISOString(),
    kind: "auto",
    eventType: null,
    data: null,
    body: "",
    subjectLabel: null,
    subjectPath: null,
    ...entry,
  }));
  return { items, hasMore: false, total: items.length };
});

describe("pool diary", () => {
  it("refreshes when the page does, so archive entries appear", async () => {
    const diary = await mountSuspended(Diary, {
      props: { poolId: 7, revision: 0 },
    });
    await vi.waitFor(() =>
      expect(diary.text()).toContain("tank scrub finished with 0 errors"),
    );

    entries = [{ title: "Pool archived" }, ...entries];
    await diary.setProps({ revision: 1 });

    await vi.waitFor(() => expect(diary.text()).toContain("Pool archived"));
    expect(requests).toBe(2);
  });
});
