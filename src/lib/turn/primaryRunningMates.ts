/**
 * Tentative running mates for presidential nominees, assigned when primaries
 * resolve (autoAssignTentativeRunningMates). Split from primaryResolution.ts.
 */
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { getDb } from "@/lib/mongodb";
import type { ElectionCandidate, Character } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { hasReachedExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";

/**
 * For each player presidential nominee without a runningMateId, tentatively
 * assign the highest-favorability same-party character in the same country
 * who is not themselves a candidate or the incumbent president. Sends a
 * notification so the nominee knows and can override via the running-mate UI.
 */
export async function autoAssignTentativeRunningMates(
  db: Awaited<ReturnType<typeof getDb>>,
  nominees: ElectionCandidate[],
  countryId: CountryId
): Promise<void> {
  const needsVp = nominees.filter((c) => !c.isNPP && !c.runningMateId && c.characterId != null);
  if (needsVp.length === 0) return;

  // Incumbent president is disqualified from being a running mate
  const incumbent = await db
    .collection("electedOfficials")
    .findOne(getExecutiveOfficialFilter(countryId, "president"), {
      projection: { characterId: 1 },
    });
  const incumbentId: ObjectId | null = (incumbent?.characterId as ObjectId | null) ?? null;
  const countryConfig = getCountryConfig(countryId);

  const candidateIdSet = new Set(nominees.map((c) => c.characterId?.toString()).filter(Boolean));

  // Group nominees by party so we run one query per party instead of one per nominee
  const nomineesByParty = new Map<string, typeof needsVp>();
  for (const n of needsVp) {
    const list = nomineesByParty.get(n.party) ?? [];
    list.push(n);
    nomineesByParty.set(n.party, list);
  }

  const partyQueries = [...nomineesByParty.keys()].map((party) =>
    db
      .collection<Character>("characters")
      .find({
        countryId,
        party,
        _id: { $nin: needsVp.map((n) => n.characterId) },
      })
      .sort({ favorability: -1 })
      .limit(10)
      .toArray()
  );
  const partyCandidatesArrays = await Promise.all(partyQueries);
  const candidatesByParty = new Map<string, Character[]>();
  let idx = 0;
  for (const party of nomineesByParty.keys()) {
    candidatesByParty.set(party, partyCandidatesArrays[idx++]);
  }

  // Batch-fetch nominee characters for notifications in one query
  const nomineeChars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: needsVp.map((n) => n.characterId) } },
      { projection: { _id: 1, userId: 1 } }
    )
    .toArray();
  const nomineeCharMap = new Map(nomineeChars.map((c) => [c._id.toString(), c]));
  const runningMateWrites: AnyBulkWriteOperation<ElectionCandidate>[] = [];
  const notificationAssignments: Array<{
    nomineeId: ObjectId;
    runningMateId: ObjectId;
    notification: NotificationInput;
  }> = [];
  const assignedAt = new Date();

  for (const nominee of needsVp) {
    const candidates = candidatesByParty.get(nominee.party) ?? [];

    const pick = candidates.find(
      (c) =>
        !candidateIdSet.has(c._id.toString()) &&
        (!incumbentId || !c._id.equals(incumbentId)) &&
        !(
          countryConfig.executiveTermLimit?.blocksRunningMateSelection &&
          hasReachedExecutiveTermLimit(c, countryId)
        )
    );

    if (!pick) continue;
    runningMateWrites.push({
      updateOne: {
        // Do not overwrite a player selection made after `needsVp` was read.
        filter: {
          _id: nominee._id,
          $or: [{ runningMateId: { $exists: false } }, { runningMateId: { $type: 10 } }],
        },
        update: { $set: { runningMateId: pick._id, updatedAt: assignedAt } },
      },
    });

    const nomineeChar = nomineeCharMap.get(nominee.characterId.toString());
    if (nomineeChar?.userId) {
      notificationAssignments.push({
        nomineeId: nominee._id,
        runningMateId: pick._id,
        notification: {
          userId: nomineeChar.userId,
          type: "general_win",
          title: "Running mate tentatively assigned",
          message: `Since you didn't pick a running mate before the primary ended, ${pick.name} has been assigned as your tentative VP. You can change them from the election page.`,
          metadata: {
            electionId: nominee.electionId.toString(),
            tentativeVpId: pick._id.toString(),
          },
        },
      });
    }
  }
  if (runningMateWrites.length > 0) {
    const result = await db
      .collection<ElectionCandidate>("electionCandidates")
      .bulkWrite(runningMateWrites, { ordered: false });
    let confirmedNotifications = notificationAssignments;
    if (result.matchedCount !== runningMateWrites.length && notificationAssignments.length > 0) {
      const confirmed = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find(
          {
            _id: { $in: notificationAssignments.map(({ nomineeId }) => nomineeId) },
            updatedAt: assignedAt,
          },
          { projection: { _id: 1, runningMateId: 1 } }
        )
        .toArray();
      const confirmedRunningMateByNominee = new Map(
        confirmed.map((candidate) => [
          candidate._id.toString(),
          candidate.runningMateId?.toString(),
        ])
      );
      confirmedNotifications = notificationAssignments.filter(
        ({ nomineeId, runningMateId }) =>
          confirmedRunningMateByNominee.get(nomineeId.toString()) === runningMateId.toString()
      );
    }
    if (confirmedNotifications.length > 0) {
      await createNotifications(confirmedNotifications.map(({ notification }) => notification));
    }
  }
}
