import type { ObjectId } from "mongodb";
import type { MetricCategoryId } from "./stateMetrics";
import type { CountryId } from "@/lib/constants/countries";
import type { WarGoal } from "@/lib/military/warGoals";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import type { NationalizationProvisionDetail } from "@/lib/nationalization/billTargetPreview";
import type { BillVoteSnapshot } from "./voteSnapshot";

/**
 * Pre-whip vote snapshot, keyed by bare characterId (never npp_*).
 * Written when a Player Whip overwrites a character's vote; cleared when
 * the character submits a new vote. Only set on docs that have been whipped.
 *
 * For bills/cabinet/government votes, values are "for"/"against"/"abstain"/"unvoted".
 * For leadership nominations, the value is the previous candidacy ObjectId (as a
 * string) or "unvoted". The apply functions enforce the right shape per target.
 */
export type WhippedFromVoteMap = Record<string, string>;

export type BillStatus =
  | "proposed"
  | "active"
  | "passed_origin"
  | "active_other"
  /**
   * Both chambers voting AT ONCE, each into its own tally; passes only if every chamber
   * clears the bar. Distinct from `active`/`active_other`, which are sequential.
   * `currentChamber` is a display default on these bills — never the authority for which
   * chamber a voter belongs to.
   */
  | "active_both"
  | "enrolled"
  | "signed"
  | "vetoed"
  | "veto_override"
  | "override_failed"
  | "failed"
  | "withdrawn"
  | "cabinet_review"
  | "override_shugiin"
  | "filibustered";

/**
 * Chamber a bill originates in or is currently being considered by.
 * US values: "house" | "senate" | "joint"
 * UK values: "commons" | "lords" | "joint"
 * Widened to string so new countries can use their chamber keys from CountryConfig
 * without modifying this union.
 */
export type BillChamber = "house" | "senate" | "joint" | (string & {});

export interface BillVoteTally {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  votingStartedAt?: Date;
  votingEndsAt?: Date;
  /**
   * Game-clock turn on which voting closes. Server-side resolution checks
   * `currentTurn >= votingEndsOnTurn` rather than comparing dates, so the
   * deadline doesn't drift with real-clock vs game-clock divergence.
   * Optional during the transition; new bills set both.
   */
  votingEndsOnTurn?: number;
}

export interface PolicyProvision {
  type?: "policy"; // optional for backwards compat with existing docs
  legislationTypeId: string;
  policyOptionId?: string;
  /** Frozen label for the proposed option so historical bill detail stays stable if seed text changes. */
  policyOptionNameSnapshot?: string;
  /** Frozen current-law option id at proposal time so history doesn't drift after enactment. */
  currentPolicyOptionIdSnapshot?: string;
  /** Frozen label for the current law shown beside the proposal on the bill detail page. */
  currentPolicyOptionNameSnapshot?: string;
  effectDirection: number;
  economic?: number;
  social?: number;
  /**
   * Tax-slider laws (ruling #16): the slider-chosen EFFECTIVE rate. Paired
   * with a synthetic policyOptionId "rate:<value>"; enactment passes it to
   * applyTaxRateChange. The provision's `economic` carries the §5.1b
   * delta-derived NPC force, stamped server-side at proposal time.
   */
  proposedRate?: number;
}

export interface TariffProvision {
  type: "tariff";
  scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
  targetSectorType?: CorporationType;
  targetOriginCountryId?: CountryId;
  targetCorporationId?: ObjectId;
  rate: number;
}

export interface SubsidyProvision {
  type: "subsidy";
  scopeType: "sector" | "economy_wide";
  /** Required when scopeType = "sector" */
  targetSectorType?: CorporationType;
  /** Optional — filters to sectors using this strategy. Only valid when scopeType = "sector". */
  targetStrategyId?: string;
  domesticOnly: boolean;
}

export interface EndSubsidyProvision {
  type: "end_subsidy";
  scopeType: "sector" | "economy_wide";
  targetSectorType?: CorporationType;
  targetStrategyId?: string;
}

export type InternationalActionType = "leave_organization" | "leave_free_trade_agreement";

export interface BillInternationalAction {
  type: InternationalActionType;
  targetCountryId: CountryId;
  organizationId: string;
  organizationName: string;
  organizationLegislationId?: ObjectId;
  organizationLegislationTitle?: string;
  partiesSnapshot?: CountryId[];
}

export interface NationalizeProvision {
  type: "nationalize";
  /** Whole-corp target (XOR the sector fields). */
  targetCorporationId?: ObjectId;
  /** @deprecated Legacy single-`corporateSector` target; superseded by `targetSectorType`. */
  targetSectorId?: ObjectId;
  /**
   * Industry-wide sector target: nationalize this sector type across the country
   * (XOR `targetCorporationId`). Pairs with `sectorCarveFraction` + `sectorScope`.
   */
  targetSectorType?: CorporationType;
  /** Fraction carved from each in-scope holder (0 < f ≤ 1); defaults to 1 (the whole industry). */
  sectorCarveFraction?: number;
  /** Which pools the sector taking sweeps; defaults to "all". */
  sectorScope?: "all" | "corporations" | "unowned" | "npp_unowned";
  /**
   * Affected-corp / treasury-cost breakdown frozen at enactment so the bill view
   * keeps showing the cost as it was when the bill passed, instead of recomputing
   * to zero once the assets are taken. Absent on proposed/pending bills (which
   * render a live preview). Written by `applyLegislationEffect`.
   */
  nationalizationSnapshot?: NationalizationProvisionDetail;
}

export interface PrivatizeProvision {
  type: "privatize";
  /** The National Corporation the asset is carved out of. */
  sourceNationalCorporationId: ObjectId;
  /** Sectors + carve fractions (≤30% each, anti-monopoly cap) to spin out. */
  selections: { sectorId: ObjectId; carveFraction: number }[];
  /** Name for the new spun-out corporation. */
  newCorpName: string;
  /** State-retained golden share (0–1). */
  goldenSharePercent: number;
  /** Distribution method; defaults to "ipo" when absent (back-compat). */
  method?: "ipo" | "auction";
  /** Auction reserve (country currency); optional. */
  reservePrice?: number;
}

export interface DesignateStrategicSectorProvision {
  type: "designate_strategic_sector";
  /** The sector type to designate strategic in the bill's country (arms the trigger). */
  sectorType: CorporationType;
}

/**
 * Durable trade embargo enacted by law. On enactment (reconcile) it creates a
 * legislation-origin TradeEmbargo with no expiry; `end_embargo` removes it.
 */
export interface DeclareWarProvision {
  type: "declare_war";
  /** The defender. The conflict is hosted here, so the map pin lands on it. */
  targetCountry: CountryId;
  warGoal: WarGoal;
}

/**
 * Entry into an EXISTING conflict at a bloc's call.
 *
 * Written only by `buildJoinConflictBill`, from a passed bloc resolution — the
 * ordinary bill route refuses it, exactly as it refuses `declare_war`, because
 * this path has no foreign-minister gate and would carry war entry at simple
 * majority.
 */
export interface JoinConflictProvision {
  type: "join_conflict";
  /** ConflictDoc._id — the theater key, not the public conflictId. */
  theaterId: string;
  side: "A" | "B";
  /** The bloc that called for it, for the bill text and the record. */
  organizationId: string;
  /** The resolution that spawned this bill. */
  resolutionId: string;
}

export interface EmbargoProvision {
  type: "embargo";
  /** Country whose trade is restricted. */
  targetCountry: CountryId;
  /** Restricted commodity, or "all". */
  commodity: CommodityType | "all";
  /** Direction from the enacting country's perspective. */
  direction: "export" | "import" | "both";
  /** "block" stops the flow; "cap" limits it to `cap` units. */
  mode: "block" | "cap";
  /** Flow cap in commodity units when mode = "cap". */
  cap?: number;
}

export interface EndEmbargoProvision {
  type: "end_embargo";
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
}

/**
 * International-organization membership action enacted by domestic law. Sub-typed:
 * - `join`: domestic ratification of an application (runs in parallel with the
 *   org's unanimous member vote; `membershipProposalId` links the two).
 * - `fund`: send `amountLocal` from the treasury to the org's pooled fund (FX to USD).
 * - `leave`: domestic ratification of withdrawal (consolidates the legacy
 *   `internationalAction` org-leave path).
 */
export interface InternationalOrganizationProvision {
  type: "international_organization";
  subType: "join" | "fund" | "leave";
  organizationId: string;
  organizationName: string;
  /** fund only: amount in the country's local currency to send to the org fund. */
  amountLocal?: number;
  /** join only: links to the org membership proposal that runs in parallel. */
  membershipProposalId?: ObjectId;
}

export interface EuroAdoptionProvision {
  type: "euro_adoption";
}

/**
 * v3 Phase 7b (labourSystemMode >= "full"): union laws. A single signed axis
 * rather than the design doc's literal "right-to-work / collective-bargaining
 * sliders" — deliberate simplification, validated as architecturally safe
 * (every other non-policy provision is a raw typed field with its own
 * bespoke editor, no enum constraint to satisfy). Negative = pro-business
 * (right-to-work), positive = pro-worker (collective-bargaining strength),
 * 0 = neutral/no law. Biases `unionizationDriftTarget()` and the strike
 * trigger thresholds nationally — see `src/lib/labour/laborCost.ts`
 * (`buildUnionLawBiasByCountry`) and `src/lib/labour/unionization.ts`.
 */
export interface UnionLawProvision {
  type: "union_law";
  /** -50 (strong right-to-work) .. +50 (strong collective-bargaining protection). */
  bias: number;
  /**
   * Union ban (player suggestion #93). When present, this provision is a BAN
   * action rather than a bias law: `"ban"` outlaws unions nationally
   * (`FederalBudget.unionsBanned = true`, player unions suspended, NPC
   * unionization decays to 0), `"repeal_ban"` lifts it. A ban provision
   * deliberately does NOT touch `unionLawBias` — repealing the ban restores
   * whatever bias regime was legislated before it (see
   * `applyUnionLawProvision` in `src/lib/labour/unionLaws.ts`).
   */
  banAction?: "ban" | "repeal_ban";
}

/**
 * Electoral law: who may vote, and how easily they can get on the rolls.
 *
 * Two axes because real electoral bills bundle them, and both were channels the
 * engine could read but nothing could write.
 *
 * `votingAge` sets `gameState.votingAgeEligible`, which the demographic phase
 * already consults when summing the voting-eligible population. Before this,
 * nothing in the codebase ever wrote it, so the franchise was whatever the year
 * implied and no law could move it — a 1953 world could not lower the voting age
 * even by constitutional amendment.
 *
 * `registrationAccess` is a signed axis on the same convention as
 * `UnionLawProvision.bias`: negative restricts (ID requirements, roll purges,
 * shorter windows), positive expands (automatic and same-day registration).
 * It biases the passive Reg drift/decay in the politics turn phase — see
 * `applyElectoralLawProvision`.
 *
 * Deliberately party-NEUTRAL. The law moves voters between registered and
 * unregistered; where newly-registered voters land follows the existing
 * sqrt(org) eligibility weighting, so a party benefits by having built
 * organization, not by having passed the bill. Otherwise "pass a law, win the
 * state" would dominate every other political action in the game.
 */
export interface ElectoralLawProvision {
  type: "electoral_law";
  /** Voting-age threshold. Clamped to 16-25 by `resolveVotingAgeEligible`. */
  votingAge?: number;
  /** -50 (heavily restricted registration) .. +50 (automatic registration). */
  registrationAccess?: number;
}

/**
 * Central bank independence, enacted by law. `grant` hands rate-setting to the
 * bank (and seats its committee, the way the 1997 Bank of England Act created
 * the MPC); `revoke` returns it to the head of government and the finance
 * seat. Writes `CentralBank.governmentControlled` — see
 * `src/lib/centralBank/governance.ts` for the historical defaults it
 * overrides. Refused for shared banks (ECB): one member's legislature cannot
 * rewrite a treaty institution.
 */
export interface CentralBankIndependenceProvision {
  type: "central_bank_independence";
  action: "grant" | "revoke";
}

export type BillProvision =
  | PolicyProvision
  | TariffProvision
  | SubsidyProvision
  | EndSubsidyProvision
  | NationalizeProvision
  | PrivatizeProvision
  | DesignateStrategicSectorProvision
  | EmbargoProvision
  | EndEmbargoProvision
  | InternationalOrganizationProvision
  | EuroAdoptionProvision
  | UnionLawProvision
  | ElectoralLawProvision
  | CentralBankIndependenceProvision
  | DeclareWarProvision
  | JoinConflictProvision;

/** Type guard — true for policy provisions (the historical default). */
export function isPolicyProvision(p: BillProvision): p is PolicyProvision {
  return (
    p.type !== "tariff" &&
    p.type !== "subsidy" &&
    p.type !== "end_subsidy" &&
    p.type !== "nationalize" &&
    p.type !== "privatize" &&
    p.type !== "designate_strategic_sector" &&
    p.type !== "embargo" &&
    p.type !== "end_embargo" &&
    p.type !== "international_organization" &&
    // Without this a declaration would be read as a policy provision and written
    // into a policy record — the same trap the union_law branch documents.
    p.type !== "declare_war" &&
    // Same trap as declare_war: unlisted here it reads as a policy provision, and
    // the two consumers write it into a policy record with an undefined
    // legislationTypeId and shift every voting legislator's own positions by it.
    p.type !== "join_conflict" &&
    p.type !== "euro_adoption" &&
    p.type !== "union_law" &&
    p.type !== "electoral_law" &&
    p.type !== "central_bank_independence"
  );
}

export interface Bill {
  _id: ObjectId;
  title: string;
  summary: string;
  fullText?: string;
  originChamber: BillChamber;
  currentChamber: BillChamber;
  sponsorId: ObjectId | null;
  sponsorName: string;
  sponsorParty?: string;
  /** True when the bill was created via admin override rather than by a seated sponsor. */
  adminProposed?: boolean;
  /** True when the bill was autonomously introduced by an NPP (SP2 nppBillSponsorship phase). */
  nppSponsored?: boolean;
  coSponsors?: { characterId: ObjectId; characterName: string }[];
  status: BillStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  whippedFromVote?: WhippedFromVoteMap;
  otherChamberVotesFor?: number;
  otherChamberVotesAgainst?: number;
  otherChamberVotesAbstain?: number;
  otherChamberVotes?: Record<string, "for" | "against" | "abstain">;
  otherChamberWhippedFromVote?: WhippedFromVoteMap;
  category?: string;
  /** Country the bill was proposed in. Required for trade bills; set for all new bills. */
  countryId?: CountryId;
  /** Optional pseudo-state for country-scoped national bills (e.g. "uk_national"). */
  stateId?: string;
  legislationTypeId?: string;
  effectDirection?: number;
  provisions?: BillProvision[];
  proposedAt: Date;
  /**
   * Turn the bill was proposed on. Set by surfaces that enforce a turn-based
   * cooldown (war declarations); absent on everything older, which is why every
   * reader must treat it as optional rather than deriving one from `proposedAt`.
   */
  proposedTurn?: number;
  votingStartedAt?: Date;
  votingEndsAt?: Date;
  /** Game-clock turn on which origin-chamber voting closes. Server resolution uses this. */
  votingEndsOnTurn?: number;
  passedOriginAt?: Date;
  sentToOtherChamberAt?: Date;
  otherChamberVotingStartedAt?: Date;
  otherChamberVotingEndsAt?: Date;
  /** Game-clock turn on which other-chamber voting closes. Server resolution uses this. */
  otherChamberVotingEndsOnTurn?: number;
  passedOtherChamberAt?: Date;
  sentToPresidentAt?: Date;
  presidentActionDeadline?: Date;
  /** Game-clock turn on which the president's action window closes. Server resolution uses this. */
  presidentActionDeadlineOnTurn?: number;
  presidentAction?: "signed" | "vetoed" | "unsigned_law" | "override";
  // Veto messaging — set when the President vetoes via the presidential-action flow.
  /** Public message attached to a presidential veto; 10-280 chars. */
  vetoMessage?: string;
  vetoedByCharacterId?: ObjectId;
  vetoedAtTurn?: number;
  enactedAt?: Date;
  failedAt?: Date;
  /**
   * Outcome of the national budget validation run at enactment time (audit S6).
   * The national gate is warn-only by design — sovereign deficit spending is a
   * deliberate lane — so this records/surfaces warnings rather than blocking.
   */
  budgetValidation?: {
    costAmount: number;
    newTotalSpending: number;
    newDebt?: number;
    warning?: "DEBT_CEILING_EXCEEDED" | "HIGH_DEBT";
    validatedAt: Date;
  };
  vetoOverrideVotes?: Record<string, "for" | "against">;
  vetoOverrideWhippedFromVote?: WhippedFromVoteMap;
  vetoOverrideVotesFor?: number;
  vetoOverrideVotesAgainst?: number;
  overrideVotingStartedAt?: Date;
  overrideVotingEndsAt?: Date;
  /** Game-clock turn on which the veto-override voting closes. Server resolution uses this. */
  overrideVotingEndsOnTurn?: number;
  overrideEnactedAt?: Date;
  overrideFailedAt?: Date;
  /** Frozen origin-chamber result, set when the bill leaves `active` (#0982). */
  voteSnapshot?: BillVoteSnapshot;
  /** Frozen second-chamber result, set when the bill leaves `active_other` (#0982). */
  otherChamberVoteSnapshot?: BillVoteSnapshot;
  /**
   * Frozen per-chamber veto-override display, set when the override resolves (#0982).
   * Structurally an `OverrideChamberDisplay` (inlined to avoid a db/types ↔ congress
   * import cycle).
   */
  overrideDisplaySnapshot?: {
    house: { for: number; against: number; seats: number };
    senate: { for: number; against: number; seats: number };
  };
  /** Tariff targeting scope — only for tariff bills (per-country, per-category, or universal) */
  tariffScope?: TariffScope;
  /**
   * Filibuster records: each senator who invoked the filibuster.
   * When non-empty, bill needs 3/5 of votes cast (for + against + abstain) to pass.
   * Each invocation costs the senator 25 APs + 5 NPI and extends the deadline 12 hours.
   */
  filibusterInvocations?: {
    characterId: string;
    characterName: string;
    invokedAt: Date;
  }[];
  /**
   * Bill status before the filibuster, so lifecycle can restore it after cloture.
   * "active" = bill is in its origin chamber; "active_other" = bill is in its second chamber.
   */
  preFilibusterStatus?: "active" | "active_other";
  /** National influence spent on provisions — refunded if bill passes */
  proposalNpiCost?: number;
  /** Action points spent to propose — refunded if bill passes */
  proposalActionCost?: number;
  internationalAction?: BillInternationalAction;
  /** Set on appropriation bills generated by a crisis aid pledge. Discriminates
   *  crisis-aid bills (category "foreign policy", no provisions) for the
   *  per-turn resolution sweep. */
  crisisAidId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Tariff targeting scope — only applicable to tariff legislation */
export interface TariffScope {
  type: "universal" | "per_country" | "per_category";
  /** Target country code when type is "per_country" */
  targetCountry?: string;
  /** Target product category when type is "per_category" (e.g. "agricultural", "electronics") */
  targetCategory?: string;
}

export type EffectScope = "national" | "state";

export interface LegislationEffectTarget {
  metricCategoryId: MetricCategoryId;
  metricId: string;
  scope: EffectScope;
}

export interface LegislationEffectTargetV2 {
  metricCategoryId: MetricCategoryId;
  metricId: string;
  strength: "weak" | "moderate" | "strong";
}

export interface DemographicTargeting {
  groupId: string; // e.g., "young_renters", "retirees"
  weight: "low" | "medium" | "high";
  stance: "support" | "oppose"; // Whether this group supports or opposes the policy
}

export type AllowedScope = "national" | "state" | "both";

export interface LegislationTypePosition {
  positionId: string;
  name: string;
  chamber:
    | "house"
    | "senate"
    | "commons"
    | "lords"
    | "shugiin"
    | "sangiin"
    | "bundestag"
    | "landtag" // DE Land-level legislatures (added 2026-05-26 with DE legislation overhaul)
    | "dail"
    | "seanad"
    | "npc"
    | "cppcc"
    | "peoplesCongress" // CN Provincial People's Congress (added 2026-05-27 with CN legislation overhaul)
    | "sovietOfTheUnion"
    | "sovietOfNationalities"
    | "republicSupremeSoviet" // SU Supreme Soviet chambers (added with the 1979 USSR)
    | "assembleeNationale"
    | "senat" // FR Parliament chambers (added with 1979 France)
    | "cameraDeputati"
    | "senato" // IT Parliament chambers (added with 1979 Italy)
    | "congresoDiputados"
    | "senado" // ES Cortes chambers (added with 1979 Spain)
    | "riksdag" // SE Riksdag (unicameral; added with 1979 Sweden)
    | "milletMeclisi"
    | "senato" // TR parliament chambers (added with 1979 Turkey)
    | "volkskammer" // DD Volkskammer (one-party; added with 1979 GDR)
    | "vouli" // GR Vouli (unicameral; added with 1979 Greece)
    | "nationalrat" // AT Nationalrat (unicameral; added with 1979 Austria)
    | "eduskunta" // FI Eduskunta (unicameral; added with 1979 Finland)
    | "nationalAssembly"
    | "sejm"
    | "grandNationalAssembly"
    | "federalAssembly"
    | "supremeSoviet"
    | "chamberOfThePeople" // Batch-A Eastern-bloc one-party lower chambers
    | "chamber"; // BR Chamber of Deputies (lower house; added with 1953 Brazil legislation)
}

/**
 * Direct per-turn metric effect from a policy option.
 * Each turn this policy is active, the metric changes by ratePerTurn (after scope multiplier).
 * Positive = increases metric, negative = decreases metric.
 */
export interface PolicyOptionMetricEffect {
  category: MetricCategoryId;
  metricId: string;
  /** Direct additive change to the metric per turn (e.g. -0.04 for -0.04%/turn uninsured rate) */
  ratePerTurn: number;
}

export interface LegislationPolicyOption {
  id: string;
  name: string;
  explanation?: string; // Real-world explanation of what this policy does
  stance: "left" | "center" | "right";
  effectDirection: -1 | 0 | 1;
  economic: number;
  social: number;
  rate?: number; // Tax rate percentage for tax legislation
  /** @deprecated Use archetypeApprovals instead */
  groupApprovals?: Record<string, number>; // Old demographic groups (college, urban, etc.)
  /** Per-archetype approval impacts (-100 to +100). Applied when voting on bills with this policy. */
  archetypeApprovals?: Record<string, number>;
  /** Direct per-turn metric effects when this option is the active policy */
  metricEffects?: PolicyOptionMetricEffect[];
  /**
   * Annual cost as a multiplier of GDP per capita.
   * E.g. 0.07 means 7% of GDP per capita per person → total annual cost = multiplier × GDP.
   * Scales naturally with the economy. Takes priority over annualCostPerCapita if both set.
   */
  gdpPerCapitaMultiplier?: number;
  /**
   * Annual cost per person per year in USD (or local currency unit).
   * Use gdpPerCapitaMultiplier instead when cost should scale with the economy.
   */
  annualCostPerCapita?: number;
  /**
   * Era cost model (Spec B, flag-on only). Fraction of GDP for gdpFraction-class
   * types: cost = gdpCostFraction × GDP. Never read when eraSystemEnabled is off.
   */
  gdpCostFraction?: number;
  /**
   * Era cost model (Spec B, flag-on only). Fraction of per-capita income for
   * perCapita-class types: cost = incomeCostFraction × incomeAnchor(country,year)
   * × population. Never read when eraSystemEnabled is off.
   */
  incomeCostFraction?: number;
  /** Minimum wage rate in dollars per hour (for minimum wage legislation) */
  minimumWageRate?: number;
  /**
   * Political-legislation v2 cost model (spec §5.1). Its PRESENCE is the
   * new-generation discriminator: routing checks costModelV2 FIRST and
   * delegates to the new cost engine; the legacy flat fraction fields above
   * are NEVER written on new-generation options (collision impossible by
   * construction). Level 0 carries an empty object (repealed: zero terms).
   */
  costModelV2?: {
    gdpCostFraction?: number;
    incomeCostFraction?: number;
    gdpRevenueFraction?: number;
  };
}

export interface EffectTargetWeighted {
  metricCategoryId: MetricCategoryId;
  metricId: string;
  weight: number; // -1.0 to 1.0, where magnitude is effect strength, sign can invert relationship
  adjustmentHalfLife?: number; // If set, effect decays over this many turns (economy adapts)
}

/**
 * Which stateDemographics group field a DemographicEffect moves.
 * - "population": group population share (legacy channel, always active).
 * - "economicLean" / "socialLean": group lean on the shared −5..+5 axis.
 * - "turnout": group turnout percentage (0-100).
 * Lean/turnout targets only apply when the `legislationDemographicEffectsV2Enabled`
 * game-state flag is on (fail-closed: absent flag = population channel only).
 */
export type DemographicEffectTarget = "population" | "economicLean" | "socialLean" | "turnout";

export interface DemographicEffect {
  groupId: string; // e.g., "union_trades", "small_business" (voter-group archetype ids)
  direction: number; // -1 to +1, rate of change per cycle
  /** Target field. Absent = "population" — legacy seed data behaves exactly as before. */
  target?: DemographicEffectTarget;
  /**
   * Strength multiplier on the per-turn shift. Absent = 1. Clamped at read time
   * to [0.25, 3] (see clampDemographicEffectMagnitude in demographicEffects.ts)
   * so seed typos cannot create runaway per-turn shifts.
   */
  magnitude?: number;
  /**
   * Designer marker for a LANDMARK effect: while `true` (for
   * `target: "economicLean" | "socialLean" | "turnout"` — still ignored for
   * `"population"`, the always-on legacy channel that has no durable/temporary
   * distinction to make), this entry's per-turn shift durably relocates the
   * group's base value via the shared durable-relocation mechanism
   * (`src/lib/demographics/durableRealignment.ts` — the SAME one era
   * checkpoints and the SCOTUS demographic-signal consumer use): it is not
   * capped by `LEAN_MAX_DEVIATION_FROM_BASELINE` / `TURNOUT_MAX_DEVIATION_FROM_BASELINE`,
   * it does NOT decay back toward baseline once the law lapses or is repealed,
   * and it is visible to the granular vote path — via
   * `demographicDefaults.layer1PositionOverrides` for the lean axes, or
   * `demographicDefaults.layer1TurnoutOverrides` for turnout (see that type's
   * doc comment in `src/lib/db/types/demographics.ts` for why turnout needed
   * its OWN overlay rather than reusing the lean one: it is a single bounded
   * 0-100 percentage, not a signed two-axis lean, and the legacy engine
   * ignores `groups[id].turnout` drift for any state with a Layer-1 census,
   * so the archetype-level write alone would have been invisible again — not
   * just the legacy one).
   *
   * Absent/false (the default — leave this unset for ordinary bills) keeps
   * the existing TEMPORARY behavior: a capped, decaying overlay on top of the
   * seeded baseline (`applyBandedShift` / `applyBaselineDecay` in
   * `demographicEffects.ts`) — correct for a tax tweak or a routine
   * regulation, which should NOT permanently redefine an electorate.
   *
   * Reserve `permanent: true` for legislation whose real-world consequence
   * was to durably change who the electorate IS — landmark, rarely-repealed
   * civil-rights/enfranchisement-scale acts (the Civil Rights Act's lean
   * consolidation; the Voting Rights Act's `target: "turnout"` enfranchisement
   * effect — voters who could not previously cast a ballot at all, not voters
   * who changed their politics — is the project's worked example for the
   * turnout channel specifically) — the same bar the era checkpoint's
   * `SOUTHERN_REALIGNMENT_CHECKPOINT` targets. It is still "gravity, not
   * rails": an opposing durable or temporary effect targeting the same
   * group+axis nets against it every turn it is active (the existing
   * per-target sum in `calculateDemographicShiftsByTarget`), so a durable
   * shift — including a turnout enfranchisement effect against a sustained
   * voter-suppression counter-effort — remains beatable by sustained
   * counter-legislation.
   */
  permanent?: boolean;
}

export interface LegislationType {
  _id: string;
  name: string;
  description: string;
  explanation?: string; // Detailed real-world explanation shown in propose modal
  policyDomain: string;
  subCategory: string;
  effectTarget?: LegislationEffectTarget;
  positions: LegislationTypePosition[];
  policyOptions?: LegislationPolicyOption[];
  nationalOnly?: boolean;

  // NEW: Scope control (replaces nationalOnly)
  allowedScope?: AllowedScope;

  // NEW: Multiple effect targets
  effectTargets?: LegislationEffectTargetV2[];

  // NEW: Weighted effect targets (multiple metrics with weights)
  effectTargetsWeighted?: EffectTargetWeighted[];

  // NEW: Demographic effects (population shifts over time)
  demographicEffects?: DemographicEffect[];

  // NEW: Demographic targeting
  demographicTargeting?: DemographicTargeting[];

  // NEW: Budget impact (not yet implemented)
  budgetCost?: number; // Percentage of budget (0-100)
  budgetCategory?: string; // Maps to spending category (e.g., "education", "healthcare")

  /**
   * Marks this legislation type as a central-to-regional grant program.
   * When true, enacted-law cost is routed into `federalBudget.spending.stateGrants`
   * (the "Westminster Funding"/"Local Allocation Tax"/etc. line on the national
   * budget) instead of `byCategory[budgetCategory]`. Keeps the federal-budget
   * grants total in sync with the per-region grant the country pipeline
   * (regionalBudget.ts) is actually paying out — single source of truth.
   */
  isGrant?: boolean;

  // Tax rate legislation support
  taxRateChange?: {
    scope: "federal" | "state";
    taxType:
      | "incomeTax"
      | "domesticCorporateTax"
      | "foreignCorporateTax"
      | "payrollTax"
      | "tariffs"
      | "salesTax"
      | "propertyTax"
      | "residentTax"
      | "fixedAssetTax"
      // DE-specific tax types (added 2026-05-26 with the DE legislation overhaul).
      // Other countries can opt in by referencing these IDs once their seed data lands.
      | "tradeTax" // DE Gewerbesteuer (Hebesatz, regional / Land-level)
      | "solidaritySurcharge" // DE Soli — surcharge on income tax owed
      // CN-specific tax types (added 2026-05-27 with the CN legislation overhaul).
      | "landValueAddedTax" // CN 土地增值税 — capital gains on real-estate transactions
      | "urbanMaintenanceTax" // CN 城市维护建设税 — surcharge on VAT receipts
      | "stampDuty" // CN 印花税 — documented-transaction levy
      // IE-specific tax types (added 2026-05-27 with the IE legislation overhaul PR1).
      | "universalSocialCharge" // IE USC — separate levy on gross wages above thresholds
      | "capitalGainsTax" // IE CGT — 33% statutory on realized gains; first peer to add this dial
      | "exciseDuty"; // IE Excise — alcohol/tobacco/fuel multiplier; 100 = baseline calibration
  };

  // Country scope: which country this legislation type applies to.
  // br/ng are reserved for future seeding (referenced by api/country and budgets.ts presets).
  // sco/wls are reserved for the latent secession countries (no legislation seeded until activation).
  countryScope?:
    | "us"
    | "uk"
    | "jp"
    | "de"
    | "ie"
    | "br"
    | "cn"
    | "ng"
    | "hu"
    | "pl"
    | "ro"
    | "yu"
    | "bg"
    | "ukr"
    | "blr"
    | "cs"
    | "bal"
    | "ru"
    | "fr"
    | "it"
    | "es"
    | "se"
    | "tr"
    | "gr"
    | "at"
    | "fi"
    | "dd"
    | "sco"
    | "wls";

  /**
   * Political-legislation v2 (spec §6): the typed law's metric targets,
   * consumed by the future dynamics engine. Written only on new-generation docs.
   */
  politicalMetricTargets?: Array<{ metricId: string; weight: number }>;

  /**
   * Tax-slider metadata (ruling #16): continuous-rate tax laws. Presence marks
   * a new-generation TAX law (they carry no policyOptions ladder). Proposals
   * carry a slider-chosen rate; enactment routes through applyTaxRateChange.
   */
  taxSlider?: {
    scope: "federal" | "state";
    taxType: string;
    minRate: number;
    maxRate: number;
    step: number;
    baselineRate: number;
    waypoints: Array<{ rate: number; label: string }>;
  };

  // NEW: Admin metadata
  source?: "seed" | "admin";
  isPermanent?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StatePolicyRecord {
  _id: ObjectId;
  scope: "national" | "state";
  stateId?: string;
  legislationTypeId: string;
  economic: number;
  social: number;
  updatedAt: Date;
}
