import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";
import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { PEACE_OFFER_DURATION_TURNS, type PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { getConflict } from "@/lib/db/collections/conflicts";
import { recomputeNationalApproval } from "@/lib/country/recomputeNationalApproval";
import { findLiveOffer, getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { validatePeaceOffer } from "@/lib/military/peaceOffer";
import { isNppAutonomyActive } from "./featureFlag";
import type { ForeignPolicyChoice } from "./foreignPolicy";
import {
  foreignPolicyActionAllowed,
  foreignPolicyModeFrom,
  foreignPolicyStageFrom,
} from "./foreignPolicyRollout";

export interface AutonomousWarCommandResult {
  acted: boolean;
  note: string;
}

export interface AutonomousWarEntryPreparation {
  ready: boolean;
  deployedUnits: number;
  reason: string;
}

const ENTRY_MIN_READINESS = 55;
const ENTRY_MIN_APPROVAL = 45;
const ENTRY_MAX_DEBT_TO_GDP = 120;
export const DEFAULT_WAR_COMMITMENT_SHARE = 0.2;

/**
 * The Warsaw Pact's unified command can put a larger share of each member army
 * into one bloc operation than the default autonomous coalition commitment.
 * This changes mobilization depth, not combat quality, readiness, or casualties.
 */
export const WAR_COMMITMENT_SHARE_BY_ORGANIZATION: Readonly<Record<string, number>> = {
  WARSAW_PACT: 0.35,
};
export type WarCommitmentPriority = "lowest" | "highest";
export const WAR_COMMITMENT_PRIORITY_BY_ORGANIZATION: Readonly<
  Record<string, WarCommitmentPriority>
> = {
  WARSAW_PACT: "highest",
};

function readyReserveUnits(
  units: MilitaryUnit[],
  currentTurn: number,
  minimumReadiness = ENTRY_MIN_READINESS
): MilitaryUnit[] {
  return units.filter(
    (unit) =>
      unit.theaterId === "reserve" &&
      unit.personnel > 0 &&
      unit.readiness >= minimumReadiness &&
      (unit.readyAtTurn == null || unit.readyAtTurn <= currentTurn)
  );
}

export function planAutonomousDeployment(
  units: MilitaryUnit[],
  commitmentShare = DEFAULT_WAR_COMMITMENT_SHARE,
  priority: WarCommitmentPriority = "lowest"
): MilitaryUnit[] {
  if (units.length === 0) return [];
  const totalPower = units.reduce((sum, unit) => sum + Math.max(0, unit.basePower), 0);
  const targetPower = Math.max(1, totalPower * commitmentShare);
  const selected: MilitaryUnit[] = [];
  let selectedPower = 0;
  for (const unit of [...units].sort((a, b) => {
    const powerOrder =
      priority === "highest" ? b.basePower - a.basePower : a.basePower - b.basePower;
    return powerOrder || a._id.toString().localeCompare(b._id.toString());
  })) {
    if (selected.length > 0 && selectedPower >= targetPower) break;
    selected.push(unit);
    selectedPower += Math.max(0, unit.basePower);
  }
  return selected;
}

async function deployReserveCommitment(
  db: Db,
  countryId: CountryId,
  conflictId: string,
  currentTurn: number,
  commitmentShare = DEFAULT_WAR_COMMITMENT_SHARE,
  priority: WarCommitmentPriority = "lowest"
): Promise<number> {
  const units = await db.collection<MilitaryUnit>("militaryUnits").find({ countryId }).toArray();
  const selected = planAutonomousDeployment(
    readyReserveUnits(units, currentTurn),
    commitmentShare,
    priority
  );
  if (selected.length === 0) return 0;
  const result = await db.collection<MilitaryUnit>("militaryUnits").updateMany(
    {
      _id: { $in: selected.map((unit) => unit._id) },
      countryId,
      theaterId: "reserve",
    },
    { $set: { theaterId: conflictId, posture: "standard" } }
  );
  return result.modifiedCount;
}

/**
 * Mobilize a treaty-bound or principal belligerent without applying the public
 * approval and debt gates used for discretionary autonomous intervention.
 */
export async function mobilizeImmediateWarEntry(
  db: Db,
  countryId: CountryId,
  conflictId: string,
  currentTurn: number,
  organizationId?: string
): Promise<number> {
  return deployReserveCommitment(
    db,
    countryId,
    conflictId,
    currentTurn,
    organizationId
      ? (WAR_COMMITMENT_SHARE_BY_ORGANIZATION[organizationId] ?? DEFAULT_WAR_COMMITMENT_SHARE)
      : DEFAULT_WAR_COMMITMENT_SHARE,
    organizationId
      ? (WAR_COMMITMENT_PRIORITY_BY_ORGANIZATION[organizationId] ?? "lowest")
      : "lowest"
  );
}

async function activeForAutonomousWar(db: Db, countryId: CountryId): Promise<boolean> {
  const rollout = await db
    .collection<{
      _id: string;
      nppForeignPolicyMode?: "off" | "shadow" | "active";
      nppForeignPolicyStage?: "votes" | "proposals" | "trade" | "support" | "war";
    }>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { nppForeignPolicyMode: 1, nppForeignPolicyStage: 1 } }
    );
  return (
    foreignPolicyModeFrom(rollout?.nppForeignPolicyMode) === "active" &&
    foreignPolicyActionAllowed(
      "join_war",
      foreignPolicyStageFrom(rollout?.nppForeignPolicyStage)
    ) &&
    (await isNppAutonomyActive(db, countryId))
  );
}

export async function prepareAutonomousWarEntry(
  db: Db,
  countryId: CountryId,
  conflict: ConflictDoc,
  currentTurn: number,
  organizationId?: string
): Promise<AutonomousWarEntryPreparation> {
  if (!(await activeForAutonomousWar(db, countryId))) {
    return { ready: false, deployedUnits: 0, reason: "Autonomous war entry is not active." };
  }
  const [approval, budget] = await Promise.all([
    db.collection<GovernmentApproval>("governmentApprovals").findOne({ _id: countryId }),
    db
      .collection<{ countryId: CountryId; debtToGdpRatio?: number }>("federalBudget")
      .findOne({ countryId }),
  ]);
  // A missing document means "not measured yet", NOT "nobody approves". Only
  // `active` countries and current belligerents are snapshotted into
  // governmentApprovals, so every other country reads as absent here — and
  // reading absent as 0 refused entry to exactly the countries this bill route
  // exists for, whatever their public actually thought. The stored rating still
  // wins where there is one: it carries the national providers (war block,
  // address bump, org statements, cabinet) the recompute deliberately omits.
  //
  // Measuring reads states, metrics, era context and political bases, which is far
  // more failure surface than the single findOne it replaced. Every turn caller
  // wraps applyLegislationEffect in a bare `.catch`, so letting a read error escape
  // would abandon the rest of THIS bill's provisions as well. Refuse instead:
  // safer than admitting on error, and narrower than aborting the bill.
  let approvalRating = approval?.approvalRating;
  if (approvalRating == null) {
    try {
      approvalRating = await recomputeNationalApproval(db, countryId);
    } catch (err) {
      console.error(`[warEntry] could not measure ${countryId} approval:`, err);
      return { ready: false, deployedUnits: 0, reason: "Public approval could not be measured." };
    }
  }
  // Checked for finiteness rather than compared alone: `NaN < ENTRY_MIN_APPROVAL`
  // is FALSE, so a malformed metric poisoning the population-weighted average
  // would wave the country into the war instead of holding it out.
  if (!Number.isFinite(approvalRating)) {
    console.error(`[warEntry] ${countryId} approval measured as ${approvalRating}`);
    return { ready: false, deployedUnits: 0, reason: "Public approval could not be measured." };
  }
  if (approvalRating < ENTRY_MIN_APPROVAL) {
    return { ready: false, deployedUnits: 0, reason: "Public approval no longer supports entry." };
  }
  if ((budget?.debtToGdpRatio ?? 0) > ENTRY_MAX_DEBT_TO_GDP) {
    return { ready: false, deployedUnits: 0, reason: "Debt leaves no fiscal room for entry." };
  }

  const deployedUnits = await deployReserveCommitment(
    db,
    countryId,
    conflict._id,
    currentTurn,
    organizationId
      ? (WAR_COMMITMENT_SHARE_BY_ORGANIZATION[organizationId] ?? DEFAULT_WAR_COMMITMENT_SHARE)
      : DEFAULT_WAR_COMMITMENT_SHARE,
    organizationId
      ? (WAR_COMMITMENT_PRIORITY_BY_ORGANIZATION[organizationId] ?? "lowest")
      : "lowest"
  );
  return deployedUnits > 0
    ? { ready: true, deployedUnits, reason: "A ready reserve commitment deployed." }
    : { ready: false, deployedUnits: 0, reason: "No ready reserve force can deploy." };
}

function sideForCountry(conflict: ConflictDoc, countryId: CountryId): ConflictSide | null {
  if (conflict.sideA.countries.includes(countryId)) return conflict.sideA;
  if (conflict.sideB.countries.includes(countryId)) return conflict.sideB;
  return null;
}

function opposingSide(conflict: ConflictDoc, own: ConflictSide): ConflictSide {
  return own === conflict.sideA ? conflict.sideB : conflict.sideA;
}

async function conductWar(
  db: Db,
  countryId: CountryId,
  head: NPP,
  conflict: ConflictDoc,
  currentTurn: number
): Promise<AutonomousWarCommandResult> {
  const ownSide = sideForCountry(conflict, countryId);
  if (!ownSide) return { acted: false, note: "The country is not a belligerent." };
  const enemySide = opposingSide(conflict, ownSide);
  const target = enemySide.factionEntity ?? enemySide.countries[0];
  if (!target) return { acted: false, note: "The opposing side has no targetable belligerent." };

  const pending = await db.collection<BattleDeclarationDoc>("battleDeclarations").findOne({
    declarerCountry: countryId,
    theaterId: conflict._id,
    status: "pending",
  });
  if (pending) return { acted: false, note: "An offensive is already pending in this war." };

  let deployed = await db.collection<MilitaryUnit>("militaryUnits").countDocuments({
    countryId,
    theaterId: conflict._id,
    personnel: { $gt: 0 },
  });
  if (deployed === 0) {
    deployed = await deployReserveCommitment(db, countryId, conflict._id, currentTurn);
  }
  if (deployed === 0) return { acted: false, note: "No ready force is committed to this war." };

  const declaration: Omit<BattleDeclarationDoc, "_id"> = {
    declarerCountry: countryId,
    targetCountry: target,
    theaterId: conflict._id,
    declaredByCharacterId: head._id.toString(),
    declaredTurn: currentTurn,
    status: "pending",
  };
  const result = await db
    .collection<Omit<BattleDeclarationDoc, "_id">>("battleDeclarations")
    .insertOne(declaration);
  return { acted: true, note: `Queued offensive ${result.insertedId.toString()}.` };
}

async function seekPeace(
  db: Db,
  countryId: CountryId,
  head: NPP,
  choice: ForeignPolicyChoice,
  conflict: ConflictDoc,
  currentTurn: number
): Promise<AutonomousWarCommandResult> {
  const target = choice.targetCountryId;
  if (!target) return { acted: false, note: "The peace choice has no opposing country." };
  const term = { kind: "white_peace" as const };
  const check = validatePeaceOffer(conflict, countryId, target, term, countryId);
  if (!check.ok) return { acted: false, note: check.error };
  if (await findLiveOffer(db, conflict._id, countryId, target, currentTurn)) {
    return { acted: false, note: "A peace offer is already pending with that country." };
  }
  const offer: Omit<PeaceOfferDoc, "_id"> = {
    conflictId: conflict._id,
    fromCountry: countryId,
    toCountry: target,
    leaver: countryId,
    term,
    justification: "The government seeks a negotiated end to unsustainable war pressure.",
    status: "pending",
    offeredTurn: currentTurn,
    expiresTurn: currentTurn + PEACE_OFFER_DURATION_TURNS,
    offeredBy: head._id.toString(),
  };
  const result = await getPeaceOffersCollection(db).insertOne(offer as PeaceOfferDoc);
  return { acted: true, note: `Opened peace offer ${result.insertedId.toString()}.` };
}

export async function executeAutonomousWarChoice(
  db: Db,
  countryId: CountryId,
  head: NPP,
  choice: ForeignPolicyChoice,
  currentTurn: number
): Promise<AutonomousWarCommandResult> {
  if (!choice.conflictId) return { acted: false, note: "The war choice has no conflict." };
  const conflict = await getConflict(db, choice.conflictId);
  if (!conflict || conflict.status === "resolved" || conflict.status === "terms_pending") {
    return { acted: false, note: "The selected war is no longer active." };
  }
  return choice.type === "conduct_war"
    ? conductWar(db, countryId, head, conflict, currentTurn)
    : seekPeace(db, countryId, head, choice, conflict, currentTurn);
}
