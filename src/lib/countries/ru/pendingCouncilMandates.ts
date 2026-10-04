/**
 * Certified Council winners hold a reserved mandate before joint chamber seating.
 * loadPendingRussianCouncilOwners reads one bound receipt so Duma filing and
 * certification cannot grant a second chamber mandate to the same owner.
 */
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { RussianCouncilResultRecord } from "./councilElectionResult";
export async function loadPendingRussianCouncilOwners(input: {
  db: Db;
  cohortId?: ObjectId;
  mandateSinceTurn?: number;
  session?: ClientSession;
}) {
  const owners = new Set<string>();
  if (!input.cohortId) return owners;
  const receipt = await input.db
    .collection<RussianCouncilResultRecord>("russianCouncilElectionResults")
    .findOne(
      {
        $or: [{ cohortId: input.cohortId }, { rootCohortId: input.cohortId }],
        countryId: "RU",
        preset: "1991-default",
        mandateSinceTurn: input.mandateSinceTurn,
        seatedOnTurn: { $exists: false },
      },
      { session: input.session, sort: { generation: -1 }, projection: { result: 1 } }
    );
  for (const district of receipt?.result ?? [])
    for (const winner of district.winners)
      owners.add(`${winner.isNpc ? "npc" : "player"}:${winner.ownerId}`);
  return owners;
}
