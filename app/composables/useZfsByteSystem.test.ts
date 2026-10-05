// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { clearCookie, writeCookie } from "~~/test/cookies";
import { useZfsByteSystem, ZFS_BYTE_SYSTEM_COOKIE } from "./useZfsByteSystem";

const mountSystem = async () => {
  let units!: ReturnType<typeof useZfsByteSystem>;
  await mountSuspended(
    defineComponent({
      setup() {
        units = useZfsByteSystem();
        return () => h("div");
      },
    }),
  );
  return units;
};

beforeEach(() => {
  clearCookie(ZFS_BYTE_SYSTEM_COOKIE);
  clearNuxtState(ZFS_BYTE_SYSTEM_COOKIE);
});

describe("useZfsByteSystem", () => {
  it("defaults to binary units like zfs and zpool", async () => {
    const { system, formatZfsBytes } = await mountSystem();
    expect(system.value).toBe("binary");
    expect(formatZfsBytes(2 ** 41)).toBe("2.00 TiB");
  });

  it("reads a stored choice of decimal units", async () => {
    writeCookie(ZFS_BYTE_SYSTEM_COOKIE, "decimal");
    const { formatZfsBytes } = await mountSystem();
    expect(formatZfsBytes(2e12)).toBe("2.00 TB");
  });

  it("stores a change and shares it with other users of the setting", async () => {
    const first = await mountSystem();
    const second = await mountSystem();
    first.system.value = "decimal";
    await nextTick();

    expect(second.formatZfsBytes(2e12)).toBe("2.00 TB");
    expect(document.cookie).toContain(`${ZFS_BYTE_SYSTEM_COOKIE}=decimal`);
  });
});
