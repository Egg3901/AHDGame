import type { ObjectId } from "mongodb";
import type { CorporationType } from "../../constants/corporations";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { ExtractableResource } from "../../constants/commodities";

export interface Shareholder {
  /** Character holder — present for character-owned positions */
  characterId?: ObjectId;
  /** Imperial character holder — present for imperial-owned positions */
  imperialCharacterId?: ObjectId;
  /** Corporation holder — present for corp-owned positions */
  corporationId?: ObjectId;
  /** Index fund holder — present for passive fund-owned positions */
  fundId?: ObjectId;
  /** NPP holder — present for NPP CEO-owned positions */
  nppId?: ObjectId;
  shares: number;
  /** Weighted average purchase price per share. Null for pre-tracking positions. */
  avgCostPerShare?: number;
  /**
   * Founder supershare count (dual-class structure). Stamped at adoption with
   * the founder's then-current share count; never increased afterwards. The
   * votable amount is `min(superShares, shares)` — see lib/corporations/superShares.
   */
  superShares?: number;
}

export interface ShareOrder {
  _id: ObjectId;
  /** The corporation whose shares are being traded */
  corporationId: ObjectId;
  /**
   * The character who authorized this order (CEO when a corp is placing it).
   * Optional: absent for index-fund-owned orders, which set `placerFundId`
   * instead and have no authorizing character.
   */
  characterId?: ObjectId;
  /** Set when this order is placed by a corporation on its own behalf */
  placerCorporationId?: ObjectId;
  /**
   * Set when this order is owned by an index fund (no authorizing character).
   * Funds only ever place buy orders here. On fill the matcher credits the
   * fund's cap-table holdings (`fundId`) and refunds unused escrow to the
   * fund's `cashAnchor`.
   */
  placerFundId?: ObjectId;
  type: "buy" | "sell";
  shares: number;
  sharesRemaining: number;
  /**
   * True when the order reserved inventory by debiting the holder at creation
   * time. Legacy rows may omit this and still rely on reservation-only math.
   */
  sharesDebitedAtCreation?: boolean;
  pricePerShare: number;
  escrowAmount: number;
  /**
   * Anchor (₳) value escrowed from the fund's `cashAnchor` at placement.
   * Fund orders only. Decremented proportionally as the order fills; the
   * remaining balance is refunded to `cashAnchor` on cancel.
   */
  escrowAnchor?: number;
  status: "open" | "filled" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Public-service operating posture for a state-owned corporation (spec §11.4).
 * Corp-level is the National Corporation's default; a CorporateSector may
 * override per-sector. Absence ⇒ no posture (normal SOE operation).
 */
export interface SoeMandate {
  /** Trade margin for public value: lower margin, stronger metric contribution. */
  priceControlled?: boolean;
  /** Worker floor (already enforced by shed-exclusion); adds unemployment relief. */
  employmentGuaranteed?: boolean;
}

export interface CeoTenure {
  /** characterId, imperialCharacterId, or nppId of the CEO during this tenure */
  holderId: ObjectId;
  ceoType: "character" | "imperial" | "npp";
  startTurn: number;
  /** Absent while the holder is currently sitting; set when the tenure ends. */
  endTurn?: number;
}

/**
 * Command Economy v2 (P0) — per-SOE planned-economy overlay carried on a
 * state-owned enterprise corporation. One SOE is seeded per commanding-height
 * sector for a command country (RU, and CN in its command years). Reuses the
 * existing corp/sector plumbing; these are the extra fields the design names so
 * plan-fulfillment, soft budgets and (P1) directed credit have somewhere to live.
 */
export interface SoeState {
  /** The commanding-height sector this enterprise operates. */
  sector: CorporationType;
  /** Planned productive capacity in output units/turn (the ceiling on output). */
  capacity: number;
  /** Realized output this turn, in the same units as `planTarget`. */
  output: number;
  /** The plan quota the SOE is scored against (output / target = fulfillment). */
  planTarget: number;
  /** Efficiency index (1.0 = baseline); trends with output-vs-capacity. */
  efficiency: number;
  /** Cumulative soft-budget losses the state has absorbed (never dissolves). */
  cumulativeLosses: number;
  /** Appointed director (player or NPP); null when the seat is vacant. */
  directorId: ObjectId | null;
  /** Display name of the appointed director (denormalized for readouts). */
  directorName?: string | null;
  /**
   * Command Economy v2 (P2): the SOE director's operating levers. Persisted by
   * the director role panel and honored (bounded) by the command-economy turn
   * phase; absent → the NPP brain runs the enterprise on defaults.
   */
  directive?: {
    /**
     * Labour-vs-quality tradeoff, 0 (chase raw output quantity, efficiency
     * suffers) → 1 (chase efficiency/quality, output growth is slower). 0.5 =
     * balanced. Nudges the efficiency trend in the turn phase.
     */
    laborQuality?: number;
    /**
     * The director's requested investment for the coming turns, in plan-output
     * units. A demand signal surfaced to Gosbank; it also draws extra directed
     * credit toward this SOE under the automatic allocation. 0 = no request.
     */
    investmentRequest?: number;
    /** Last turn the director set these levers (audit). */
    setOnTurn?: number;
  };
}

export interface Corporation {
  _id: ObjectId;
  name: string;
  /**
   * Stock ticker symbol (1–5 uppercase letters). Globally unique among
   * corporations that have one. Required on corps founded after this
   * feature shipped; legacy corps may not have it.
   */
  tickerSymbol?: string;
  description?: string;
  type: CorporationType;
  /** Optional secondary sector focus — halves sector match bonus, doubles base sprawl threshold */
  secondaryType?: CorporationType | null;
  /** Turn when primary/secondary type was last switched (for penalty duration) */
  typeSwitchTurn?: number | null;
  /** Turn after which another type switch is allowed (cooldown) */
  typeSwitchCooldownUntilTurn?: number | null;
  /** Character who owns/runs this corporation */
  ceoId: ObjectId;
  /** Whether the CEO is a regular character, imperial character, or NPP. Defaults to "character". */
  ceoType?: "character" | "imperial" | "npp";
  /** User who owns this corporation (for quick auth lookups) */
  userId: ObjectId;
  /** Country where corporation is headquartered */
  countryId: CountryId;
  /** State code where corporation is headquartered */
  headquartersState: string;
  /** Cash on hand */
  liquidCapital: number;
  /**
   * Currency denomination of liquidCapital.
   * Set during forex migration to the corp's home currency.
   * Absent on pre-forex corps — treat as USD.
   */
  liquidCurrencyCode?: CurrencyCode;
  /**
   * How player/corp sells back into the public float settle (v0.2.x).
   * "instant" (default): float buys credit liquidCapital, sells debit it (gated).
   * "escrow": float buys credit shareEscrowBalance, sells debit it (may go negative).
   */
  shareBuybackMode?: "instant" | "escrow";
  /**
   * Market-making escrow balance, in liquidCurrencyCode units. May be negative
   * (a tracked buyback debt). Credited by float buys, debited by float sells in
   * escrow mode; funded by the CEO per turn; settled at dissolution/buyout.
   */
  shareEscrowBalance?: number;
  /** Local-currency amount moved from liquidCapital into escrow each turn (>= 0). */
  escrowFundingPerTurn?: number;
  /** Turn of the CEO's last escrow withdrawal (enforces the 24-turn cooldown). */
  lastEscrowWithdrawalTurn?: number;
  /** Marketing spend per turn ($) */
  marketingBudget: number;
  /** Accumulated marketing power */
  marketingStrength: number;
  /** Logistics spend per turn ($) */
  logisticsBudget: number;
  /** Accumulated logistics efficiency (reduces sprawl penalty) */
  logisticsStrength: number;
  /** R&D spend per turn ($) */
  rdBudget?: number;
  /** Accumulated R&D score (drives innovation probability and boost magnitude) */
  rdScore?: number;
  /** Daily CEO salary paid from liquid capital to CEO's cashOnHand (spread over 24 turns) */
  ceoSalary?: number;
  /** Brand color for charts and UI (hex, e.g. "#3b82f6") */
  brandColor?: string;
  /** URL to corporation logo (Vercel Blob or local) */
  logoUrl?: string;
  /** Wide banner image for the corporation page hero (CEO-set; Vercel Blob or /api/uploads/... ) */
  headerImageUrl?: string;
  /** Sequential ID for stable URLs (e.g., /corporation/1) */
  sequentialId?: number;
  /** Total shares issued */
  totalShares: number;
  /** Current share price in dollars (fundamental × sentiment × orderFlow) */
  sharePrice: number;
  /**
   * Fundamental share price last computed by the political turn (before
   * sentiment and order-flow multipliers). Used by the 15-minute price-
   * update cron to reapply multipliers without a full turn recompute.
   * Absent on legacy corps that have not yet completed a turn.
   */
  fundamentalSharePrice?: number;
  /**
   * Carried order-flow multiplier from the previous 15-minute interval.
   * 1.0 = neutral. Decays 20% toward 1.0 each interval.
   * Absent on legacy corps; treated as 1.0 by the cron.
   */
  orderFlowMultiplier?: number;
  /**
   * Accumulated buy-side dollar volume (in corp's local currency) for the
   * current 15-minute price-update window. Reset to 0 each cron run.
   */
  orderFlowWindowBuyValue?: number;
  /**
   * Accumulated sell-side dollar volume (in corp's local currency) for the
   * current 15-minute price-update window. Reset to 0 each cron run.
   */
  orderFlowWindowSellValue?: number;
  /**
   * Rolling log of annualised after-tax income (₳ anchor) from the last
   * FUNDAMENTAL_ROLLING_AVG_TURNS political turns. Index 0 = oldest, last = most recent.
   * Absent on corps that have not yet completed a turn.
   */
  earningsHistory?: number[];
  /** Array of shareholders */
  shareholders: Shareholder[];
  /** Shares available in the public float (universal market maker pool) */
  publicFloat?: number;
  /** Dividend payout rate (0–100%). Income × this % is distributed to shareholders each turn. */
  dividendRate?: number;
  /** When the dividend rate was last changed (enforces 24h cooldown) */
  lastDividendChange?: Date;
  /** When shares were last issued (public or self-issue; enforces 24h cooldown) */
  lastShareIssuance?: Date;
  /**
   * Turn an NPP-run corp last launched an autonomous sector attack (NPP-autonomy
   * V2.2 cooldown). Absent ⇒ never attacked. Spaces out aggression so an
   * autonomous corp telegraphs and cannot barrage a rival every turn.
   */
  lastAutoAttackTurn?: number;
  /**
   * Turn this corp was last hit by an autonomous NPP sector attack, from any
   * attacker. The counterpart to `lastAutoAttackTurn`: that one bounds how often
   * a given NPP corp attacks, this one bounds how often a given corp is attacked.
   * Without it nothing stopped several NPP corps striking the same player-owned
   * defender on the same turn, each with its own wire headline and notification.
   */
  lastAutoAttackedTurn?: number;
  /** Game turn when shares last underwent a CEO stock split / reverse split (cooldown) */
  lastShareStructureTurn?: number | null;
  /** Split escalation level — MS cost per split is 2^splitEscalation. Decays by 1 each turn. */
  splitEscalation?: number;
  /** Whether the CEO position is currently vacant (resigned or no CEO accepted yet) */
  ceoVacant?: boolean;
  /** Turn when the CEO position became vacant (for display in admin UI) */
  ceoVacantSinceTurn?: number;
  /**
   * Turn the corp first entered FINANCIAL distress (liquidCapital < 0 or a
   * defaulted bond), uncured. Stamped/cleared each turn by the corporation turn
   * phase. Drives the executive-nationalization grace window + at-risk badge.
   * Absent ⇒ not currently in financial distress.
   */
  financialDistressSinceTurn?: number;
  /**
   * Turn an NPP-run corp's effective cash (liquidCapital + positive share
   * escrow, anchor-converted) first went negative, uncured. Stamped/cleared
   * each turn by processNppInsolventCorpDissolution; when it stays set for
   * PERSISTENT_INSOLVENCY_GRACE_TURNS the corp is wound down (#3237). Only
   * ever set on ceoType "npp" corps — player corps use
   * financialDistressSinceTurn + the nationalization grace window instead.
   */
  nppInsolventSinceTurn?: number;
  /**
   * Append-only log of CEO tenures. The open tenure (endTurn absent) is the
   * sitting CEO. Used to block a former CEO from buying the corp's bonds within
   * EX_CEO_BOND_PURCHASE_BLOCK_TURNS turns of leaving. See the CEO ⊥ bondholder
   * invariant design.
   */
  ceoHistory?: CeoTenure[];
  /** Whether the corporation is suspended from turn processing */
  suspended?: boolean;
  /** Turn after which suspension ends (informational — admin must manually resume) */
  suspendedUntilTurn?: number;
  /** Character being offered the CEO position (pending acceptance) */
  pendingCeoCharacterId?: ObjectId;
  /**
   * Set while an NPP caretaker runs this player-owned corp (NPP-autonomy V2.1).
   * The autonomy brain operates the corp through `ceoType:"npp"` + `ceoId` (the
   * NPP), but `userId` deliberately stays the appointing owner so they keep CEO
   * authorization (`requireCeo`) and private-data access — that retained control
   * is precisely what makes this a *caretaker* (player-appointed, player-revoked)
   * rather than a full handover to an autonomous NPP corp. Stores the displaced
   * human CEO so dismissal restores them. Absent ⇒ the corp is not caretaker-run.
   */
  caretakerCeo?: {
    /**
     * The human CEO restored as `ceoId` on dismissal. Present for a player-
     * appointed caretaker (the sitting CEO who handed off). Absent when the
     * caretaker was auto-installed onto a corp whose human CEO had already
     * departed with no character left to restore (e.g. retirement) — dismissal
     * then returns the corp to `ceoVacant` rather than seating a ghost.
     */
    underlyingCharacterId?: ObjectId;
    /** That CEO's owning user; restored to `userId` on dismissal (already equal while active). */
    underlyingUserId: ObjectId;
    /** Turn the caretaker was installed. */
    appointedTurn: number;
  };
  /** Country owner for state-owned / nationalized corporations */
  countryOwnerId?: CountryId;
  /** Hide the corporation from stock-exchange style equity listings */
  hiddenFromExchange?: boolean;
  /** Route operating profits into a named budget revenue line */
  budgetRevenueKey?: "healthcareIncome" | "other";
  /** Multiplier applied when converting corporation profit into budget revenue */
  budgetRevenueMultiplier?: number;
  /** Applies the nationalized corporation margin penalty */
  isNationalized?: boolean;
  /**
   * Ownership lifecycle state (nationalization subsystem). Absence ⇒ "private"
   * for back-compat. `isStateOwned()` is the canonical reader — do not branch on
   * this field directly. Set "stateOwned" only on the per-country National
   * Corporation.
   */
  ownershipState?: "private" | "stateOwned";
  /** Turn this corp was last nationalized. Powers the re-nationalization cooldown (P4+). */
  nationalizedAtTurn?: number;
  /**
   * Turn this corp was spun out of a National Corporation (privatization). Powers
   * the re-nationalization cooldown (spec §13.4). Distinct from `lastPrivatizationTurn`
   * (the CEO take-private buyout anchor) — do not conflate.
   */
  privatizedAtTurn?: number;
  /**
   * State-retained golden-share fraction (0–1) for a spun-out corp, held as a
   * reserved block by the country's primary National Corporation (spec §13.4).
   */
  goldenSharePercent?: number;
  /**
   * True for the country's primary National Corporation (the seeded/original
   * one). The primary holds every sector type not claimed by a split-off and is
   * the sovereign-bond issuer. Exactly one per country (spec §24.1).
   */
  isPrimaryNationalCorporation?: boolean;
  /**
   * Sector types a National Corporation exclusively owns and routes future
   * nationalizations of. Empty/absent on the primary means "the remainder" (all
   * types not claimed by a split-off). A secondary split-off carries exactly one
   * entry. (spec §24.1)
   */
  assignedSectorTypes?: CorporationType[];
  /** CEO-set share of per-turn operating profit retained in the corp (0–75). Absent ⇒ 0. (spec P6g §5.1) */
  profitRetentionPercent?: number;
  /** Finance-minister-set per-turn cap on the CEO's treasury draw (local). Absent ⇒ default; 0 ⇒ frozen. (P6g §5.2) */
  treasuryDrawCap?: number;
  /** Cumulative treasury drawn in `treasuryDrawTurn` (enforces the per-turn cap). (P6g §5.2) */
  treasuryDrawnThisTurn?: number;
  /** Turn that `treasuryDrawnThisTurn` applies to. (P6g §5.2) */
  treasuryDrawTurn?: number;
  /**
   * CEO-set per-turn modernization (R&D) budget in the corp's local currency.
   * Each turn the SOE phase debits this from `liquidCapital` (only when
   * affordable) and adds it to `rdScore`. Absent / 0 ⇒ no recurring R&D spend.
   */
  rdBudgetPerTurn?: number;
  /**
   * Command Economy v2 (P0): per-SOE planned-economy state. Present only on
   * state-owned enterprises seeded for a command country while
   * `commandEconomyEnabled` is on (one SOE per commanding-height sector);
   * absent on every market corporation, so market worlds stay byte-identical.
   * The corp/sector plumbing (commodity supply, budgets, shadow ledger) is
   * unchanged — this is an overlay the command-economy phase reads/writes.
   * See @/lib/economy/soe and the design doc
   * `command-economy-v2-playable-planned-economies`.
   */
  soe?: SoeState;
  /** SOE operating posture default; sectors may override (spec §11.4). */
  soeMandate?: SoeMandate;
  /**
   * While currentTurn is below this value, corporate credit is floored after a bond default.
   * Set to turn + BOND_DEFAULT_CREDIT_PENALTY_TURNS when any bond defaults; cleared after expiry.
   */
  bondDefaultCreditPenaltyUntilTurn?: number | null;
  /**
   * Lifetime count of successful bond-default refinances. Capped by MAX_BOND_DEFAULT_REFINANCES
   * to prevent chronic default → refi cycles from extracting cash via principal roll-overs.
   */
  bondDefaultRefinanceCount?: number;
  /** Turn when the corporation was last renamed (enforces 48-turn cooldown). */
  lastRenameTurn?: number | null;
  /**
   * Cumulative proceeds from share issuances (public float, self-issue, IPO).
   * Stored in the corp's home currency. Subtracted from liquidCapital in the
   * share-price formula's tangible-book component so issuance dilutes price.
   */
  shareIssuanceProceeds?: number;
  /** When the CEO last sent a shareholder address (12-hour cooldown). */
  lastShareholderAddressAt?: Date;
  /** Guards the CEO quick-dissolve route against duplicate payout submits. */
  dissolutionInProgressAt?: Date;
  /** Guards bond-settlement routes so one issuer cannot be settled twice in parallel. */
  bondSettlementInProgressAt?: Date;
  /** Denormalized credit metrics (updated each corporation turn). */
  creditCompositeSnapshot?: number;
  creditRatingSnapshot?: string;
  creditSnapshotTurn?: number;
  /**
   * Brand loyalty (Package A, `brandLoyaltyEnabled`): 0–100 reputation earned by
   * consistent pricing + delivery, protecting a relative slice of demand in
   * clearing. Player-facing as a hidden 5-label scale (see loyaltyLabel);
   * the raw number is admin-only. Absent ⇒ 0. See src/lib/market/brandLoyalty.ts.
   */
  brandLoyalty?: number;
  /**
   * EMA of the corp's own revenue-weighted posture — its established price
   * identity. Gouging/erratic penalties are judged against THIS, not the market.
   * Absent ⇒ seeded to the current posture on first processing.
   */
  brandPostureNorm?: number;
  /**
   * Denormalized revenue-weighted mean of per-sector output quality (0–100,
   * `brandLoyaltyEnabled` + quality pillars). Display + charts; also snapshotted
   * into corporationHistory. Absent until quality pillars (Package B) are live.
   */
  averageQuality?: number;
  creditRatingComponents?: {
    debtToEquity: number;
    interestCoverage: number;
    profitability: number;
    liquidity: number;
  };
  /**
   * IMF restructuring (admin bailout): dilution + amortizing facility; blocks refinance,
   * dividends, and CEO pay while active.
   */
  imfBailoutActive?: boolean;
  /** Canonical IMF institution corporation that receives equity and facility remittances. */
  imfBailoutImfCorporationId?: ObjectId;
  /** Target IMF fully diluted ownership % set at bailout (0–100). */
  imfBailoutTargetOwnershipPercent?: number;
  imfBailoutStartedAt?: Date;
  /** Remaining IMF facility principal (₳ anchor). Vanilla issuer bonds are removed on bailout. */
  imfFacilityPrincipalOutstanding?: number;
  /** Annual interest rate on outstanding facility principal (%). */
  imfFacilityAnnualRate?: number;
  /** Turns left on the amortization schedule (decrements as principal pays down). */
  imfFacilityAmortizationTurnsRemaining?: number;
  /** Share of per-turn operating income (capped, typically ≤0.45) for IMF facility payment. */
  imfFacilityIncomeCaptureFraction?: number;
  /**
   * When true, this corporation is the global IMF institution (USD balance sheet, hidden from exchange).
   */
  imfInstitution?: boolean;
  /**
   * When true, financial fields (treasury, income, dividends, share price, etc.) are
   * redacted for non-CEO viewers. Set at founding (private path or post-privatization)
   * and cleared on IPO. Absent on legacy corps — treat as false (public).
   */
  isPrivate?: boolean;
  /**
   * Game turn when the corporation was founded. Used as the anchor for the
   * late-IPO cooldown so a freshly-founded private corp can't immediately go
   * public. Absent on legacy corps; in practice they were founded long enough
   * ago that the cooldown is moot.
   */
  foundedAtTurn?: number;
  /** Turn the corp last transitioned private→public via IPO (founding IPO sets this to 0). */
  lastIpoTurn?: number;
  /** Turn the corp last transitioned public→private via buyout vote pass. */
  lastPrivatizationTurn?: number;
  /** Turn after which another privatization vote may be opened (set when a vote fails or expires). */
  privatizationCooldownUntilTurn?: number;
  /**
   * Dual-class supershare vote multiplier (S#33). Present once the corp adopts
   * supershares (at IPO or by `adopt_supershares` vote); each of the founder's
   * supershares counts as this many votes in shareholder votes. Absent =
   * single-class, one share one vote. See lib/corporations/superShares.
   */
  superShareMultiplier?: number;
  /** Turn the dual-class supershare structure was adopted. */
  superSharesAdoptedAtTurn?: number;
  /**
   * Sector tech-tree node ids the CEO has unlocked (see lib/constants/techTree).
   * Effects are derived from this set each turn — never persisted as mutated
   * margins. Includes free auto-granted corporate nodes for late-era corps.
   * Absent ⇒ none.
   */
  unlockedTechNodeIds?: string[];
  /**
   * Committed lane per decade tier (v2): "generic" (Corporate) or "sector"
   * (Specialist). Set when the first node of a decade is unlocked; cleared by
   * Abandon. Locks the other lane for that decade. Keyed by decade id ("2019").
   */
  techDecadeLane?: Record<string, "generic" | "sector">;
  /**
   * Turn each decade tier's lane was first committed, keyed by decade id.
   * Audit / future cooldown anchor; absent on corps that have unlocked nothing.
   */
  techDecadeChosenTurn?: Record<string, number>;
  /** Legal structure of this corporation (e.g. "us_c_corp"). Absent = country default. */
  legalStructure?: import("../../constants/legalStructures").LegalStructureId;
  /** Turn after which the legal structure may be changed again (instant-change cooldown for private corps). */
  legalStructureChangeCooldownUntilTurn?: number;
  /**
   * Subsidiary corporations (feature-gated). Set when the controlling parent
   * formalizes this holding into a managed subsidiary. Presence of this marker
   * (NOT any stored parent id — the relationship is always derived from voting
   * control) enables subsidiary management UI/actions. Cleared automatically by
   * the turn processor if no corporation controls >50% voting power anymore.
   */
  subsidiaryFormalizedAtTurn?: number;
  /** Spin-off provenance (informational: UI labels, history). Phase 2. */
  isSpinOff?: boolean;
  spunOffFromCorpId?: ObjectId;
  /**
   * Parent-set dividend floor (percent 0–100), folded into the existing
   * effective-dividend-rate `max(...)` rule. Only honored while
   * `parentDividendFloorSetByCorpId` still controls >50% voting of this corp;
   * otherwise ignored and cleared by the turn processor. Capped at
   * MAX_DIVIDEND_RATE.
   */
  parentDividendFloorPct?: number;
  parentDividendFloorSetByCorpId?: ObjectId;
  /** Cooldown anchor for spin-offs initiated BY this corp (Phase 2). */
  lastSpinOffTurn?: number;
  /** Per-subsidiary cooldown anchor for parent capital injections into this corp. */
  lastCapitalInjectionTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A capacity build order sitting in a sector's `buildQueue` (plants tier, P3a).
 *
 * Capacity is bought, then BUILT: the cash leaves the corp when the order is
 * placed, the capacity arrives `CAPACITY_BUILD_TURNS(sectorType)` turns later.
 * Between those two moments the money is construction-in-progress — spent, not
 * yet productive — which is the whole reason the queue is a persisted object
 * rather than an immediate `capitalStock` increment.
 */
export interface SectorBuildOrder {
  /** Capacity units (output units/day) this order delivers when it lands. */
  unitsOrdered: number;
  /**
   * ₳ (anchor) actually charged for this order, for CIP accounting and for the
   * cancellation refund. 0 for the free growth-ramp flip-compensation order.
   */
  costPaidAnchor: number;
  /** Turn the order was placed. */
  startTurn: number;
  /** First turn on which the capacity converts into `capitalStock`. */
  onlineTurn: number;
  /**
   * When true, the order delivers capacity LINEARLY across
   * `[startTurn, onlineTurn]` — a slice per turn — instead of the whole
   * `unitsOrdered` landing at once on `onlineTurn`. Absent on legacy orders and
   * on the flip-compensation credit, which keep all-at-once landing. See
   * `src/lib/corporations/buildDelivery.ts`.
   */
  smooth?: boolean;
}

export interface CorporateSector {
  _id: ObjectId;
  corporationId: ObjectId;
  /** Country where this sector operates */
  countryId: CountryId;
  stateId: string;
  sectorType: CorporationType;
  /** Optional CEO-defined display name for this specific sector instance */
  displayName?: string;
  /** Player-set target growth rate (% per game year — 48 turns, e.g. 1.5) */
  targetGrowthRate: number;
  /** Actual growth rate applied per turn (trends toward targetGrowthRate) */
  currentGrowthRate: number;
  /** Legacy growthRate field - deprecated, use targetGrowthRate/currentGrowthRate */
  growthRate?: number;
  /** Current daily cost of growth (scales with rate and revenue) */
  currentGrowthCost: number;
  /** Current revenue this sector generates per turn */
  revenue: number;
  /**
   * Realized revenue this sector actually earned last turn (#3001/#3002): the
   * nameplate `revenue` after every realization leg the turn processor applies
   * (production policy, capacity haircut, market clearing/soldFraction,
   * throughput, capital utilization, strikes, total-embargo suspension). Same
   * DAILY basis and home currency as `revenue`. Written every turn so the corp
   * Financials query reads it directly instead of reverse-engineering a single
   * blended corp-wide ratio and smearing it uniformly across sectors. Absent
   * only on sectors not yet reprocessed since this field shipped (fallback
   * behavior in corporationDetail). Never read back into the economy.
   */
  realizedRevenue?: number;
  /**
   * Units telemetry: total output this sector produced this turn, in output
   * units on the same DAILY basis as `revenue` but currency-free. Equals the
   * nameplate implied output units (Σ revenue × rate / basePrice) times the
   * production-side realization legs (production policy, nationalization
   * transition, capacity haircut, throughput, capital utilization, strike).
   * Absent on sectors not reprocessed since this field shipped.
   * Display/telemetry only — never read back into the economy.
   */
  producedUnits?: number;
  /**
   * Units telemetry: the share of `producedUnits` that cleared this turn —
   * `producedUnits × soldFraction` when market clearing ran, else equal to
   * `producedUnits`. Same DAILY, currency-free basis.
   * Display/telemetry only — never read back into the economy.
   */
  soldUnits?: number;
  /**
   * Share of this plant's output (0..1) shipped to a government arsenal under a
   * defence procurement contract last delivery, and the turn that happened.
   *
   * Output sold to the state does not also reach the commodity market. Without this
   * a contracted plant supplied its full output to the world AND was paid again per
   * lot — one plant's production earning twice, scaling with however many contracts
   * a friendly minister chose to write.
   *
   * Read back into the economy in exactly two places, both gated on the turn being
   * fresh so a completed or cancelled contract stops biting with no cleanup pass:
   * the `hourlyRevenue` realization leg in `sectorTurn` (the cash) and the supply
   * contribution in `computeRawSupplyDemand` (the goods).
   */
  militaryDivertedFraction?: number;
  militaryDivertedTurn?: number;
  /**
   * True when this (foreign-national) sector is suspended by a TOTAL embargo the
   * operating country has against the corp's nation: revenue is frozen and it
   * earns/spends nothing this turn. Reversible — clears when the embargo lifts.
   */
  embargoSuspended?: boolean;
  /**
   * Under the trade-exposure embargo model, the export-exposed fraction (0-1) of
   * this sector's output that the embargo stripped this turn. 0 under the legacy
   * total-mothball path or when unembargoed. Drives the "N% trade-restricted" UI.
   */
  embargoExportExposure?: number;
  /** Profit margin percentage (0-100). Maintenance = revenue × (1 - profitMargin/100) */
  profitMargin: number;
  /** Number of workers in this sector */
  workers: number;
  /**
   * Labour system (labourSystemMode ≥ "wages"): wage-level multiplier on the
   * sector's baseline labor cost. 1.0 = baseline, which is profit-invariant
   * (the labor slice is carved out of existing maintenance, not added on top).
   * Player-editable from Phase 2; absent/undefined is treated as 1.0.
   * See docs/plans/2026-06-30-labour-system.md.
   */
  wageLevel?: number;
  /**
   * The margin this sector actually operated at last turn — seeded
   * `profitMargin` plus every modifier applied that turn (commodity markets,
   * SOE mandate, tech effects, strike penalty, nationalisation penalty).
   * Display/analytics only; never read back into the economy.
   *
   * `profitMargin` itself is a seeded constant no turn phase writes to, so
   * without this the modifiers were computed and immediately discarded and the
   * stored margin showed min == max for an entire run.
   */
  effectiveProfitMargin?: number;
  /**
   * Labour system telemetry: most recent per-turn labor cost written when
   * labourSystemMode ≥ "wages" (home currency, daily basis like `revenue`).
   * Display/analytics only — not read back into the economy. Absent when the
   * labour system is off.
   */
  laborCost?: number;
  /**
   * Labour system telemetry: implied wage per worker (home currency, daily
   * basis), written alongside `laborCost`. Surfaced in the UI against the
   * state's median income. Display/analytics only. Absent when off.
   */
  wagePerWorker?: number;
  /**
   * v3 Phase 5/6 (labourSystemMode ≥ "unions"): per-sector NPC unionization
   * pressure, 0–100. Drifts toward a condition-driven target each turn (see
   * `src/lib/labour/unionization.ts`). Feeds a standing labor-cost surcharge
   * (`unionPremium()`) and the strike trigger threshold (`src/lib/labour/strikes.ts`).
   * Absent/undefined is treated as 0 (no ambient unionization before the
   * system has run).
   */
  unionization?: number;
  /**
   * v3 Phase 6 (labourSystemMode ≥ "unions"): a slow-moving index of what
   * workers expect to be paid in real terms, trended toward the sector's
   * current real-wage index (`realWageIndex()` in unionization.ts) at most
   * `WORKER_EXPECTATION_TREND_STEP` per turn. The strike trigger fires when
   * this lags the real wage by more than a threshold. Absent/undefined ⇒
   * initialized at the current real-wage index on first read (no first-turn
   * gap). See `src/lib/labour/strikes.ts`.
   */
  workerExpectationIndex?: number;
  /**
   * v3 Phase 6: turn a strike began, or null when no strike is active. While
   * non-null, revenue is throttled and margin takes a penalty (see
   * `STRIKE_REVENUE_THROTTLE`/`STRIKE_MARGIN_PENALTY_PP` in strikes.ts).
   * Cleared (set to null) on resolution (concession or wait-it-out).
   */
  strikeStartedAtTurn?: number | null;
  /**
   * v3 Phase 6: turn after which this sector may strike again, or null when
   * not in cooldown. Set on every strike resolution (concession or
   * wait-it-out) — the cooldown is unconditional, not just a waitout
   * consequence (see `STRIKE_COOLDOWN_TURNS` in strikes.ts).
   */
  strikeCooldownUntilTurn?: number | null;
  /**
   * v3 Phase 7 (labourSystemMode ≥ "full"): turn after which this sector's
   * CEO may attempt another union-busting action, or null when not in
   * cooldown. Set on every busting attempt (success or backfire) — see
   * `src/lib/labour/unionBusting.ts`.
   */
  bustingCooldownUntilTurn?: number | null;
  /** Active operating strategy ID (defaults to "standard") */
  strategyId?: string;
  /**
   * Price-realization multiplier applied to this sector's realized revenue
   * last turn (marketSystemMode >= "realization", audit t806 Fix 1). Weighted
   * lagged market-price/base ratio of the sector's output mix, clamped
   * [0.7, 1.5]. Telemetry/display only — never read back into the economy.
   */
  priceRealization?: number;
  /**
   * Throughput coupling (marketSystemMode >= "clearing", audit t806 D1): the
   * ramped input-availability multiplier applied to realized revenue last
   * turn, the scarcest (binding) input, and the ramp anchor turn. Telemetry +
   * ramp state; the factor itself is recomputed each turn.
   */
  throughputFactor?: number;
  throughputBindingInput?: string | null;
  throughputStartTurn?: number | null;
  /**
   * Posted-price market clearing (marketSystemMode >= "clearing", audit t806
   * Fix 2). `pricingPosture` is the CEO's posted price relative to market
   * (−0.2 … 0.2); null/absent = auto-position (NPP/unowned heuristic).
   * `clearingFactor` (ramped, applied), `soldFraction` and
   * `effectivePosture` are last turn's telemetry; `clearingStartTurn`
   * anchors the fade-in ramp.
   */
  pricingPosture?: number | null;
  clearingFactor?: number;
  soldFraction?: number;
  /**
   * Per-output sold fraction behind the weighted `soldFraction` headline. A
   * multi-output sector can clear one commodity fully and another barely, and
   * the blended number reads as though the short commodity is the one not
   * selling. Only written when clearing ran.
   */
  soldByCommodity?: Partial<Record<string, number>>;
  effectivePosture?: number;
  clearingStartTurn?: number | null;
  /**
   * Capital tier (marketSystemMode >= "capital", audit t806 Fix 4 v1):
   * productive capacity in output units/turn. Seeded with 10% headroom at
   * first exposure (mode flip is a no-op); grows with the growth slider,
   * decays by depreciation each turn. `capitalUtilization` is last turn's
   * output-gating factor (telemetry).
   */
  capitalStock?: number;
  capitalUtilization?: number;
  /**
   * Plants tier (marketSystemMode >= "plants"): anchors the launch-safety
   * governor's fade-in from the sector's first plants turn, exactly like
   * `clearingStartTurn` does for the clearing leg. Stamped once, on the turn
   * the sector first runs under plants (the flip turn), and never moved after.
   */
  plantsStartTurn?: number | null;
  /**
   * Plants tier (P3a): outstanding capacity build orders, oldest first. Each
   * order is capacity that has been PAID FOR but is not yet productive; it
   * converts into `capitalStock` on the turn `onlineTurn` is reached, and the
   * order is then removed from the queue.
   *
   * Absent/empty on every sector that has never ordered a build, and never
   * written outside plants mode.
   */
  buildQueue?: SectorBuildOrder[];
  /**
   * Plants tier (P3a): construction in progress, in ₳ (anchor) — the sum of
   * `costPaidAnchor` across the outstanding `buildQueue` orders (D10).
   *
   * Denormalized so balance-sheet / valuation readers do not have to sum the
   * queue on every read; kept in sync by the turn processor whenever orders
   * land, and by the build/cancel commands when orders are pushed or removed.
   */
  constructionInProgressAnchor?: number;
  /**
   * Plants tier (P5): the PAID BASIS of the capacity in `capitalStock`, in ₳
   * (anchor) — cumulative cash actually spent to acquire the units the sector
   * still owns, after depreciation.
   *
   * This exists because exits settle at BOOK, and book used to be
   * `capitalStock × capacityPricePerUnit` — the RAW list price. Builds are
   * charged that list price times a stack of discounts (founding 0.1×, CEO
   * acumen down to 0.5×, tech 0.7×, a cheap host state 0.6×), so a founding
   * build cost 3M ₳ and booked at 30M ₳: restructuring at the 0.85 salvage
   * fraction CREDITED 8.5× the cash spent. That is money creation, not a
   * transfer.
   *
   * Maintenance rules (the turn processor owns the first three):
   *   - a build order that lands moves its `costPaidAnchor` out of CIP and INTO
   *     this field;
   *   - depreciation scales this field by exactly the factor it scales
   *     `capitalStock` by, so the PER-UNIT basis is preserved;
   *   - the flip turn seeds it at `capacity × capacityPricePerUnit × 1.0` for
   *     capacity that predates the plants tier (that capacity was bought
   *     through the legacy growth stack at that price).
   * Transfers (merge/carve/attack/shed/haircut) move it PRO-RATA with the
   * capacity. Free capacity (R&D breakthroughs, world grants) carries NO basis:
   * it dilutes the per-unit book rather than adding to it.
   *
   * ABSENT ⇒ the readers fall back to `capitalStock × capacityPricePerUnit`,
   * i.e. exactly the pre-P5 behaviour, so no legacy or seeded row crashes or
   * silently books at zero. See `sectorCapacityBookAnchor`.
   */
  capacityBookAnchor?: number;
  /**
   * Plants tier (P3.5): the sector's OTHER operating cost, in ₳ (anchor) per
   * output unit per TURN — overheads, distribution, insurance, rent: everything
   * the physical cost model does not name explicitly.
   *
   * This is not a designed constant. It is SOLVED once, on the sector's first
   * producing physical-P&L turn, so that the physical cost lines reproduce the
   * old margin formula's cost EXACTLY at that turn's state, and then HELD. That
   * is what makes the switch to physical costs a no-op on flip day while
   * letting input prices, wages and throughput move the bill afterwards.
   *
   * Absent on every sector that has not yet run a producing plants turn; never
   * written outside plants mode. See `src/lib/corporations/physicalPnl.ts`.
   */
  otherOpexPerUnitAnchor?: number;
  /**
   * Plants tier (P3.5): `1 − margin/100` of the non-physical margin stack at
   * the turn `otherOpexPerUnitAnchor` was solved. The denominator of the drift
   * factor that lets subsidies, tariffs, macro drag and tech margin bonuses keep
   * moving the held residual — 1 at calibration by construction.
   */
  otherOpexAnchorMarginBasis?: number;
  /**
   * Plants tier: `1 − margin/100` at the sector's FIRST plants turn, held
   * thereafter as the price basis of the idle-capacity upkeep charge.
   *
   * Idle upkeep is a fixed site/skeleton-crew cost (see
   * `IDLE_UPKEEP_FRACTION`), so it must not float with the live margin. Pricing
   * it off `1 − margin_now` made the charge GROW as the margin fell, hardest on
   * the sectors already closest to insolvency. Anchoring it is the same
   * solve-once-then-hold discipline `otherOpexPerUnitAnchor` uses.
   *
   * Absent on legacy rows and outside plants mode; readers fall back to the
   * live basis, i.e. the pre-fix behaviour. See `idleUpkeepUnitPrice`.
   */
  plantsUpkeepMarginBasisAnchor?: number;
  /**
   * Plants tier (P3a, D12): the sector is MOTHBALLED. Its capacity produces
   * nothing and offers nothing to the market, and it pays only
   * MOTHBALL_UPKEEP_FRACTION of the maintenance it would carry while running.
   * Reactivation is free and has no cooldown in v1.
   */
  mothballed?: boolean;
  /**
   * ROLLBACK SAFETY: capital-mode restore point. Remove after the rollback
   * drill passes. (Plants tier, D13.)
   *
   * Under plants the nameplate `revenue` stops compounding and is RESTATED each
   * turn from what the sector's plants produce and sell. That restatement is
   * destructive: once plants has run for a few turns the pre-plants revenue
   * series no longer exists anywhere, so flipping `marketSystemMode` back down
   * to "capital" would resume compounding from a plants-derived number and
   * silently rebase every corp's income.
   *
   * This field is the shadow of the series we stopped writing: each turn under
   * plants it stores what the pre-plants compounding chain WOULD have written
   * for `revenue` (`preFlipNameplateRevenue` — the exact figure capital mode
   * would have produced, which is also what the launch-safety governor clamps
   * against). Same DAILY basis and same host currency as `revenue`.
   *
   * NOTHING READS THIS IN THE SIMULATION. It exists so a rollback is a data
   * operation instead of an archaeology project — see
   * `restoreCapitalModeFromShadow` and
   * `scripts/migrations/2026-08-01-restore-capital-mode-from-shadow.ts`.
   *
   * Nullable, like `plantsStartTurn`: the transfer folds in
   * `sectorTransferCapex` write an explicit `null` when NEITHER side of a merge
   * carried a restore point, which readers treat identically to absent.
   */
  legacyRevenueShadow?: number | null;
  /**
   * The pre-plants growth chain that drives {@link legacyRevenueShadow}, kept
   * alongside it for the same reason.
   *
   * Under plants `targetGrowthRate` is forced to 0 and `currentGrowthRate`
   * trends down to meet it, so the LIVE growth fields stop describing the
   * counterfactual within a few turns of the flip. These two are stamped from
   * the live values on the flip turn and then trended on their own, so the
   * shadow revenue series can compound at the rate capital mode would have
   * used rather than at the zeroed plants rate. A rollback restores the live
   * growth fields from these — otherwise capital mode would resume compounding
   * a correct nameplate at a growth rate of zero.
   *
   * NOTHING READS THESE IN THE SIMULATION.
   */
  legacyGrowthRateShadow?: number;
  /** @see legacyGrowthRateShadow — the target leg of the same frozen chain. */
  legacyTargetGrowthRateShadow?: number;
  /**
   * Capital book anchor (₳) — a depreciated high-water mark on the sector's
   * going-concern value (sectorNPV), used as a tangible-book floor under capital
   * mode. Seeded at the current NPV on first exposure (mode flip is a no-op),
   * ratchets up with NPV, and decays slowly when NPV falls — so a corp that
   * invested in real capacity isn't valued as if it owns nothing during a
   * transient profit dip, without ever exceeding its own historical peak.
   */
  capitalBookAnchor?: number;
  /** Strategy being transitioned FROM (null when not transitioning) */
  transitionFromStrategyId?: string | null;
  /** Turn when the current strategy transition began */
  transitionStartTurn?: number | null;
  /**
   * D9: did the retool that opened this transition actually apply the RPU
   * `capitalStock` rescale? Written alongside `transitionFromStrategyId` by
   * `setSectorStrategy`, read by `cancelSectorStrategy`.
   *
   * The rescale is plants-gated and each command resolves the gate at its own
   * call time, so a retool committed under capital mode and cancelled after a
   * flip to plants would apply the INVERSE ratio to a stock that was never
   * scaled — a permanent mint or burn of the whole RPU ratio, which reaches
   * 327x for a coal to rare-earth pair. Persisting the decision makes the
   * inverse conditional on the forward step having happened, so the pair can
   * never come apart across a mode change. Absent on legacy rows, which
   * predate plants and were therefore never rescaled: treat as false.
   */
  retoolRescaleApplied?: boolean;
  /** Turn after which a new strategy change is allowed (transition end + cooldown) */
  transitionCooldownUntilTurn?: number | null;
  /** Turn the extraction auto-strategy phase adopted a focused mining strategy here (audit trail). */
  autoStrategyAdoptedAtTurn?: number;
  /** True when transition is running backward toward original strategy (cancel in progress) */
  isReversing?: boolean;
  /** CEO-set target production level (-25 to +25). Trends toward this value at 1/turn. */
  productionPolicy?: number;
  /** Currently active production level (-25 to +25). Trends toward productionPolicy each turn. */
  productionPolicyLevel?: number;
  /**
   * Counter for the sustained-negative-production margin penalty. Increments
   * by 1 per turn while productionPolicyLevel < 0 and decrements by 1 (floored
   * at 0) per turn otherwise. Penalty schedule lives in
   * `getSustainedNegativeProductionPenalty`. Absent on legacy sectors —
   * treated as 0 by the turn loop until first computed.
   */
  negativeProductionSustainedTurns?: number;
  /** Per-sector public-service posture; overrides the corp-wide `soeMandate` (spec §11.4). */
  soeMandate?: SoeMandate;
  /**
   * Turn this sector was absorbed by nationalization. Powers the re-privatization
   * cooldown (spec §13.4); absent on seeded / split-off / private sectors.
   */
  absorbedAtTurn?: number;
  /**
   * Turn this sector was nationalized — anchor for the transition productivity
   * shock (decays over NATIONALIZATION_TRANSITION_TURNS). Stamped at the moment of
   * a taking; absent on never-nationalized sectors (no shock).
   */
  nationalizedAtTurn?: number;
  /**
   * Extraction capacity utilization ∈ [0,1] from the last turn — the
   * revenue-weighted fraction of this sector's resource output that its
   * operating state's capacity actually admits. 1 = unconstrained. Display +
   * the revenue haircut read this. Absent on non-extraction sectors.
   */
  capacityUtilization?: number;
  /** The extractable resource that most constrains this sector (lowest capacity
   *  multiplier), or absent when the sector is unconstrained. Display only. */
  capacityBindingResource?: ExtractableResource;
  /**
   * Turn this sector first came under the capacity revenue haircut — anchor for
   * the transition ramp (fades none → full over EXTRACTION_CAPACITY_HAIRCUT_TURNS).
   * Stamped the first time an extraction sector is processed; absent otherwise.
   */
  capacityHaircutStartTurn?: number;
  /**
   * SOCI escalation multiplier (`sociMultiplier`) captured when this sector was
   * nationalized — fixes the transition shock's depth/length to how concentrated
   * the state was THEN, so later takings can't retroactively deepen an
   * already-settled sector's digestion. Absent ⇒ 1 (base transition); the
   * grandfather migration backfills 1 for pre-rebalance sectors.
   */
  nationalizationTransitionMultiplier?: number;
  /**
   * Sector-wide bill scope stamped at enactment (`all` | `corporations` |
   * `unowned` | `npp_unowned`). Drives heal/merge guards so unowned-only takings
   * do not purge legitimate corps.
   */
  sectorNationalizationScope?: "all" | "corporations" | "unowned" | "npp_unowned";
  /** Carve fraction from the sector-wide bill that created/expanded this holding. */
  sectorNationalizationCarveFraction?: number;
  /**
   * Active for-sale listing on this sector. Set when the CEO lists the sector
   * on the secondary market; cleared on unlist or when ownership transfers.
   * Asking price is locked at listing time so buyers see a stable quote even
   * if margins shift before purchase.
   */
  forSale?: {
    /** When the listing was created */
    listedAt: Date;
    /**
     * Asking price in ₳ (anchor). Locked at listing time as
     * SECTOR_FOR_SALE_PRICE_FRACTION × yearly profit / NPV_ANNUAL_DISCOUNT_RATE.
     */
    priceAnchor: number;
    /** NPV in ₳ at listing time, recorded for transparency / display */
    npvAnchor: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}
