import type { Db, ObjectId } from "mongodb";
import type { BankCharter, BankCharterType } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector, GameConfig } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import {
  getGdpAnchorRate,
  loadWorldEraUnitScale,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { archiveCharter } from "@/lib/banking/charterHistory";
import { getLegalCharterTypes } from "@/lib/banking/separationLaw";
import { clampOffsets, getRateCorridors } from "@/lib/banking/regulationQ";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCurrentTurn } from "@/lib/currentTurn";

/** Modern-era USD reference: 10× corp founding cost. Era/FX scaled at call time. */
const CHARTER_CAPITAL_REFERENCE_USD = CORPORATION_FOUNDING_COST * 10;

export type CharterEligibilityResult = {
  eligible: boolean;
  reasons: string[];
  /** Capital requirement computed during the check, reused by issueCharter. */
  requirement: number;
};

export type IssueCharterResult =
  | { ok: true; charter: BankCharter; postedCapital: number }
  | { ok: false; reasons: string[] };

export type RevokeCharterResult =
  | { ok: true; refundedCapital: number; charter: BankCharter }
  | { ok: false; error: string };

/**
 * Minimum capital to post for a bank charter, in `currency` face value.
 *
 * Base is 10× {@link CORPORATION_FOUNDING_COST} in USD-1953 reference terms,
 * deflated by the world's era unit scale, then converted to the bank's
 * currency via {@link getGdpAnchorRate} (local = anchor / rate).
 */
export async function getCharterCapitalRequirement(
  db: Db,
  currency: CurrencyCode
): Promise<number> {
  const [eraUnitScale, preset] = await Promise.all([
    loadWorldEraUnitScale(db),
    loadWorldPreset(db),
  ]);
  const scale = eraUnitScale > 0 && Number.isFinite(eraUnitScale) ? eraUnitScale : 1;
  const countryId = getCountryIdForCurrency(currency);
  const rate = getGdpAnchorRate(countryId, preset);
  const safeRate = rate > 0 && Number.isFinite(rate) ? rate : 1;
  const anchor = CHARTER_CAPITAL_REFERENCE_USD / scale;
  return Math.max(1, Math.round(anchor / safeRate));
}

async function corpOwnsFinancialSector(db: Db, corporationId: ObjectId): Promise<boolean> {
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ corporationId, sectorType: "financial" }, { projection: { _id: 1 } });
  return sector != null;
}

/**
 * Objective charter gates (no approval step). All reasons are collected so the
 * UI can show every blocker at once.
 */
export async function checkCharterEligibility(
  db: Db,
  corporation: Corporation,
  requestedType: BankCharterType,
  currency: CurrencyCode,
  options?: { skipFlagCheck?: boolean }
): Promise<CharterEligibilityResult> {
  const reasons: string[] = [];

  if (!options?.skipFlagCheck) {
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          privateBankingEnabled: 1,
          bankPropTradingEnabled: 1,
          bankContagionEnabled: 1,
        },
      }
    );

    if (!(await isPrivateBankingEnabled(config))) {
      reasons.push("Private banking is not enabled");
    }
  }

  if (!(await corpOwnsFinancialSector(db, corporation._id))) {
    reasons.push("Corporation must own at least one financial sector");
  }

  if (corporation.bankCharter?.status === "active") {
    reasons.push("Corporation already has an active bank charter");
  }

  const legalTypes = await getLegalCharterTypes(db, getCountryIdForCurrency(currency));
  if (legalTypes.length === 0) {
    reasons.push("Private bank charters are not available in a command economy");
  } else if (!legalTypes.includes(requestedType)) {
    reasons.push(
      requestedType === "universal"
        ? "Universal charters are not legal under this nation's banking separation law"
        : `Charter type "${requestedType}" is not legal in this jurisdiction`
    );
  }

  const corpCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
  if (corpCurrency !== currency) {
    reasons.push(`Corporation treasury is denominated in ${corpCurrency}, not ${currency}`);
  }

  const requirement = await getCharterCapitalRequirement(db, currency);
  if ((corporation.liquidCapital ?? 0) < requirement) {
    reasons.push(
      `Insufficient treasury: need ${requirement.toLocaleString()} ${currency} posted capital`
    );
  }

  return { eligible: reasons.length === 0, reasons, requirement };
}

/**
 * Issue a bank charter: re-check eligibility, then atomically debit posted
 * capital and write `bankCharter` on the same corporation document (standalone
 * Mongo - one-doc update is crash-safe).
 */
export async function issueCharter(
  db: Db,
  corporationId: ObjectId,
  requestedType: BankCharterType,
  currency: CurrencyCode,
  options?: { skipFlagCheck?: boolean }
): Promise<IssueCharterResult> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, reasons: ["Corporation not found"] };
  }

  // skipFlagCheck is for SEED-TIME use only (NPC banks charter before the
  // world flag is on). Player routes must never pass it.
  const eligibility = await checkCharterEligibility(
    db,
    corporation,
    requestedType,
    currency,
    options
  );
  if (!eligibility.eligible) {
    return { ok: false, reasons: eligibility.reasons };
  }

  const postedCapital = eligibility.requirement;
  const charteredTurn = await getCurrentTurn(db);
  const now = new Date();

  // Overwriting a non-active charter: archive the old sub-doc first so history
  // survives the $set that replaces bankCharter entirely.
  const prior = corporation.bankCharter;
  if (prior && prior.status !== "active") {
    await archiveCharter(db, corporationId, prior, charteredTurn, "recharter");
  }

  // Initial offsets must sit inside the era corridor; 0/0 is out of band in
  // historical worlds (deposit ceiling below prime, lending floor above it).
  const corridors = await getRateCorridors(db, getCountryIdForCurrency(currency));
  const initialOffsets = clampOffsets({ depositOffset: 0, lendingOffset: 0 }, corridors);

  const charter: BankCharter = {
    type: requestedType,
    status: "active",
    currency,
    charteredTurn,
    postedCapital,
    depositOffset: initialOffsets.depositOffset,
    lendingOffset: initialOffsets.lendingOffset,
    blacklist: {},
  };

  // Single-document atomic debit + charter write. Filter re-gates capital and
  // rejects a race that already activated a charter.
  const updated = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      liquidCapital: { $gte: postedCapital },
      $or: [{ bankCharter: { $exists: false } }, { "bankCharter.status": { $ne: "active" } }],
    },
    {
      $inc: { liquidCapital: -postedCapital },
      $set: {
        bankCharter: charter,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return {
      ok: false,
      reasons: ["Failed to post capital (insufficient funds or charter already active)"],
    };
  }

  return {
    ok: true,
    charter: updated.bankCharter ?? charter,
    postedCapital,
  };
}

/**
 * Revoke a charter. Refunds posted capital to the corp treasury only when
 * totalDeposits is zero or absent (capital still backs depositors otherwise).
 */
export async function revokeCharter(
  db: Db,
  corporationId: ObjectId,
  reason: string
): Promise<RevokeCharterResult> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, error: "Corporation not found" };
  }
  if (corporation.bankCharter?.status !== "active") {
    return { ok: false, error: "Corporation has no active bank charter" };
  }

  const charter = corporation.bankCharter;
  const deposits = charter.totalDeposits ?? 0;
  const refund = deposits <= 0 ? charter.postedCapital : 0;
  const revokedTurn = await getCurrentTurn(db);
  const now = new Date();

  const revokedCharter: BankCharter = {
    ...charter,
    status: "revoked",
    revokedTurn,
    revokedReason: reason,
  };

  const update: {
    $set: Record<string, unknown>;
    $inc?: { liquidCapital: number };
  } = {
    $set: {
      "bankCharter.status": "revoked",
      "bankCharter.revokedTurn": revokedTurn,
      "bankCharter.revokedReason": reason,
      updatedAt: now,
    },
  };
  if (refund > 0) {
    update.$inc = { liquidCapital: refund };
  }

  const result = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corporationId, "bankCharter.status": "active" }, update);

  if (result.modifiedCount !== 1) {
    return { ok: false, error: "Failed to revoke charter (no longer active)" };
  }

  await archiveCharter(db, corporationId, revokedCharter, revokedTurn, "revoked");

  return { ok: true, refundedCapital: refund, charter: revokedCharter };
}

/**
 * Whether `characterId` is the seated chair of the central bank that issues
 * `currency` (via the currency's anchor country → shared bank id).
 */
export async function isChairOfCurrencyBank(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode
): Promise<boolean> {
  const countryId = getCountryIdForCurrency(currency);
  const bankId = getBankId(countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId }, { projection: { chairCharacterId: 1 } });
  return !!bank?.chairCharacterId && bank.chairCharacterId.equals(characterId);
}
