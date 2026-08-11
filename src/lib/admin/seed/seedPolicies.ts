import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { Policy } from "@/lib/db/types";
import { policies } from "@/lib/seeds/reference/policies";

export async function seedPolicies(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset)
    await db
      .collection("policies")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeed",
          action: "drop collection",
          metadata: { error: String(error) },
        });
      });
  for (const policy of policies) {
    const { _id, ...policyData } = policy;
    await db
      .collection<Policy>("policies")
      .updateOne({ _id }, { $set: policyData }, { upsert: true });
  }
  log(`Seeded ${policies.length} policies`);
}
