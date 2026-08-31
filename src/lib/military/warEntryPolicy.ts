import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { BLOC_DESIGNATED_ORG_IDS } from "@/lib/constants/orgCategory";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { mobilizeImmediateWarEntry } from "@/lib/nppAutonomy/autonomousWarCommands";
import { joinSide } from "@/lib/military/joinSide";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { PersistedSphereMembership } from "@/lib/world/spheres/membershipStore";
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";

export type WarEntryStake =
  "principal_belligerent" | "collective_defense" | "offensive_coalition" | "discretionary";

export interface WarEntryPoliticalPressure {
  blocRelations: number;
  securityStakes: number;
  readiness: number;
  domesticPolitics: number;
  total: number;
}

type WarEntryConflict = Pick<
  ConflictDoc,
  "_id" | "name" | "hostCountry" | "hostEntities" | "sideA" | "sideB" | "control"
> &
  Partial<Pick<ConflictDoc, "treatyEntries" | "joinTurns">>;

/** Which roster holds the territory where the war is being fought. */
export function hostSideOf(conflict: Pick<WarEntryConflict, "hostCountry" | "sideA" | "sideB">) {
  const hostCountry = conflict.hostCountry as CountryId;
  if (conflict.sideA?.countries?.includes(hostCountry)) return "A" as const;
  if (conflict.sideB?.countries?.includes(hostCountry)) return "B" as const;
  return null;
}

/**
 * Classify the political stakes of one country's proposed entry into a live war.
 *
 * The host side is defensive. A country named among the war's host entities is a
 * principal even when it belongs on the opposing roster, as with West Germany in
 * a war over both Germanies. Armed-bloc entry on the host side is collective
 * defense; armed-bloc entry against it is an offensive coalition choice.
 */
export function classifyWarEntry(params: {
  conflict: WarEntryConflict;
  countryId: CountryId;
  side: "A" | "B";
  organizationId: string;
}): WarEntryStake {
  const { conflict, countryId, side, organizationId } = params;
  if ((conflict.hostEntities ?? [conflict.hostCountry]).includes(countryId)) {
    return "principal_belligerent";
  }
  const hostSide = hostSideOf(conflict);
  if (!hostSide || !(BLOC_DESIGNATED_ORG_IDS as readonly string[]).includes(organizationId)) {
    return "discretionary";
  }
  return side === hostSide ? "collective_defense" : "offensive_coalition";
}

export function warEntryIsImmediate(
  stake: WarEntryStake
): stake is Extract<WarEntryStake, "principal_belligerent" | "collective_defense"> {
  return stake === "principal_belligerent" || stake === "collective_defense";
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * Snapshot the national pressures behind a discretionary war-entry vote.
 * Alignment and sphere ties express bloc relations; readiness and approval keep
 * the treaty from erasing domestic politics. The result is bounded so it can
 * make a close chamber move without manufacturing unanimity.
 */
export async function assessWarEntryPoliticalPressure(params: {
  db: Db;
  countryId: CountryId;
  organizationId: string;
  stake: WarEntryStake;
  currentTurn: number;
}): Promise<WarEntryPoliticalPressure> {
  const { db, countryId, organizationId, stake, currentTurn } = params;
  const [alignment, sphere, approval, budget, units] = await Promise.all([
    db.collection<CountryAlignment>("countryAlignments").findOne({ entityId: countryId }),
    db.collection<PersistedSphereMembership>("sphereMemberships").findOne({ entityId: countryId }),
    db.collection<GovernmentApproval>("governmentApprovals").findOne({ _id: countryId }),
    db
      .collection<{ countryId: CountryId; debtToGdpRatio?: number }>("federalBudget")
      .findOne({ countryId }),
    db.collection<MilitaryUnit>("militaryUnits").find({ countryId }).toArray(),
  ]);

  const alignedPole =
    organizationId === "WARSAW_PACT" ? ["EAST", "MOSCOW"] : ["WEST", "WASHINGTON"];
  const opposingPole =
    organizationId === "WARSAW_PACT" ? ["WEST", "WASHINGTON"] : ["EAST", "MOSCOW"];
  const alignedShare = Math.max(
    0,
    ...alignedPole.map((pole) => alignment?.shares[pole as AlignmentPoleId] ?? 0)
  );
  const opposingShare = Math.max(
    0,
    ...opposingPole.map((pole) => alignment?.shares[pole as AlignmentPoleId] ?? 0)
  );
  const blocAlignment = (alignedShare - opposingShare) * 0.35;
  const blocLeader = organizationId === "WARSAW_PACT" ? "RU" : "US";
  const sponsorTie = sphere?.relationships.find((row) => row.sponsorId === blocLeader);
  const sphereTie =
    sphere?.primarySphereId === blocLeader
      ? 12
      : sponsorTie
        ? 4 + sponsorTie.alignment * 6 + sponsorTie.integration * 4
        : 0;
  const blocRelations = blocAlignment + sphereTie;

  const securityStakes =
    stake === "offensive_coalition" ? -15 : stake === "discretionary" ? -10 : 35;
  const ready = units.filter(
    (unit) =>
      unit.theaterId === "reserve" &&
      unit.personnel > 0 &&
      unit.readiness >= 50 &&
      (unit.readyAtTurn == null || unit.readyAtTurn <= currentTurn)
  );
  const averageReadiness =
    ready.length > 0 ? ready.reduce((sum, unit) => sum + unit.readiness, 0) / ready.length : 15;
  const readiness = (averageReadiness - 55) * 0.25;
  const approvalForce = ((approval?.approvalRating ?? 45) - 50) * 0.3;
  const debtBrake = Math.max(0, (budget?.debtToGdpRatio ?? 0) - 80) * 0.15;
  const domesticPolitics = approvalForce - debtBrake;
  const total = clamp(blocRelations + securityStakes + readiness + domesticPolitics, -40, 40);

  return {
    blocRelations: oneDecimal(blocRelations),
    securityStakes: oneDecimal(securityStakes),
    readiness: oneDecimal(readiness),
    domesticPolitics: oneDecimal(domesticPolitics),
    total: oneDecimal(total),
  };
}

/**
 * Enact a non-discretionary entry and mobilize whatever ready force exists.
 * Belligerency does not depend on available formations: a treaty remains binding
 * when a member's field army is temporarily unready.
 */
export async function enactImmediateWarEntry(params: {
  db: Db;
  conflict: ConflictDoc;
  countryId: CountryId;
  side: "A" | "B";
  organizationId: string;
  currentTurn: number;
  stake: Extract<WarEntryStake, "principal_belligerent" | "collective_defense">;
}): Promise<{ joined: boolean; deployedUnits: number }> {
  const { db, conflict, countryId, side, organizationId, currentTurn, stake } = params;
  const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
  const joined = !roster.includes(countryId);
  await joinSide(db, conflict, countryId, side, currentTurn);
  const deployedUnits = await mobilizeImmediateWarEntry(
    db,
    countryId,
    conflict._id,
    currentTurn,
    organizationId
  );

  if (stake === "collective_defense") {
    const alreadyRecorded = conflict.treatyEntries?.some((entry) => entry.countryId === countryId);
    if (!alreadyRecorded) {
      const entry = {
        countryId,
        organizationId,
        defending: conflict.hostCountry as CountryId,
        joinedTurn: currentTurn,
      };
      conflict.treatyEntries = [...(conflict.treatyEntries ?? []), entry];
      await getConflictsCollection(db).updateOne(
        { _id: conflict._id, "treatyEntries.countryId": { $ne: countryId } },
        { $push: { treatyEntries: entry } }
      );
    }
  }

  return { joined, deployedUnits };
}
