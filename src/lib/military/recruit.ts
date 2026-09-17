import { randomUUID } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getNationalManpowerCollection } from "@/lib/db/collections/nationalManpower";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { getNationalArsenal } from "@/lib/db/collections/nationalArsenal";
import type { CountryId } from "@/lib/constants/countries";
import { getBranches, getUnitTypesForYear } from "@/lib/constants/military";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { unitPurchasePrice } from "@/lib/military/procurement";
import { lotsRequired } from "@/lib/military/arsenal";
import { ensureManpowerPool } from "@/lib/military/manpowerPool";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import {
  applyMilitaryRecruitSpend,
  buildMilitaryRecruitFingerprint,
  MILITARY_RECRUIT_ACTION,
  MILITARY_RECRUIT_APPROPRIATION,
  MILITARY_RECRUIT_MANPOWER,
} from "@/lib/military/recruitSpend";

/** Turns before a newly-recruited unit reaches operational readiness. */
const BUILD_TURNS = 6;
/** Major naval formations take longer. */
const CARRIER_BUILD_TURNS = 10;

export interface MilitaryRecruitInput {
  countryId: CountryId;
  /** Defence cabinet position id (already 404-gated by the route). */
  positionId: string;
  branchId: string;
  type: string;
  /** Raw display name; trimmed here (the route's zod bounds still apply). */
  name: string;
  /** Stringified holder character id, compared against the member row. */
  actorCharacterId: string;
  isAdmin: boolean;
  /** Live year gating which branches/archetypes exist; null skips era gating. */
  liveYear: number | null;
  currentTurn: number;
  preset: string;
  /**
   * Caller-supplied idempotency key (the route's `Idempotency-Key` header).
   * Omit to mint one per attempt.
   */
  idempotencyKey?: string;
}

export interface MilitaryRecruitSuccess {
  success: true;
  actionsRemaining: number;
  price: number;
  appropriationRemaining: number;
  manpowerRemaining: number;
}

export interface MilitaryRecruitRefusal {
  error: string;
  status: number;
}

export type MilitaryRecruitResult = MilitaryRecruitSuccess | MilitaryRecruitRefusal;

interface RecruitArchetype {
  type: string;
  icon: string;
  cost: number;
  upkeep: number;
  personnel: number;
  power: number;
}

/**
 * Raise one military unit for the country (issue #1672 command shell).
 *
 * Eligibility order mirrors the historical route: branch/type era gates,
 * holder, ministerial-action balance, region, budget usability, manpower
 * balance, GDP usability. The balance pre-checks run only for fresh keys: a
 * receipt already on file means the first attempt validated, so a
 * crash-recovery retry (or a duplicate delivery) must NOT re-validate
 * against post-debit reads, where the spent action and drawn pool would fail
 * the gates. It reconciles through the keyed steps instead and reports the
 * stored outcome.
 *
 * Returns `{ error, status }` for the refusal surface the route maps to
 * HTTP codes; throws for the insert failure (compensated prefix, 500) and
 * for settled-key/conflict errors (the route maps those to 409).
 */
export async function applyMilitaryRecruit(
  db: Db,
  input: MilitaryRecruitInput
): Promise<MilitaryRecruitResult> {
  const branch = getBranches(input.countryId, input.liveYear).find((b) => b.id === input.branchId);
  if (!branch) {
    return {
      error:
        input.liveYear != null ? `Branch is not available in ${input.liveYear}` : "Invalid branch",
      status: 400,
    };
  }
  const archetype = getUnitTypesForYear(branch.domain, input.liveYear).find(
    (t) => t.type === input.type
  );
  if (!archetype) {
    return {
      error:
        input.liveYear != null
          ? `Unit type is not available in ${input.liveYear}`
          : "Invalid unit type for this branch",
      status: 400,
    };
  }
  return applyMilitaryRecruitInner(db, input, branch.domain, {
    type: archetype.type,
    icon: archetype.icon,
    cost: archetype.cost,
    upkeep: archetype.upkeep,
    personnel: archetype.personnel,
    power: archetype.power,
  });
}

async function applyMilitaryRecruitInner(
  db: Db,
  input: MilitaryRecruitInput,
  domain: UnitDomain,
  archetype: RecruitArchetype
): Promise<MilitaryRecruitResult> {
  const membersCol = getCabinetMembersCollection(db);
  const member = await membersCol.findOne({
    countryId: input.countryId,
    positionId: input.positionId,
  });

  const isHolder =
    !!member && !!member.characterId && String(member.characterId) === input.actorCharacterId;
  if (!isHolder && !input.isAdmin) {
    return { error: "Only the defence minister may recruit units.", status: 403 };
  }
  if (!member) {
    // Historical shape: an admin with no member row throws reading
    // `member._id` (500 via the error handler). A non-admin never reaches
    // here (403 above).
    throw new TypeError("Military recruit needs a cabinet member row");
  }

  // Backfill legacy members missing the action fields (mirrors the order route).
  if (member.ministerialActions == null) {
    await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
    member.ministerialActions = 2;
  }
  const actionsBefore = member.ministerialActions ?? 2;

  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Military recruit idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const priorReceipt = await receipts.findOne({ _id: key });
  const fresh = !priorReceipt;

  if (fresh && actionsBefore < 1) {
    return { error: "No ministerial actions remaining", status: 400 };
  }

  const region = await db
    .collection("states")
    .findOne({ countryId: input.countryId }, { projection: { _id: 1 } });
  if (!region) {
    return { error: "No region available to station the unit", status: 400 };
  }

  // Budget existence is checked before any resource moves (a read/heal, not
  // a spend), and the countryId-field guard closes the mismatched-key
  // corruption that would otherwise make the unit free.
  const healedBudget = await ensureFederalBudget(db, input.countryId, input.preset);
  if (!healedBudget || healedBudget.countryId !== input.countryId) {
    return {
      error: "This country has no usable national budget — procurement is unavailable",
      status: 409,
    };
  }

  // Manpower is the hard block: a new unit is raised at full establishment.
  // Heal a missing pool first, otherwise a newly enabled country reads pool 0
  // and can never recruit.
  const { pool: poolBefore } = await ensureManpowerPool(db, input.countryId);
  if (fresh && poolBefore < archetype.personnel) {
    return {
      error:
        `Insufficient manpower — ${archetype.personnel.toLocaleString("en-US")} required, ` +
        `${poolBefore.toLocaleString("en-US")} available`,
      status: 400,
    };
  }
  const manpowerDoc = await getNationalManpowerCollection(db).findOne({
    countryId: input.countryId,
  });
  if (!manpowerDoc) {
    // Vanished between the heal and the read: indistinguishable from losing
    // the draw race, so report the race refusal and leave any receipt
    // untouched for a later retry.
    return { error: "Manpower was drawn by another order — try again", status: 409 };
  }

  // Price is a share of the healed budget's own gdp — ANCHORED, so a growing
  // economy outruns its procurement costs. A non-positive or missing gdp
  // returns null and MUST refuse: that value would otherwise make units free.
  // Rounded exactly like the historical appropriation debit, so the keyed leg
  // moves the same amount the old `$inc` moved.
  const computed = unitPurchasePrice(
    archetype,
    input.countryId,
    healedBudget.gdp,
    healedBudget.militaryPriceBaselineGdp
  );
  if (computed == null) {
    return {
      error: "This country has no usable GDP figure — procurement is unavailable",
      status: 409,
    };
  }
  const price = Math.round(computed);

  // The arsenal read pins the degraded path: the plan carries the attempted
  // draw and the store grade, so a retry cannot recalculate a different fill
  // from post-draw stock. A missing store is the designed hollow case, not a
  // refusal — scarcity degrades quality and speed, never presents a dead
  // button.
  const arsenal = await getNationalArsenal(db, input.countryId);
  const arsenalDoc = await db
    .collection<{ _id: ObjectId }>("nationalArsenal")
    .findOne({ countryId: input.countryId } as never, { projection: { _id: 1 } });
  const neededLots = lotsRequired(archetype);
  const plannedDrawn =
    arsenalDoc == null
      ? 0
      : Math.max(0, Math.min(neededLots, Math.floor(arsenal.stock[domain] ?? 0)));

  const name = input.name.trim();
  const fingerprint = buildMilitaryRecruitFingerprint({
    countryId: input.countryId,
    memberId: member._id,
    branchId: input.branchId,
    type: archetype.type,
    name,
    createdTurn: input.currentTurn,
    personnel: archetype.personnel,
    price,
  });

  const buildDuration =
    archetype.type === "Carrier Strike Group" ? CARRIER_BUILD_TURNS : BUILD_TURNS;

  try {
    const { outcome } = await applyMilitaryRecruitSpend(db, {
      countryId: input.countryId,
      memberId: member._id,
      actionsBefore,
      manpowerDocId: manpowerDoc._id,
      poolBefore,
      personnel: archetype.personnel,
      budgetId: String(healedBudget._id),
      price,
      domain,
      arsenalDocId: arsenalDoc ? arsenalDoc._id : null,
      neededLots,
      plannedDrawn,
      arsenalGrade: arsenal.grade[domain] ?? 0,
      unit: {
        branchId: input.branchId,
        name,
        type: archetype.type,
        icon: archetype.icon,
        basePower: archetype.power,
        upkeepBase: archetype.upkeep,
      },
      createdTurn: input.currentTurn,
      readyAtTurn: input.currentTurn + buildDuration,
      fingerprint,
      idempotencyKey: key,
    });
    return {
      success: true,
      actionsRemaining: outcome.actionsRemaining,
      price: outcome.price,
      appropriationRemaining: outcome.appropriationRemaining,
      manpowerRemaining: outcome.manpowerRemaining,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith(`${MILITARY_RECRUIT_ACTION}:`)) {
        return { error: "No ministerial actions remaining", status: 409 };
      }
      if (error.message.startsWith(`${MILITARY_RECRUIT_MANPOWER}:`)) {
        return { error: "Manpower was drawn by another order — try again", status: 409 };
      }
      if (error.message.startsWith(`${MILITARY_RECRUIT_APPROPRIATION}:`)) {
        const { balance } = await getDefenseAppropriation(db, input.countryId);
        return {
          error:
            `Defence appropriation is short — ${price.toLocaleString("en-US")} required, ` +
            `${Math.max(0, balance).toLocaleString("en-US")} available`,
          status: 409,
        };
      }
    }
    throw error;
  }
}
