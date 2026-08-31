import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Bill, NPP, NppForeignPolicyMode } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { OrganizationLegislation } from "@/lib/db/types/internationalOrganization";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import { getConflict } from "@/lib/db/collections/conflicts";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getMembers, recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { buildJoinConflictBill } from "@/lib/internationalOrganizations/commands/buildJoinConflictBill";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import { isNppAutonomyActive } from "@/lib/nppAutonomy/featureFlag";
import { foreignPolicyModeFrom } from "@/lib/nppAutonomy/foreignPolicyRollout";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  classifyWarEntry,
  assessWarEntryPoliticalPressure,
  enactImmediateWarEntry,
  warEntryIsImmediate,
} from "@/lib/military/warEntryPolicy";

type ActiveJoinResolution = OrganizationLegislation & {
  type: "join_conflict";
  status: "active";
};

function billKey(resolutionId: string, countryId: string): string {
  return `${resolutionId}:${countryId}`;
}

/**
 * Repair the seam between an enacted bloc call and autonomous national politics.
 *
 * A join-conflict resolution used to ask only the voting roll that existed on its
 * enactment turn to legislate. If autonomous foreign policy was activated later,
 * every newly active government was permanently skipped because resolution effects
 * were one-shot. This sweep treats an active resolution as a standing request to its
 * current autonomous members. It creates the missing national bill, once, and leaves
 * ratification and military preparation to the ordinary country lifecycle.
 *
 * Player governments are deliberately absent. The original enactment path already
 * creates their bills, and `isNppAutonomyActive` is the player-control rail.
 */
export async function reconcileAutonomousWarEntryBills(db: Db): Promise<number> {
  const rollout = await db
    .collection<{ _id: string; nppForeignPolicyMode?: NppForeignPolicyMode }>("gameState")
    .findOne({ _id: "current" }, { projection: { nppForeignPolicyMode: 1 } });
  const autonomousPolicyActive = foreignPolicyModeFrom(rollout?.nppForeignPolicyMode) === "active";

  const resolutions = (await (
    await getOrganizationLegislationCollection(db)
  )
    .find({ type: "join_conflict", status: "active" })
    .toArray()) as ActiveJoinResolution[];
  if (resolutions.length === 0) return 0;

  const resolutionIds = resolutions.map((resolution) => resolution._id.toString());
  const existingBills = await db
    .collection<Bill>("bills")
    .find({
      provisions: {
        $elemMatch: { type: "join_conflict", resolutionId: { $in: resolutionIds } },
      },
    } as never)
    .project<Pick<Bill, "_id" | "countryId" | "status" | "provisions">>({
      countryId: 1,
      status: 1,
      provisions: 1,
    })
    .toArray();
  const existing = new Map<
    string,
    Pick<Bill, "_id" | "status"> & {
      provision: Extract<NonNullable<Bill["provisions"]>[number], { type: "join_conflict" }>;
    }
  >();
  for (const bill of existingBills) {
    if (!bill.countryId) continue;
    for (const provision of bill.provisions ?? []) {
      if (provision.type !== "join_conflict") continue;
      existing.set(billKey(provision.resolutionId, bill.countryId), { ...bill, provision });
    }
  }

  const [preset, currentTurn] = await Promise.all([loadWorldPreset(db), getCurrentTurn(db)]);
  let actions = 0;
  for (const resolution of resolutions) {
    const theaterId = resolution.joinConflictTheaterId;
    const side = resolution.joinConflictSide;
    if (!theaterId || !side) continue;

    const conflict = await getConflict(db, theaterId);
    if (!conflict || isConflictConcluded(conflict.status)) continue;
    const chosen = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
    const opposing = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
    const members = (await getMembers(db, resolution.organizationId)).filter(
      (member): member is CountryId => member in COUNTRY_CONFIGS
    );

    for (const countryId of members) {
      const key = billKey(resolution._id.toString(), countryId);
      const bill = existing.get(key);
      if (opposing.includes(countryId)) continue;

      const stake = classifyWarEntry({
        conflict,
        countryId,
        side,
        organizationId: resolution.organizationId,
      });
      if (chosen.includes(countryId)) {
        if (bill && bill.status !== "signed") {
          const now = new Date();
          await db
            .collection<Bill>("bills")
            .updateOne(
              { _id: bill._id, status: { $nin: ["signed", "failed", "withdrawn"] } },
              { $set: { status: "signed", enactedAt: now, updatedAt: now } }
            );
        }
        continue;
      }

      if (warEntryIsImmediate(stake)) {
        const result = await enactImmediateWarEntry({
          db,
          conflict,
          countryId,
          side,
          organizationId: resolution.organizationId,
          currentTurn,
          stake,
        });
        const now = new Date();
        if (bill && bill.status !== "signed") {
          await db
            .collection<Bill>("bills")
            .updateOne(
              { _id: bill._id, status: { $nin: ["signed", "failed", "withdrawn"] } },
              { $set: { status: "signed", enactedAt: now, updatedAt: now } }
            );
        }
        await recordOrgHistoryEvent(
          db,
          countryId,
          currentTurn,
          stake === "collective_defense"
            ? `${resolution.organizationId} collective defense invoked: entered ${conflict.name} immediately.`
            : `${COUNTRY_CONFIGS[countryId].name} entered ${conflict.name} as a principal belligerent.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        if (result.joined) actions++;
        continue;
      }

      if (bill && autonomousPolicyActive && !bill.provision.politicalPressure) {
        const politicalPressure = await assessWarEntryPoliticalPressure({
          db,
          countryId,
          organizationId: resolution.organizationId,
          stake,
          currentTurn,
        });
        await db.collection<Bill>("bills").updateOne(
          { _id: bill._id },
          {
            $set: {
              "provisions.$[entry].entryStake": stake,
              "provisions.$[entry].politicalPressure": politicalPressure,
              updatedAt: new Date(),
            },
          },
          {
            arrayFilters: [
              {
                "entry.type": "join_conflict",
                "entry.resolutionId": resolution._id.toString(),
              },
            ],
          }
        );
        bill.provision.entryStake = stake;
        bill.provision.politicalPressure = politicalPressure;
        actions++;
      }

      if (!autonomousPolicyActive || bill || !hasBillLifecycle(countryId)) continue;
      if (!(await isNppAutonomyActive(db, countryId))) continue;

      const formation = await db
        .collection<GovernmentFormation>("governmentFormations")
        .findOne({ _id: countryId, status: "formed" });
      const headId = formation?.presidentNppId ?? formation?.pmNppId ?? null;
      if (!headId) continue;
      const head = await db
        .collection<NPP>("npps")
        .findOne({ _id: headId }, { projection: { _id: 1, name: 1, party: 1 } });
      if (!head) continue;

      const billId = await buildJoinConflictBill({
        db,
        countryId,
        preset,
        sponsor: {
          characterId: head._id,
          characterName: head.name,
          party: head.party,
          isNpp: true,
        },
        conflictName: conflict.name,
        organizationId: resolution.organizationId,
        provision: {
          type: "join_conflict",
          theaterId,
          side,
          organizationId: resolution.organizationId,
          resolutionId: resolution._id.toString(),
          entryStake: stake,
          politicalPressure: await assessWarEntryPoliticalPressure({
            db,
            countryId,
            organizationId: resolution.organizationId,
            stake,
            currentTurn,
          }),
        },
      });
      existing.set(key, {
        _id: billId,
        status: "active_both",
        provision: {
          type: "join_conflict",
          theaterId,
          side,
          organizationId: resolution.organizationId,
          resolutionId: resolution._id.toString(),
          entryStake: stake,
        },
      });
      actions++;
    }
  }
  return actions;
}
