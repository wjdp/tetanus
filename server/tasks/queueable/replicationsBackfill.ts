import { backfillReplications } from "~~/server/services/replications";

export default async () => {
  const { replications, sources } = backfillReplications();
  console.log(
    `Replications backfill: ${replications} replications, ${sources} sources found`,
  );
};
