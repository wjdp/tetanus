import { describe, expect, it } from "vitest";
import {
  DIARY_EVENT_TYPES,
  type DiaryEventType,
  diaryEventIcon,
} from "./diaryEvent";

const FIXED_ICONS: Partial<Record<DiaryEventType, string>> = {
  "fault-accepted": "i-lucide-shield-check",
  "acceptance-superseded": "i-lucide-shield-off",
  "acceptance-cleared": "i-lucide-shield-off",
  "fault-acknowledged": "i-lucide-eye",
  "acknowledgement-superseded": "i-lucide-eye-off",
  "acknowledgement-cleared": "i-lucide-eye-off",
  "disk-appeared": "i-lucide-plug-zap",
  "moved-host": "i-lucide-move-right",
  "pool-moved": "i-lucide-move-right",
  "pool-state-changed": "i-lucide-database",
  "scrub-finished": "i-lucide-scan-line",
  "resilver-finished": "i-lucide-scan-line",
  "scan-finished": "i-lucide-scan-line",
  "alias-set": "i-lucide-tag",
  "alias-drift": "i-lucide-tag",
  "identity-conflict": "i-lucide-octagon-alert",
  "usage-changed": "i-lucide-hard-drive",
  "dataset-created": "i-lucide-folder-tree",
  "dataset-destroyed": "i-lucide-folder-tree",
  "collector-status-changed": "i-lucide-server",
  "events-gap": "i-lucide-history",
  "events-reset": "i-lucide-history",
  "imported-from-scrutiny": "i-lucide-import",
  "fault-opened": "i-lucide-siren",
  "fault-state-changed": "i-lucide-siren",
  "fault-resolved": "i-lucide-siren",
};

describe("diaryEventIcon", () => {
  it.each(DIARY_EVENT_TYPES)("has an icon for %s", (eventType) => {
    const icon = diaryEventIcon({ eventType, data: {} });
    if (typeof icon === "string") expect(icon).toMatch(/^i-lucide-/);
    else expect(icon.dot).toBe("unknown");
  });

  it.each(Object.entries(FIXED_ICONS))("uses %s → %s", (eventType, icon) => {
    expect(diaryEventIcon({ eventType })).toBe(icon);
  });

  it.each(["state-changed", "override-set"])(
    "borrows the new lifecycle icon for %s",
    (eventType) => {
      expect(
        diaryEventIcon({ eventType, data: { from: "in-use", to: "dead" } }),
      ).toBe("i-lucide-skull");
      expect(diaryEventIcon({ eventType, data: { to: "missing" } })).toBe(
        "i-lucide-search",
      );
    },
  );

  it("falls back when an override is cleared", () => {
    expect(
      diaryEventIcon({ eventType: "override-set", data: { to: null } }),
    ).toBe("i-lucide-circle");
  });

  it.each(["smart-status-changed", "attribute-status-changed"])(
    "shows the new status as a dot for %s",
    (eventType) => {
      expect(
        diaryEventIcon({ eventType, data: { from: "passed", to: "failed" } }),
      ).toEqual({ dot: "failed" });
      expect(diaryEventIcon({ eventType })).toEqual({ dot: "unknown" });
    },
  );

  it.each(["vdev-joined", "vdev-left", "vdev-state-changed"])(
    "uses the vdev type icon for %s",
    (eventType) => {
      expect(diaryEventIcon({ eventType, data: { type: "mirror" } })).toBe(
        "i-lucide-copy",
      );
      expect(diaryEventIcon({ eventType, data: { poolId: 1 } })).toBe(
        "i-lucide-layers",
      );
      expect(diaryEventIcon({ eventType, data: { type: "weird" } })).toBe(
        "i-lucide-layers",
      );
    },
  );

  it("uses a pencil for manual entries", () => {
    expect(diaryEventIcon({ eventType: null, manual: true })).toBe(
      "i-lucide-pencil",
    );
  });

  it("uses a plain circle for unknown event types", () => {
    expect(diaryEventIcon({ eventType: "something-new" })).toBe(
      "i-lucide-circle",
    );
    expect(diaryEventIcon({ eventType: null })).toBe("i-lucide-circle");
    expect(diaryEventIcon({ eventType: "toString" })).toBe("i-lucide-circle");
  });
});
