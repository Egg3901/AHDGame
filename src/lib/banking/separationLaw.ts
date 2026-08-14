import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameConfig, GameState } from "@/lib/db/types";
import type { BankCharterType } from "@/lib/db/types/bank";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * Banking charter separation is a per-country law, not a world switch. Any
 * non-command nation's legislature can enact or repeal it by ordinary bill
 * (catalog entry lands with the legislation phase); this collection stores the
 * enacted state, and absent a bill the era default applies: historical worlds
 * (era unit scale > 1) seed "separated", modern worlds default "universal".
 */
export type BankingSeparationPolicy = "separated" | "universal";

/** Rate offset corridor relative to prime, in percentage points. */
export type RateCorridor = {
  minOffset: number;
  maxOffset: number;
};

/** Collection: bankingLaws. One doc per country that has legislated on separation. */
export interface BankingLawDoc {
  _id: CountryId;
  separation: BankingSeparationPolicy;
  enactedTurn: number;
  /** Bill id when enacted by legislation; absent for admin/seed writes. */
  billId?: string;
  /**
   * Optional Regulation Q deposit-rate corridor override (pp vs prime).
   * Absent ⇒ era default from {@link getDepositRateCorridor}.
   */
  depositCorridor?: RateCorridor;
  /**
   * Optional lending-rate corridor override (pp vs prime).
   * Absent ⇒ era default from {@link getLendingRateCorridor}.
   */
  lendingCorridor?: RateCorridor;
}

export async function getBankingSeparationPolicy(
  db: Db,
  countryId: CountryId
): Promise<BankingSeparationPolicy> {
  const law = await db
    .collection<BankingLawDoc>("bankingLaws")
    .findOne({ _id: countryId }, { projection: { separation: 1 } });
  if (law?.separation) {
    return law.separation;
  }
  const eraUnitScale = await loadWorldEraUnitScale(db);
  return eraUnitScale > 1 ? "separated" : "universal";
}

/**
 * Charter types legal for banks in `countryId`'s jurisdiction. Command-economy
 * nations have no private chartering at all (empty list).
 */
export async function getLegalCharterTypes(
  db: Db,
  countryId: CountryId
): Promise<BankCharterType[]> {
  const [gameState, config] = await Promise.all([
    db
      .collection<GameState>("gameState")
      // gameState is keyed by _id "current"; do not filter on isActive.
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { commandEconomyEnabled: 1, playerAdvancedBankChartersEnabled: 1 } }
      ),
  ]);
  if (
    isCommandEconomy(
      countryId,
      gameState?.currentYear ?? null,
      config?.commandEconomyEnabled ?? false
    )
  ) {
    return [];
  }
  // Advanced charters (investment / universal) are withheld from players until
  // explicitly enabled; retail is the only type on offer meanwhile. Gates both
  // new charters and type switches, which both consult this function.
  if (!config?.playerAdvancedBankChartersEnabled) {
    return ["retail"];
  }
  const policy = await getBankingSeparationPolicy(db, countryId);
  return policy === "separated" ? ["retail", "investment"] : ["retail", "investment", "universal"];
}
