import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

// ── Bond Maturity Options ────────────────────────────────────────────────────

/**
 * Maturity in turns (48 turns = 1 game year).
 * 48/96/240 are historical corporate + sovereign choices; 336 = 7 years (new corporate only).
 */
export type BondMaturityTurns = 48 | 96 | 240 | 336;
export type BondIssuerType = "corporation" | "sovereign";

/** Every maturity value that may appear on stored bond documents (including legacy 1yr corporate). */
export const BOND_MATURITY_OPTIONS: BondMaturityTurns[] = [48, 96, 240, 336];

/**
 * New corporate bond issuance: minimum 2 game years, then 5yr and 7yr.
 * Does not apply to sovereign/treasury bonds (those may still use 1yr via automation/admin).
 */
export const CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS: readonly BondMaturityTurns[] = [
  96, 240, 336,
];

/** Admin / API choices for manually issued sovereign debt (unchanged from classic set). */
export const SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS: readonly BondMaturityTurns[] = [48, 96, 240];

export const BOND_MATURITY_LABELS: Record<BondMaturityTurns, string> = {
  48: "1 Year",
  96: "2 Year",
  240: "5 Year",
  336: "7 Year",
};

// ── Bond Document ────────────────────────────────────────────────────────────

export interface Bond {
  _id: ObjectId;
  /** Issuer type - corporations are legacy/default, sovereign covers US/UK treasury issuance */
  issuerType?: BondIssuerType;
  /** Issuer identifier. For corporate bonds this is the corporation _id; sovereign bonds use a synthetic id. */
  corporationId: ObjectId;
  /** Country backing the bond when issuerType is sovereign */
  countryId?: CountryId;
  /** Cached display name for the issuer */
  issuerName?: string;
  /** Face value of the bond in dollars */
  faceValue: number;
  /** Annual coupon rate (%) — set at issuance based on credit rating + prime rate */
  couponRate: number;
  /** Maturity length in turns */
  maturityTurns: BondMaturityTurns;
  /** Turn number when the bond was issued */
  issuedAtTurn: number;
  /** Turn number when the bond matures (issuedAtTurn + maturityTurns) */
  maturityTurn: number;
  /** Current market price as a fraction of face value (e.g. 1.0 = par, 0.95 = 95 cents on the dollar) */
  marketPrice: number;
  /** Total amount still outstanding (face value × number of units issued) */
  totalIssued: number;
  /** Units held by the currency's bond market pool (see `BondMarketPool`). */
  publicFloat: number;
  /**
   * Primary market (phase 3). `requestedUnits` is what the issuer asked for at
   * issuance; `unsoldUnits` is the part the pool could not underwrite and that
   * is still placing turn by turn. Unsold units are NOT debt: they are outside
   * `totalIssued`, earn no coupon, and do not count toward the unit invariant.
   * `primaryFillRatio` is placed / requested at issuance, kept for the record.
   */
  requestedUnits?: number;
  unsoldUnits?: number;
  primaryFillRatio?: number;
  /** Units held off-market by the issuing currency's central bank through QE. */
  centralBankHoldings?: number;
  /** Central-bank share of outstanding units, used as persistent price support. */
  qeSupportRatio?: number;
  /** Bond holders */
  holders: BondHolder[];
  /** Whether the issuing corporation has defaulted on this bond */
  defaulted: boolean;
  /**
   * Name of the corporation that originally issued this bond, stamped when the
   * state assumes it on a whole-corp nationalization (the issuer is re-parented
   * to the National Corporation, so the original name would otherwise be lost).
   */
  originalIssuerName?: string;
  /**
   * Turn at which the most recent default occurred. Preserved after a cure
   * (cash payoff / refinance / parent-payoff) so the bond doc still records
   * its default history; pair with {@link Bond.defaultCure} to distinguish
   * "currently defaulted" from "previously defaulted, since cured".
   */
  defaultedAtTurn: number | null;
  /**
   * Audit trail for a default that has been resolved. Set when one of the
   * cure flows (cash, refinance, parent-payoff) flips a defaulted bond to
   * matured/settled. Absent on bonds that never defaulted or are still in
   * default. The Bonds tab uses this to render a "DEFAULT CURED" badge in
   * place of the bare MATURED chip.
   */
  defaultCure?: {
    cureMethod: "cash" | "refinance" | "parent_payoff" | "restructure";
    curedAtTurn: number;
  };
  /** Whether the bond has fully matured and been settled */
  matured: boolean;
  /**
   * Turn on which a matured bond's face value was auto-redeemed to holders and
   * the holdings cleared. Set alongside `matured: true` by the bond turn
   * processor. Distinguishes a cleanly settled bond from legacy rows that were
   * flagged `matured` before auto-redemption existed (those still carry
   * populated `holders` and were never paid — see issue #2974). Absent on
   * unmatured bonds.
   */
  redeemedAtTurn?: number;
  /**
   * Currency the bond's face value, coupon payments, principal, and market
   * price are denominated in (v0.2.6+). Sovereign bonds inherit the issuer
   * country's currency; corporate bonds inherit the issuing corp's
   * `liquidCurrencyCode`. Absence means pre-migration ₳ — migration script
   * `bondCurrencyStamp` backfills existing bonds; new issuance always sets it.
   */
  currencyCode?: CurrencyCode;

  // === Sovereign default subsystem (phase 1+) ===
  // All fields optional for backward compatibility with pre-migration documents.
  // Migration `sovereignDefaultPhase1Bonds.ts` backfills explicit nulls.

  /**
   * Sovereign-default restructure: principal write-down percentage (0..1).
   * Set when a sovereign bond is restructured rather than fully defaulted.
   * Coexists with `defaulted: false` because restructure is technical default,
   * not full default. See sovereign-default design doc Section 4.2.
   */
  restructureHaircutPercent?: number | null;
  /**
   * Sovereign-default restructure: new maturity turn after extension.
   * Set alongside `restructureHaircutPercent`.
   */
  restructureExtendedMaturityTurn?: number | null;
  /**
   * Sovereign-default audit trail: pre-restructure maturity turn.
   * Preserved when `restructureExtendedMaturityTurn` overwrites the active
   * maturity. Allows historical reconstruction of the original bond contract.
   */
  originalMaturityTurn?: number | null;
  /**
   * Sovereign-default audit trail: pre-haircut face value.
   * Preserved when restructure write-down reduces the active `totalIssued`.
   */
  originalTotalIssued?: number | null;

  /**
   * True when this bond was created by the admin auto-reconcile endpoint rather
   * than by the quarterly scheduler. The scheduler's dedup query excludes
   * reconcile bonds so both paths can issue 1yr (48t) paper at the same turn
   * without blocking each other.
   */
  reconcile?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface BondHolder {
  /** Character, imperial character, or corporation holding the bond */
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  corporationId?: ObjectId;
  /** Index fund holding sovereign/corporate bond units. */
  fundId?: ObjectId;
  /** Autonomous (V3) NPP holding the bond. Gated by nppAutonomyLevel v3. */
  nppId?: ObjectId;
  /** Number of bond units held (each unit = $1,000 face value) */
  units: number;
  /** Weighted average purchase price per unit (face value × marketPrice at purchase). Null for pre-tracking positions. */
  avgCostPerUnit?: number;
}

// ── Corporate Credit Rating ──────────────────────────────────────────────────

export interface CorporateCreditRating {
  rating: import("./centralBank").CreditRating;
  /** Components that went into the rating */
  components: {
    /** Debt-to-equity ratio score (0-100) */
    debtToEquity: number;
    /** Interest coverage ratio score (0-100) */
    interestCoverage: number;
    /** Profitability score (0-100) */
    profitability: number;
    /** Liquidity score (0-100) */
    liquidity: number;
  };
  /** Composite score (0-100, higher = better) */
  compositeScore: number;
  /** Effective coupon rate = prime rate + credit spread */
  effectiveCouponRate: number;
}

// ── Bond Unit Size ───────────────────────────────────────────────────────────

/**
 * Each bond unit has a face value of 1,000 in the bond's denomination
 * currency (v0.2.6+ — `Bond.currencyCode`). Pre-migration, bonds were
 * implicitly anchor-denominated; post-migration the same numeric unit means
 * "1,000 of whatever the bond's currencyCode is" (1,000 USD for a US
 * treasury, 1,000 GBP for a UK gilt, 1,000 JPY for a JGB, etc.).
 *
 * **Unit contract (post-v0.2.6):** this constant is in the bond's LOCAL
 * currency. Any expression of the form `BOND_UNIT_FACE_VALUE × units` or
 * `perTurnCouponPayment(rate, BOND_UNIT_FACE_VALUE) × units` produces a
 * value in the bond's `currencyCode`, **not** ₳. To get ₳, feed the result
 * through `corpCapitalToAnchor(value, bond.currencyCode, fxRate)` where
 * `fxRate = fxByCurrency.get(bond.currencyCode) ?? 1`. Do this at the
 * source of the expression, not at the consumer — every caller that
 * forwards a LOCAL value to an ₳-expecting API is a bug waiting to
 * surface (A13/A14 class).
 */
export const BOND_UNIT_FACE_VALUE = 1_000;
