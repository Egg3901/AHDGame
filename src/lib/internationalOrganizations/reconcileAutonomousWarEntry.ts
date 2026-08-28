import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Bill, NPP, NppForeignPolicyMode } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { OrganizationLegislation } from "@/lib/db/types/internationalOrganization";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import { getConflict } from "@/lib/db/collections/conflicts";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getMembers } from "@/lib/internationalOrganizations/service";
import { buildJoinConflictBill } from "@/lib/internationalOrganizations/commands/buildJoinConflictBill";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import { isNppAutonomyActive } from "@/lib/nppAutonomy/featureFlag";
import { foreignPolicyModeFrom } from "@/lib/nppAutonomy/foreignPolicyRollout";

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
  if (foreignPolicyModeFrom(rollout?.nppForeignPolicyMode) !== "active") return 0;

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
    .project<Pick<Bill, "countryId" | "provisions">>({ countryId: 1, provisions: 1 })
    .toArray();
  const existing = new Set<string>();
  for (const bill of existingBills) {
    if (!bill.countryId) continue;
    for (const provision of bill.provisions ?? []) {
      if (provision.type !== "join_conflict") continue;
      existing.add(billKey(provision.resolutionId, bill.countryId));
    }
  }

  const preset = await loadWorldPreset(db);
  let created = 0;
  for (const resolution of resolutions) {
    const theaterId = resolution.joinConflictTheaterId;
    const side = resolution.joinConflictSide;
    if (!theaterId || !side) continue;

    const conflict = await getConflict(db, theaterId);
    if (!conflict || isConflictConcluded(conflict.status)) continue;
    const chosen = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
    const opposing = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
    const members = (await getMembers(db, resolution.organizationId)).filter(
      (member): member is CountryId =>
        member in COUNTRY_CONFIGS && hasBillLifecycle(member as CountryId)
    );

    for (const countryId of members) {
      const key = billKey(resolution._id.toString(), countryId);
      if (existing.has(key) || chosen.includes(countryId) || opposing.includes(countryId)) continue;
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

      await buildJoinConflictBill({
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
        },
      });
      existing.add(key);
      created++;
    }
  }
  return created;
}
