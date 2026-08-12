import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode, CurrencyCyclePressureRegime } from "@/lib/constants/currencies";
import type { TurnSnapshot } from "./centralBank";

/** One row in the recent-interventions audit log (ring buffer, last 24 turns). */
export interface InterventionRecord {
  turn: number;
  direction: "buy" | "sell";
  /** Reserve draw in local currency units (EUR, GBP, etc.) */
  reservesSpent: number;
  fundingSource: "forexRevenue" | "reserveBalance" | "spreadFeeReserves" | "mixed";
  resultingRate: number;
}

/** Active FX intervention policy for this currency. Null when no band is set. */
export interface InterventionPolicy {
  floor: number;
  ceiling: number;
  setByCharacterId: ObjectId;
  setByCharacterName: string;
  setAtTurn: number;
  /** Last turn the band was narrowed or cancelled — gates the 6-turn cooldown. */
  lastAdjustedAtTurn: number;
  /** Last turn infamy was charged for the current breach cycle (dedup). */
  lastInfamyChargedAtTurn?: number;
  recentInterventions: InterventionRecord[];
}

export interface ExchangeRate {
  /** CountryId used as _id */
  _id: string;
  countryId: CountryId;
  currencyCode: CurrencyCode;
  /** Local currency per 1 internal unit */
  rate: number;
  /** Initial calibration rate — never changes */
  baseRate: number;
  /** Current fundamental target rate derived from macro data */
  macroTarget: number;
  /** Per-turn snapshots for charting — pruned each turn to last FOREX_AND_MACRO_CHART_HISTORY_TURNS */
  rateHistory: TurnSnapshot[];
  /** Gross buy volume over past 24 turns, in internal units */
  buyVolume24: number;
  /** Gross sell volume over past 24 turns, in internal units */
  sellVolume24: number;
  /** Admin-set permanent peg rate — rate drift is skipped while set; cleared to remove */
  hardPeg?: number | null;
  /**
   * Active 12-hour (12-turn) directional pressure regime and the turn it expires.
   * Re-rolled randomly when `cyclePressureUntilTurn` is reached. Optional — lazily
   * initialized on the first forex turn, so no reseed is needed.
   */
  cyclePressureRegime?: CurrencyCyclePressureRegime | null;
  cyclePressureUntilTurn?: number | null;
  /** Chair-set FX intervention band policy. Null when no band is active. */
  interventionPolicy?: InterventionPolicy | null;
  /**
   * B6 declared exchange-rate regime. Absent = "float", which is what every
   * currency without a band or a peg already behaved as, so existing worlds
   * read identically.
   *
   * This is the CHAIR's declaration, distinct from `hardPeg` (an admin
   * operator tool). It is what the impossible-trinity constraint is resolved
   * against — see `currency/exchangeRateRegime.ts`.
   */
  fxRegime?: import("@/lib/currency/exchangeRateRegime").FxRegime;
  /** The peg's target rate, when `fxRegime` is "peg". */
  pegTarget?: number | null;
  /**
   * Capital controls: the third leg of the trinity. Closing the capital
   * account buys back monetary independence under a committed rate.
   */
  capitalControls?: boolean;
  /** Turn the chair last changed the regime (cooldown gate). */
  fxRegimeSetAtTurn?: number;
  /**
   * Chair-set multiplier (0.5–1.5) on the spread fee when this currency is sold.
   * Default 1.0. Read in the hot path (executeMarketMakerTrade) off the already-
   * loaded fromExRate doc, so no extra query.
   */
  forexSpreadStrength?: number;
  /** Turn the chair last changed `forexSpreadStrength` (cooldown gate). */
  forexSpreadStrengthLastChangedTurn?: number;
  updatedAt: Date;
}
