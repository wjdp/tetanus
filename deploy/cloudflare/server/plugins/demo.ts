import { db } from "~~/server/database/client";
import { host } from "~~/server/database/schema";
import { seed, tick } from "~~/server/demo/seed";
import { ensureSettings } from "~~/server/services/settings";
import { applySmartPolicyIfStale } from "~~/server/services/smartPolicy";
import { publishOperations } from "../../bridge";

function hasHosts() {
  return db.select({ id: host.id }).from(host).limit(1).get() !== undefined;
}

export default defineNitroPlugin(() => {
  publishOperations({
    async bootstrap(now) {
      ensureSettings();
      applySmartPolicyIfStale(now);
      if (!hasHosts()) await seed(now);
    },
    async tick(now) {
      await tick(now);
    },
  });
});
