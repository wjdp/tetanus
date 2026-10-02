import { backfillFaults } from "~~/server/services/faultsBackfill";

export default async () => {
  const { replayed, total, live } = await backfillFaults();
  console.log(
    `Faults backfill: ${replayed} replayed from history, ${total} faults, ${live} live`,
  );
};
