/**
 * Russian direct candidates register a president and vice-president ticket.
 * prepareRussianPresidentialTickets preserves a chosen player running mate and
 * fills an unpaired ticket from a distinct same-party NPC before counting begins.
 */
import { type Db, type ClientSession } from "mongodb";
import type { Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { chooseRussianNpcRunningMate } from "./rules/presidentialTicket";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
export async function materializeRussianPresidentialTickets(input: {
  db: Db;
  session: ClientSession;
  election: Election;
  now: Date;
}) {
  const { db, session, election } = input;
  if (!session.inTransaction()) throw new Error("Russian tickets require an active transaction");
  if (
    election.countryId !== "RU" ||
    election.electionType !== "president" ||
    !election.russianPresidentialRound
  )
    return;
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: election._id, status: "active" },
      {
        session,
        projection: {
          party: 1,
          isNPP: 1,
          nppId: 1,
          characterId: 1,
          runningMateId: 1,
          russianRunningMateNppId: 1,
        },
      }
    )
    .toArray();
  const missing = candidates.filter((c) => !c.runningMateId && !c.russianRunningMateNppId);
  if (!missing.length) return;
  const pool = await db
    .collection<NPP>("npps")
    .find(
      {
        countryId: "RU",
        party: { $in: [...new Set(missing.map((c) => c.party))] },
        isTechnocrat: { $ne: true },
      },
      { session, projection: { party: 1, currentOffice: 1 } }
    )
    .toArray();
  const reserved = new Set(
    candidates.flatMap((c) =>
      [c.nppId, c.russianRunningMateNppId].filter(Boolean).map((id) => id!.toHexString())
    )
  );
  const writes = [];
  for (const candidate of missing) {
    const selected = chooseRussianNpcRunningMate(
      candidate.party,
      pool.map((n) => ({
        id: n._id.toHexString(),
        party: n.party,
        officeType: n.currentOffice?.type,
      })),
      reserved
    );
    const mate = pool.find((n) => n._id.toHexString() === selected);
    if (!mate) throw new Error("Russian presidential ticket needs an eligible running mate");
    reserved.add(mate._id.toHexString());
    writes.push({
      updateOne: {
        filter: {
          _id: candidate._id,
          status: "active" as const,
          runningMateId:
            candidate.runningMateId === undefined ? { $exists: false } : candidate.runningMateId,
          russianRunningMateNppId:
            candidate.russianRunningMateNppId === undefined
              ? { $exists: false }
              : candidate.russianRunningMateNppId,
        },
        update: { $set: { russianRunningMateNppId: mate._id } },
      },
    });
  }
  const saved = await db
    .collection<ElectionCandidate>("electionCandidates")
    .bulkWrite(writes, { session });
  if (saved.matchedCount !== writes.length)
    throw new Error("Russian presidential ticket changed during registration");
}
export async function prepareRussianPresidentialTickets(
  input: Omit<Parameters<typeof materializeRussianPresidentialTickets>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianPresidentialTickets({ ...input, session }),
    { client: input.db.client }
  );
}
