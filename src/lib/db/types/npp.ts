import type { ObjectId } from "mongodb";
import type { PolicyPositions } from "./character";
import type { OfficeType, LineOfCreditState } from "./character";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";

export interface NPPPersonality {
  loyalty: number;
  ambition: number;
  stubbornness: number;
}

export type NPPGender = "male" | "female";
export type NPPEthnicity = "white" | "black" | "hispanic" | "asian" | "other";

export interface NPP {
  _id: ObjectId;
  countryId?: CountryId;
  name: string;
  gender?: NPPGender;
  ethnicity?: NPPEthnicity;
  homeState: string;
  avatarUrl?: string;
  politicalInfluence: number;
  favorability: number;
  policies: PolicyPositions;
  party: string;
  currentOffice: OfficeType | null;
  /**
   * Seed provenance: the `HistoricalSeat.officeType` this NPP was created FOR by
   * `seedFromSeats`. NOT an office held — it is set in `"priors"` mode too, where
   * `currentOffice` is deliberately `null` because the founding election has yet
   * to seat anyone.
   *
   * Exists so a roster seed can tell "this chamber was already seeded" from "this
   * chamber is empty" and converge on a re-run. In `"winners"` mode the seated
   * `electedOfficials` carry that signal already; in `"priors"` mode they do not
   * exist by construction, and the NPP itself records nothing else that
   * identifies a chamber — `homeState` is shared across a country's chambers and
   * the generated `name` is random, so neither can key a re-run. Absent on NPPs
   * from every other creation path (runtime generation, admin spawn).
   */
  seededForOfficeType?: string;
  personality: NPPPersonality;
  generatedAt: Date;
  retiredAt: Date | null;
  influenceState?: {
    lastInfluencedTurn?: number;
    totalTimesInfluenced: number;
  };
  electionCooldowns?: Record<string, string>;
  /**
   * Per-archetype approval modifiers (-100 to +100).
   * Applied as: effectiveFavorability = favorability + archetypeApprovals[archetype] * 0.5
   * Decays 0.5% per turn toward 0.
   */
  archetypeApprovals?: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  /** Sequential ID for stable URLs (e.g., /politicians/npp/1) */
  sequentialId?: number;
  /** Campaign funds for NPP economic actions (starts at 0) */
  funds?: number;
  /**
   * V3 full-agency finance: per-currency holdings mirroring the player
   * `Character.currencyBalances` shape so the savings/portfolio turn phases can
   * service NPPs through the same field paths. NPPs have no `campaign` bucket
   * here (their campaign war chest is the flat `funds` field); this carries
   * personal wealth, savings (APY), and the interest accrual buckets.
   * Gated by nppAutonomyLevel v3.
   */
  currencyBalances?: {
    /** Personal wealth per currency — missing keys treated as 0 */
    personal?: Partial<Record<CurrencyCode, number>>;
    /** Savings per currency — APY tied to that currency's national prime rate */
    savings?: Partial<Record<CurrencyCode, number>>;
    /** Cumulative interest credited to savings, per currency (lifetime) */
    interestEarned?: Partial<Record<CurrencyCode, number>>;
    /** Per-turn accrued interest not yet quarterly-credited to savings */
    pendingSavingsInterest?: Partial<Record<CurrencyCode, number>>;
  };
  /**
   * V3 full-agency finance: multi-currency line of credit, same shape as the
   * player field so `lineOfCreditTurn` can service NPPs. Gated by v3.
   */
  lineOfCredit?: LineOfCreditState;
  /** Cash ledger, in index-fund anchor units, reserved for passive fund subscriptions */
  nppInvestmentCashAnchor?: number;
  /** Last turn when the passive fund investment budget was accrued */
  lastIndexFundInvestmentTurn?: number;
  /** Donor base level (starts at 1 so NPPs draw a small donor income from spawn) */
  donorBaseLevel?: number;
  /** Action point pool, cap 100 (starts at 0) */
  actionPoints?: number;
  /** Turn when actions were last processed */
  lastActionProcessedTurn?: number;
  /** Patreon profile border key */
  borderKey?: string | null;
  /** Patreon highlight color for tintable borders */
  tintColor?: string | null;
  /**
   * Caucus / faction this NPP belongs to. Null = unaffiliated.
   * Caucuses are a national-only structure — see `Caucus` in db/types/caucus.ts.
   * Set/cleared via the caucus membership APIs; reads should normally go through
   * the `caucusMemberships` collection, but this denormalized field exists for
   * fast roster filtering and faction-grouped views without a join.
   */
  factionId?: ObjectId | null;
  /** Technocrat NPPs are excluded from election entry, bill voting, action AI, and fund generation. */
  isTechnocrat?: boolean;
  technocratRole?: string;
}

export interface NPPDisplay {
  id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice: string;
  avatarUrl?: string;
  politicalInfluence: number;
  favorability: number;
  isNPP: true;
}
