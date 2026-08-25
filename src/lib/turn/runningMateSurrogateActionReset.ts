// src/lib/turn/runningMateSurrogateActionReset.ts
import type { AnyBulkWriteOperation } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Campaign, Election, ElectionCandidate } from "@/lib/db/types";
import { getCalendarDayInTimezone, shouldApplyDailyReset } from "@/lib/time/dailyReset";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";

/**
 * Refill each active presidential ticket's shared running-mate surrogate action
 * pool to the ruleset cap once per Eastern-time calendar day.
 *
 * Mirrors `resetVicePresidentActions` exactly: a per-turn sweep gated by the
 * daily boundary, so a ticket gets `vpSurrogateActionCap` surrogate actions each
 * day rather than every turn. Scoped to presidential campaigns whose ticket has
 * a resolved running mate; the pool has no meaning otherwise. The cap is read
 * from `presidentialRulesetFor(election)` so a race frozen to an older ruleset
 * keeps its own cap (rules-freeze seam).
 */
export async function resetRunningMateSurrogateActions(
  db: Db
): Promise<{ surrogatePoolsReset: number }> {
  const todayEastern = getCalendarDayInTimezone(new Date());

  const presidentialElections = await db
    .collection<Election>("elections")
    .find({ electionType: "president", status: "active" })
    .project<Pick<Election, "_id" | "rulesetVersion">>({ _id: 1, rulesetVersion: 1 })
    .toArray();
  if (presidentialElections.length === 0) return { surrogatePoolsReset: 0 };

  const capByElection = new Map<string, number>();
  for (const election of presidentialElections) {
    capByElection.set(
      election._id.toString(),
      presidentialRulesetFor(election).vpSurrogateActionCap
    );
  }
  const electionIds = presidentialElections.map((election) => election._id);

  const ticketsWithMate = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: electionIds },
      status: "active",
      // Only tickets that actually named a running mate. `runningMateId` is an
      // ObjectId when set and simply absent otherwise (never stored as null).
      runningMateId: { $exists: true },
    })
    .project<Pick<ElectionCandidate, "electionId" | "characterId">>({
      electionId: 1,
      characterId: 1,
    })
    .toArray();
  if (ticketsWithMate.length === 0) return { surrogatePoolsReset: 0 };

  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({
      status: { $ne: "archived" },
      $or: ticketsWithMate.map((ticket) => ({
        electionId: ticket.electionId,
        candidateId: ticket.characterId,
      })),
    })
    .project<Pick<Campaign, "_id" | "electionId" | "runningMateSurrogateActionsResetDay">>({
      _id: 1,
      electionId: 1,
      runningMateSurrogateActionsResetDay: 1,
    })
    .toArray();

  const bulkOps: AnyBulkWriteOperation<Campaign>[] = [];
  for (const campaign of campaigns) {
    if (!shouldApplyDailyReset(campaign.runningMateSurrogateActionsResetDay)) continue;
    const cap =
      capByElection.get(campaign.electionId.toString()) ??
      presidentialRulesetFor(undefined).vpSurrogateActionCap;
    bulkOps.push({
      updateOne: {
        filter: { _id: campaign._id },
        update: {
          $set: {
            runningMateSurrogateActionsRemaining: cap,
            runningMateSurrogateActionsResetDay: todayEastern,
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection<Campaign>("campaigns").bulkWrite(bulkOps);
  }

  return { surrogatePoolsReset: bulkOps.length };
}
