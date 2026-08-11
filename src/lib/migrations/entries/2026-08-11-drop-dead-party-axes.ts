import type { Db } from "mongodb";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * Drop the retired `foreignPolicy` / `culture` party axes (ticket #1032).
 *
 * Both axes were written by every party seed, by charter ratification and by
 * the position-shift proposal, and read by nothing. No engine, no driver, no
 * appeal calculation ever consumed either value — the party type's own doc
 * comment admitted as much ("scaffolding only — no engine reads this yet").
 * The cost was not merely dead storage: the shift proposal offered all four
 * axes as identical choices, so a party could spend a committee vote and a
 * 336-turn cooldown moving a number that could not affect anything. UK Labour
 * did exactly that twice in one evening.
 *
 * Unsets the fields from the three places they were persisted:
 *   - `politicalParties.foreignPolicy` / `.culture`
 *   - `politicalParties.positionShiftCooldowns.foreignPolicy` / `.culture`
 *   - `partyCharters.platform.foreignPolicy` / `.platform.culture`
 *
 * Deliberately does NOT touch `committeeProposals`. Historical proposals on a
 * retired axis are a true record of something that happened, they still render
 * (the card keeps a "(retired)" label for them), and `applyPositionShiftEffect`
 * now no-ops on them rather than throwing. Rewriting history to make the schema
 * tidy would be the wrong trade.
 *
 * Idempotent: `$unset` on an absent field is a no-op, and the filters only
 * match documents that still carry one of the fields.
 */
async function run(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const notes: string[] = [];

  const partyFilter = {
    $or: [
      { foreignPolicy: { $exists: true } },
      { culture: { $exists: true } },
      { "positionShiftCooldowns.foreignPolicy": { $exists: true } },
      { "positionShiftCooldowns.culture": { $exists: true } },
    ],
  };
  const charterFilter = {
    $or: [
      { "platform.foreignPolicy": { $exists: true } },
      { "platform.culture": { $exists: true } },
    ],
  };

  const partiesToClean = await db.collection("politicalParties").countDocuments(partyFilter);
  const chartersToClean = await db.collection("partyCharters").countDocuments(charterFilter);
  const scanned = partiesToClean + chartersToClean;

  if (ctx.dryRun) {
    notes.push(
      `DRY RUN — would unset the retired axes on ${partiesToClean} parties and ${chartersToClean} charters`
    );
    return { documentsScanned: scanned, documentsUpdated: 0, notes };
  }

  const parties = await db.collection("politicalParties").updateMany(partyFilter, {
    $unset: {
      foreignPolicy: "",
      culture: "",
      "positionShiftCooldowns.foreignPolicy": "",
      "positionShiftCooldowns.culture": "",
    },
  });
  const charters = await db.collection("partyCharters").updateMany(charterFilter, {
    $unset: { "platform.foreignPolicy": "", "platform.culture": "" },
  });

  notes.push(`parties cleaned: ${parties.modifiedCount}`);
  notes.push(`charters cleaned: ${charters.modifiedCount}`);
  notes.push("committeeProposals left untouched — historical rows stay readable");

  return {
    documentsScanned: scanned,
    documentsUpdated: parties.modifiedCount + charters.modifiedCount,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-08-11-drop-dead-party-axes",
  description:
    "Unset the retired foreignPolicy / culture axes from parties and charters (ticket #1032).",
  idempotent: true,
  execute: run,
};
