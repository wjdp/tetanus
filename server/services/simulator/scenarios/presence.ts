import { eq } from "drizzle-orm";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { defineScenario } from "../types";

const HOUR_MS = 60 * 60 * 1000;

export const missing = defineScenario({
  id: "disk-missing",
  label: "Missing",
  group: "Presence",
  subjectType: "disk",
  description: "The disk stops appearing in collector output.",
  params: () => [
    {
      key: "hours",
      label: "Last seen",
      kind: "number",
      default: 48,
      min: 1,
      unit: "hours ago",
    },
  ],
  plan: (subject, params) => ({
    replays: [],
    afterReplay: (now) => {
      db.update(disk)
        .set({
          lastSeenAt: new Date(now.getTime() - Number(params.hours) * HOUR_MS),
        })
        .where(eq(disk.id, subject.disk.id))
        .run();
    },
  }),
});

export const PRESENCE_SCENARIOS = [missing];
