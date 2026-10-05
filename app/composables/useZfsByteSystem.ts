import type { ByteSystem } from "~/utils/format";

export const ZFS_BYTE_SYSTEM_COOKIE = "zfs.byteSystem";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const parseSystem = (raw: unknown): ByteSystem =>
  raw === "decimal" ? "decimal" : "binary";

export function useZfsByteSystem() {
  const cookie = useCookie<unknown>(ZFS_BYTE_SYSTEM_COOKIE, {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });
  const state = useState(ZFS_BYTE_SYSTEM_COOKIE, () =>
    parseSystem(cookie.value),
  );

  const system = computed<ByteSystem>({
    get: () => state.value,
    set: (value) => {
      state.value = value;
      cookie.value = value;
    },
  });

  const formatZfsBytes = (bytes: number | null | undefined) =>
    formatBytes(bytes, state.value);

  return { system, formatZfsBytes };
}
