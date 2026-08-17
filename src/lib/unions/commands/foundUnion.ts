/**
 * Union dues v1 — found a rival union.
 *
 * Before dues v1 there was exactly one union per (countryId, sectorType) pair,
 * seeded by the world. This is what makes a SECOND one possible: any character
 * in the target country may found a new union in an industry that already has
 * one, which is what gives {@link organizeSector}'s raid path something to
 * raid. A founded union starts with nothing — zero treasury, no represented
 * sectors, no services — and must organize its way into the industry exactly
 * like an NPP challenger would.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { BASE_APPROVAL } from "@/lib/unions/unionDues";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { rejectIfTurnProcessing } from "./unionActions";
import type { UnionActionResult } from "./unionActions";

/**
 * Modern (₳-anchor) founding fee, scaled into the world's era
 * (`getEraNominalAmount`) and the founder's home currency
 * (`getFoundingFxRate`) exactly like a corporation founding fee — the same
 * "flat currency figure is wrong in every era/country but one" problem
 * `unionServices.ts` documents applies here too.
 *
 * Set well below `CORPORATION_FOUNDING_COST` (1,000,000): a union isn't
 * capitalizing a company (a founded union's treasury starts at 0, see
 * below), it's a registration/organizing fee for the right to contest an
 * industry.
 */
export const UNION_FOUNDING_COST_ANCHOR = 20_000;

export const MIN_UNION_NAME_LENGTH = 2;
export const MAX_UNION_NAME_LENGTH = 60;

export interface FoundUnionInput {
  countryId: CountryId;
  sectorType: CorporationType;
  name: string;
}

/**
 * Found a new union. The founding character must be present in the target
 * country, pays `UNION_FOUNDING_COST_ANCHOR` (era/FX scaled) out of personal
 * cash, and cannot reuse a name already taken by another union in the same
 * (countryId, sectorType) pair.
 */
export async function foundUnion(
  db: Db,
  character: Character,
  input: FoundUnionInput
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  if (character.countryId !== input.countryId) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this country to found a union here.",
    };
  }

  if (await isUnionsBanned(db, input.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const name = input.name.trim();
  if (name.length < MIN_UNION_NAME_LENGTH || name.length > MAX_UNION_NAME_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Union name must be between ${MIN_UNION_NAME_LENGTH} and ${MAX_UNION_NAME_LENGTH} characters.`,
    };
  }

  // Duplicate check is scoped to (countryId, sectorType): the same name is
  // fine in a different country or a different industry, but two rival
  // unions organizing the same industry in the same country cannot share one.
  const existingNames = await db
    .collection<Union>("unions")
    .find(
      { countryId: input.countryId, sectorType: input.sectorType },
      { projection: { name: 1 } }
    )
    .toArray();
  const nameLower = name.toLowerCase();
  if (existingNames.some((u) => (u.name ?? "").trim().toLowerCase() === nameLower)) {
    return {
      ok: false,
      status: 409,
      error: "A union with this name already exists in this country and industry.",
    };
  }

  const forexEnabled = await isForexEnabled();
  const preset = await getGameStatePresetOrDefault(db);
  const homeCurrency = getHomeCurrency(character);
  const foundingRate = getFoundingFxRate(input.countryId, forexEnabled);
  const costLocal = Math.round(getEraNominalAmount(UNION_FOUNDING_COST_ANCHOR, preset) * foundingRate);

  const debit = await atomicallyDebitCharacterCash(
    db,
    character._id,
    homeCurrency,
    costLocal,
    forexEnabled
  );
  if (!debit.ok) {
    return {
      ok: false,
      status: 402,
      error: `Founding a union costs ${costLocal.toLocaleString()} ${homeCurrency} (you don't have enough).`,
    };
  }

  const now = new Date();
  try {
    const insertResult = await db.collection<Union>("unions").insertOne({
      _id: new ObjectId(),
      countryId: input.countryId,
      sectorType: input.sectorType,
      name,
      ownerId: character._id,
      ownerType: "character",
      pendingLeaderCharacterId: null,
      treasury: 0,
      strength: 0,
      approval: BASE_APPROVAL,
      duesPerWorkerAnnual: 0,
      activeServices: [],
      foundedByCharacterId: character._id,
      lastCalledStrikeTurn: null,
      demandedWageLevel: null,
      createdAt: now,
      updatedAt: now,
    } as Union);

    return {
      ok: true,
      status: 200,
      unionId: insertResult.insertedId.toString(),
      name,
      countryId: input.countryId,
      sectorType: input.sectorType,
      cashSpent: costLocal,
      currency: homeCurrency,
    };
  } catch (error) {
    // The union document didn't land — refund rather than leave the founder
    // charged for nothing. Covers both genuine infra failures and a
    // duplicate-key race on a legacy (countryId, sectorType) unique index
    // some worlds may still carry from before rival unions existed.
    await refundCharacterCash(db, character._id, homeCurrency, costLocal, forexEnabled);
    const message =
      error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === 11000
        ? "This country and industry already has a union blocking a second one at the database level — contact ops."
        : "Failed to found the union — you have been refunded.";
    return { ok: false, status: 409, error: message };
  }
}
