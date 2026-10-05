import { pruneDatabase, reclaimSpace } from "~~/server/services/retention";

export default async () => {
  const counts = await pruneDatabase();
  const reclaimed = reclaimSpace();
  const deleted = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${count} ${table}`);
  console.log(
    `Retention prune: ${deleted.join(", ") || "nothing"} deleted; space ${reclaimed}`,
  );
};
