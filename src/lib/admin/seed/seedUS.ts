import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/**
 * US seed steps.
 *
 * ⚠️ MOST OF THE US IS NOT SEEDED HERE. The US is the default country: its
 * regions, parties and budgets come from the shared `seeds/reference/` tables
 * rather than a `seedUS*` function, which is why this file has only one export
 * and did not exist before. Put a step here only if it is genuinely US-specific.
 */
export async function seedUSGovernmentFormation(db: Db, log: (msg: string) => void) {
  const { usGovernmentFormation } = await import("@/lib/seeds/us/usGovernmentFormation");
  const now = new Date();
  const { _id, ...formationData } = usGovernmentFormation;
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id },
      { $set: { ...formationData, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log("Seeded US government formation document");
}
