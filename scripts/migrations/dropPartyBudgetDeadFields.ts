/**
 * Drop vestigial fields from the `partyBudget` collection.
 *
 * - `treasury` was left over from an earlier model; actual money lives on
 *   politicalParties.treasury (national) and statePartyOrg.treasury (state).
 * - `chairCharacterId` was written by several routes but never read for any
 *   decision; the canonical chair pointer is politicalParties.chairId /
 *   statePartyOrg.chairId.
 *
 * Both fields have been removed from the TypeScript type. This script strips
 * them from existing documents so the on-disk shape matches.
 *
 * Safe to run any number of times — it only $unsets. Run once against each
 * environment (dev, staging, live) after deploying the type removal.
 */
import { connectDb, closeDb } from "../utils/db";

async function main() {
  const db = await connectDb();
  const result = await db
    .collection("partyBudget")
    .updateMany(
      { $or: [{ treasury: { $exists: true } }, { chairCharacterId: { $exists: true } }] },
      { $unset: { treasury: "", chairCharacterId: "" } }
    );
  console.log(
    `Unset treasury / chairCharacterId on ${result.modifiedCount} partyBudget documents.`
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
