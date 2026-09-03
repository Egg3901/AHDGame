import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import {
  RESERVE_REQUIREMENT_MAX,
  RESERVE_REQUIREMENT_MIN,
  defaultReserveRequirement,
} from "@/lib/banking/rules/reserves";

// The bounds live in `reserveBounds.ts` because a client component needs them
// and this module reaches the database and the turn engine. Re-exported here so
// server-side callers and their imports are unchanged.
export {
  RESERVE_REQUIREMENT_HISTORICAL_DEFAULT,
  RESERVE_REQUIREMENT_MODERN_DEFAULT,
  RESERVE_REQUIREMENT_MIN,
  RESERVE_REQUIREMENT_MAX,
  getLendableHeadroom,
} from "@/lib/banking/rules/reserves";

export type SetReserveRequirementResult =
  { ok: true; ratio: number } | { ok: false; error: string };

/**
 * Reserve ratio the currency's central bank requires of private banks.
 * Reads `bankReserveRequirement` when set; otherwise era default.
 */
export async function getReserveRequirement(db: Db, currency: CurrencyCode): Promise<number> {
  const countryId = getCountryIdForCurrency(currency);
  const bankId = getBankId(countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId }, { projection: { bankReserveRequirement: 1 } });

  const stored = bank?.bankReserveRequirement;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return stored;
  }

  return defaultReserveRequirement(await loadWorldEraUnitScale(db));
}

/**
 * Chair/admin sets the private-bank reserve requirement for a currency.
 * Rejects out-of-range values (does not silently clamp).
 */
export async function setReserveRequirement(
  db: Db,
  currency: CurrencyCode,
  ratio: number
): Promise<SetReserveRequirementResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }

  if (
    !Number.isFinite(ratio) ||
    ratio < RESERVE_REQUIREMENT_MIN ||
    ratio > RESERVE_REQUIREMENT_MAX
  ) {
    return {
      ok: false,
      error: `Reserve requirement must be between ${RESERVE_REQUIREMENT_MIN} and ${RESERVE_REQUIREMENT_MAX}`,
    };
  }

  const countryId = getCountryIdForCurrency(currency);
  const bankId = getBankId(countryId);
  const result = await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bankId },
    {
      $set: {
        bankReserveRequirement: ratio,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount !== 1) {
    return { ok: false, error: "Central bank not found for currency" };
  }

  return { ok: true, ratio };
}
