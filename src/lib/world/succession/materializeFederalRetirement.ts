import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryGameState, ElectedOfficial, Election } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

/** Retire only the active federal institutions after a complete dissolution.
 * Completed election records remain historical; player characters and their
 * protected wallets are handled by the residence materializer. */
export async function materializeFederationFederalRetirement(input: {
  db: Db;
  session: ClientSession;
  sourceCountryId: CountryId;
  appliedOnTurn: number;
  now: Date;
}): Promise<{ cancelledElections: number; vacatedOffices: number }> {
  const { db, session, sourceCountryId, appliedOnTurn, now } = input;
  if (!Number.isSafeInteger(appliedOnTurn) || appliedOnTurn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Federation retirement needs a valid turn and time");
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: sourceCountryId, dissolvedTurn: null }, { session });
  if (!country) throw new Error("Federation source country changed before dissolution");
  const elections = await db
    .collection<Election>("elections")
    .updateMany(
      { countryId: sourceCountryId, status: { $in: ["upcoming", "active"] } },
      { $set: { status: "cancelled", updatedAt: now } },
      { session }
    );
  const offices = await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ countryId: sourceCountryId }, { session });
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: sourceCountryId },
    {
      $set: {
        status: "collapsed",
        collapsedAt: now,
        pmCharacterId: null,
        pmNppId: null,
        pmName: null,
        updatedAt: now,
      },
    },
    { session }
  );
  const updated = await db.collection<CountryGameState>("countryGameStates").updateOne(
    { _id: sourceCountryId, dissolvedTurn: null },
    {
      $set: {
        dissolvedTurn: appliedOnTurn,
        updatedAt: now,
        ...(sourceCountryId === "YU" ? { yuSettlementAppliedSinceTurn: appliedOnTurn } : {}),
      },
    },
    { session }
  );
  if (updated.matchedCount !== 1)
    throw new Error("Federation source country changed during dissolution");
  return { cancelledElections: elections.modifiedCount, vacatedOffices: offices.deletedCount };
}
