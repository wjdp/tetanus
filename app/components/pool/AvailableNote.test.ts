// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import AvailableNote from "./AvailableNote.vue";
import type { PoolVdev } from "./types";

const TIB = 2 ** 40;

const vdev = (
  name: string,
  role: string,
  sizeBytes: number,
  allocBytes: number,
  children: PoolVdev[] = [],
) =>
  ({
    name,
    role,
    sizeBytes,
    allocBytes,
    children,
  }) as unknown as PoolVdev;

const mountNote = (children: PoolVdev[]) =>
  mountSuspended(AvailableNote, {
    props: {
      vdevs: vdev("tank", "root", 22 * TIB, 8 * TIB, children),
      freeBytes: 14 * TIB,
    },
  });

describe("PoolAvailableNote", () => {
  it("explains a special vdev's share of raw free", async () => {
    const note = await mountNote([
      vdev("raidz2-0", "normal", 20 * TIB, 7 * TIB),
      vdev("mirror-1", "special", 2 * TIB, 1 * TIB),
    ]);
    await note.get('[data-testid="available-note"]').trigger("click");
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(document.querySelector(".font-mono")?.textContent).toBe("mirror-1");
    expect(text).toContain(
      "This pool has a special vdev (mirror-1, 2.00 TiB). Its space counts in the raw size and free, but not in Available, because ZFS stores metadata and small blocks on it and nothing else.",
    );
    expect(text).toContain("Raw free on the main vdevs ≈ 13.0 TiB");
  });

  it("stays out of the way without special or dedup vdevs", async () => {
    const note = await mountNote([
      vdev("raidz2-0", "normal", 20 * TIB, 7 * TIB),
    ]);
    expect(note.find('[data-testid="available-note"]').exists()).toBe(false);
  });
});
