import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { CharacterStats, StatXp } from "../../stats/statsConstants";
import type {
  TutorialExperience,
  TutorialInterest,
  TutorialTrack,
} from "../../onboarding/tutorialPlan";

/**
 * A per-party block created when a chair purges this character. The character
 * cannot rejoin the named party until `purgedAtTurn + PURGE_REJOIN_COOLDOWN_TURNS`.
 * `countryId` disambiguates party sequentialId collisions across countries.
 */
export interface PurgeRejoinBlock {
  partyId: string;
  countryId: CountryId;
  purgedAtTurn: number;
}

export interface StoredPoll {
  takenAt: Date;
  overallAppeal: number;
  totalEstimatedVoters: number;
  totalPotentialVoters: number;
  topGroups: unknown[];
  bottomGroups: unknown[];
  categories?: unknown[];
}

export interface PolicyPositions {
  economic: number;
  social: number;
  domainPositions?: Record<string, number>;
}

export type OfficeType =
  // ── US offices (preserved exactly) ──────────────────────────────────────
  | { type: "house"; state: string; seatsHeld: number }
  | { type: "senate"; state: string; senateClass?: 1 | 2 | 3 }
  | { type: "stateSenate"; state: string; seatsHeld: number }
  | { type: "governor"; state: string }
  | { type: "president" }
  | { type: "vicePresident" }
  | { type: "usCabinet"; positionId: string }
  // ── UK offices ───────────────────────────────────────────────────────────
  | {
      type: "commons";
      state: string;
      seatsHeld?: number;
      constituency?: string;
      constituencyId?: string;
    }
  | { type: "regionalCouncil"; state: string; seatsHeld: number }
  | { type: "primeMinister"; state?: string; constituency?: string; constituencyId?: string }
  | { type: "ukCabinet"; positionId: string }
  | { type: "parliamentaryCabinet"; positionId: string }
  // ── DE offices ───────────────────────────────────────────────────────────
  | { type: "bundestag"; state: string }
  | { type: "chancellor" }
  | { type: "ministerPresident"; state: string }
  | { type: "landtag"; state: string; seatsHeld: number }
  | { type: "deCabinet"; positionId: string }
  // ── Future-country escape hatch ──────────────────────────────────────────
  // chamberClass: staggered multi-seat chambers (e.g. JP Sangiin 1/2) — needed so
  // sameSeat checks and per-class bookkeeping don't conflate the two classes.
  | {
      type: string;
      state?: string;
      seatsHeld?: number;
      chamberClass?: 1 | 2;
      constituency?: string;
      constituencyId?: string;
    };

export type CharacterRace = "white" | "black" | "hispanic" | "asian" | "other";
export type CharacterGender = "male" | "female" | "nonbinary";
export type CharacterEducation = "no_college" | "college" | "graduate";
export type CharacterWealth = "low" | "middle" | "high";

export interface CharacterDemographics {
  race: CharacterRace;
  gender: CharacterGender;
  education: CharacterEducation;
  wealth: CharacterWealth;
}

export type CareerEventType =
  "elected" | "lost_election" | "resigned" | "appointed" | "removed" | "relocated";

/** Player line-of-credit (central bank) — per-currency principal, arrears, UX flags. */
/**
 * Pool that funded a loan. Determines where principal flows on draw and
 * back on repay. Default "both" = 50/50 split. Admins can override per loan.
 */
export type LoanFundingSource = "deposits" | "reserves" | "both";

/**
 * LoC payment mode per currency.
 * - "pi" (default): scheduled auto-pay is LOC_PER_TURN_PAYMENT_RATE × (principal + arrears).
 * - "io": scheduled auto-pay equals arrears (which after interest accrual = "this turn's
 *   interest + any prior arrears"); principal stays flat. Carries +2.00pp spread surcharge.
 */
export type LocPaymentMode = "pi" | "io";

export interface LineOfCreditState {
  /** Drawn principal per currency */
  balances: Partial<Record<CurrencyCode, number>>;
  /** Unpaid interest / service shortfalls per currency */
  arrears: Partial<Record<CurrencyCode, number>>;
  accountsOpened?: Partial<Record<CurrencyCode, boolean>>;
  /** When true, new draws blocked (payment distress) */
  drawFrozen?: boolean;
  /**
   * Per-currency funding source for this player's open loan account.
   * Determines deduct/credit split between bank deposits and reserves.
   * Missing entries default to "both" (50/50).
   */
  fundingSource?: Partial<Record<CurrencyCode, LoanFundingSource>>;
  /** Payment mode per currency. Missing/absent = "pi" (default, current behavior). */
  paymentMode?: Partial<Record<CurrencyCode, LocPaymentMode>>;
  /**
   * Last time the player flipped paymentMode for this currency.
   * `at` is the wall-clock for audit; `turn` is the canonical value used to enforce
   * the 24-turn cooldown (so UI/server don't need to re-derive turn from a Date).
   */
  paymentModeChangedAt?: Partial<Record<CurrencyCode, { at: Date; turn: number }>>;
}

export interface CareerEvent {
  type: CareerEventType;
  /** Office context — required for office-related events, omitted for "relocated" */
  office?: OfficeType;
  /** Human-readable label, e.g. "US Senate (CA)" for office events, "California → Texas" for relocations */
  officeLabel: string;
  /** Party sequentialId at the time of the event */
  party?: string;
  /** Country the party belongs to — required to resolve sequentialId unambiguously across countries */
  partyCountryId?: string;
  /** For election events */
  electionId?: string;
  /** For "relocated" events — from/to location context */
  fromState?: string;
  toState?: string;
  fromCountry?: string;
  toCountry?: string;
  date: Date;
}

export interface Character {
  /** Local singleplayer career constraint; absent on hosted characters. */
  singleplayerHeadOfState?: boolean;
  _id: ObjectId;
  userId: ObjectId;
  countryId: CountryId;
  /**
   * The country THIS character was created in. Immutable per character, unlike
   * `countryId`, which moves when the character emigrates. Profile "Starting
   * Nationality" reads this. It replaces `users.accountCountryId` for that
   * purpose: `accountCountryId` is account-level and set once from the player's
   * FIRST ever character, so on a second character (or after a world reset) it
   * showed a nationality from a character the player no longer has (ticket 1107).
   * Optional because characters created before this field exists do not have it;
   * fall back to `countryId`.
   */
  startingCountryId?: CountryId;
  name: string;
  homeState: string;
  avatarUrl?: string;
  /** Wide banner image for profile hero (player-uploaded). */
  profileHeaderImageUrl?: string;
  politicalInfluence: number;
  nationalInfluence?: number;
  /** Party influence — accumulates per turn based on policy alignment and leadership. Floored at 0. */
  partyInfluence?: number;
  favorability: number;
  infamy: number;
  /**
   * @deprecated Removed from the schema in cf-inconsistency-fix Phase 5.
   * Still optional in the type during the migration so unmigrated test
   * fixtures keep compiling — production data has the field unset by the
   * 2026-05-18 migration. Read from `currencyBalances.campaign` instead.
   */
  funds?: number;
  /**
   * @deprecated Removed in cf-inconsistency-fix Phase 8. Optional during the
   * migration so unmigrated test fixtures keep compiling — production data
   * has the field unset by the 2026-05-18 migration. Read from
   * `currencyBalances.personal[homeCurrency]` instead.
   */
  cashOnHand?: number;
  /**
   * @deprecated Same as cashOnHand — removed in Phase 8. Read from
   * `currencyBalances.savings[homeCurrency]` instead.
   */
  savingsOnHand?: number;
  /** Multi-currency wallet — populated by migration, absent pre-forex */
  currencyBalances?: {
    /**
     * Campaign funds in the character's home/local currency. Canonical source
     * of truth for the post-cf-inconsistency-fix world. Writers mutate this
     * field directly in local units; readers consume it as the home-currency
     * balance and convert to anchor only when explicitly required at a
     * cross-currency boundary.
     */
    campaign: number;
    /** Personal wealth per currency — missing keys treated as 0 */
    personal: Partial<Record<CurrencyCode, number>>;
    /** Savings per currency — APY tied to that currency's national prime rate */
    savings?: Partial<Record<CurrencyCode, number>>;
    /**
     * Private banking (1.1): who holds each currency's savings balance —
     * "centralBank" (default when absent) or a bank corporation id. The
     * pointer keeps `savings` the single balance so existing readers need
     * no edits.
     */
    savingsHolder?: Partial<Record<CurrencyCode, import("./bank").SavingsHolder>>;
    /** Cumulative interest credited to savings, per currency (lifetime) */
    interestEarned?: Partial<Record<CurrencyCode, number>>;
    /** Per-turn accrued interest not yet quarterly-credited to savings */
    pendingSavingsInterest?: Partial<Record<CurrencyCode, number>>;
  };
  /** Pre-forex: lifetime interest credited to savingsOnHand */
  savingsInterestEarnedLifetime?: number;
  /** Tracks which currency savings accounts have been opened (for UX prompts). */
  savingsAccountsOpened?: Partial<Record<CurrencyCode, boolean>>;
  /** How foreign prices are displayed: asset's native currency, player's home, or internal unit */
  displayCurrencyPreference?: "local" | "home" | "internal" | CurrencyCode;
  /** When true, insufficient foreign currency auto-converts from home currency */
  autoConvertEnabled?: boolean;
  actions: number;
  /**
   * RPG stat block (Fallout-SPECIAL style). Each value is a float clamped to
   * [1, 10]. Absent on characters created before the stat system shipped —
   * those are gated through the grandfather allocation flow (see
   * `statsAllocated`). See src/lib/stats/statsConstants.ts.
   */
  stats?: CharacterStats;
  /** True once the player has allocated their 28-point stat spread. */
  statsAllocated?: boolean;
  /**
   * True once the player has spent their single free stat reallocation. The
   * free respec is a one-per-character, full reset of the stat block — it
   * rewrites `stats`, clears `statXp`, and resets `debateDecayAnchor` (see
   * POST /api/character/reallocate-stats).
   */
  statsReallocationUsed?: boolean;
  /**
   * True when the player dismissed the one-time allocation gate to allocate
   * later. Suppresses the blocking modal and surfaces a persistent
   * "return to stats" banner on the profile instead. Cleared when they
   * reopen allocation or finish allocating.
   */
  statAllocationDismissed?: boolean;
  /** Fractional use-drift progress for generic-drift stats (not Debate). */
  statXp?: StatXp;
  /** Anchor timestamp for the real-time 72h Debate decay clock. */
  debateDecayAnchor?: Date;
  donorBaseLevel: number;
  policies: PolicyPositions;
  party: string;
  currentOffice: OfficeType | null;
  careerHistory?: CareerEvent[];
  /**
   * Executive terms completed/assumed per country.
   * Stored explicitly so re-election + succession can both count toward limits
   * without re-deriving from career history on every eligibility check.
   */
  executiveTermsServed?: Partial<Record<CountryId, number>>;
  demographics?: CharacterDemographics;
  bio?: string;
  lastNameChange?: Date;
  lastPoll?: StoredPoll;
  lastPollLarge?: StoredPoll;
  highlightedAchievementIds?: ObjectId[];
  campaignSongUrl?: string;
  campaignSongAutoplay?: boolean;
  groupFavorability?: Record<string, number>;
  /**
   * Per-group approval modifiers (-100 to +100), keyed on Layer-1 census
   * BUCKETS (`"education:no_college"`). Bill enactment writes them from the
   * bucket affinity tables (`src/lib/bucketAffinities.ts`), and the vote path
   * remaps them onto granular units by bucket membership.
   *
   * Legacy voter-archetype keys still resolve: `archetypeValuesToBuckets` fans
   * an archetype out across its buckets and passes a bucket key through
   * untouched, so rows written before the conversion keep working until the
   * migration has run. The field name is the last archetype-era artefact here
   * and goes with the rest of the vocabulary in the deletion pass.
   *
   * Applied as: effectiveFavorability = favorability + approval * 0.5
   * Decays 0.5% per turn toward 0.
   */
  archetypeApprovals?: Record<string, number>;
  /** Wall-clock instant of the last relocation (game clock). Legacy fallback for the cooldown; 24-turn cooldown applies. */
  lastRelocatedAt?: Date;
  /** Turn the last relocation occurred. Turn-first source for the 24-turn relocation cooldown. */
  lastRelocatedTurn?: number;
  /** Whether the player has dismissed the onboarding checklist */
  onboardingDismissed?: boolean;
  /**
   * New-player onboarding checklist state (see src/lib/onboarding/checklist.ts).
   * `steps` records page-visit steps ("scout-state", "read-wire") keyed by step
   * id; timestamps are stamped server-side by PATCH /api/character/me and only
   * those two ids are writable. `dismissedAt` supersedes `onboardingDismissed`
   * (both are checked, so legacy dismissals stay dismissed). `rewardGrantedAt`
   * is the one-time completion-reward stamp; its presence means the reward was
   * paid and it can never pay twice.
   */
  onboarding?: {
    steps?: Record<string, Date>;
    dismissedAt?: Date;
    rewardGrantedAt?: Date;
    /** Anchor-denominated (₳) reward amount actually paid, for forensics. */
    rewardAmount?: number;
  };
  /**
   * @deprecated Superseded by `tutorial` (see src/lib/onboarding/tutorialPlan.ts).
   * Still read by `resolveTutorialPlan`, which migrates it in memory
   * ("politics" → the office chapter, "complete"/absent → every chapter), so
   * pre-plan characters keep their exact behavior with no backfill. Never
   * written by new code.
   */
  tutorialTrack?: TutorialTrack;
  /**
   * Guided-tour plan the player chose in the welcome flow (see
   * src/lib/onboarding/tutorialPlan.ts). `experience` is how well they know the
   * game; `interests` are the chapters they asked for ("All of it" is stored as
   * every interest, never a literal "all"). `progress` is the server-side
   * resume point so switching device does not restart the tour; the coach also
   * keeps a localStorage copy as the offline fast path.
   *
   * Absent means the player has not answered yet — the welcome flow shows for
   * freshly created characters, and `resolveTutorialPlan` falls back to the
   * legacy track or the full tour for everyone else.
   */
  tutorial?: {
    experience: TutorialExperience;
    interests: TutorialInterest[];
    chosenAt: Date;
    progress?: { chapterId: string; stepId: string; updatedAt: Date };
    completedChapters?: string[];
  };
  /** Whether the player has visited the wiki getting-started page */
  hasReadWiki?: boolean;
  /** When true, automatically enters the character into new elections in their home state */
  autoRunForReelection?: boolean;
  createdAt: Date;
  /**
   * Game turn the character was created on. Turn-first anchor for the 24-turn
   * new-character transfer barrier (see newCharacterTransferBarrier.ts). Absent on
   * documents created before this field shipped — the barrier falls back to the
   * `createdAt` Date for those.
   */
  createdTurn?: number;
  updatedAt: Date;
  /**
   * A test character driven by the playtest harness, not a person.
   *
   * Optional, so every existing document and fixture stays valid. Read by three
   * kinds of consumer, all of which must exclude it: the auth guard (a synthetic
   * session is allowed to automate, a real one is not), the public standings
   * (a bot must not appear in a leaderboard beside players), and alt detection
   * (a harness account looks exactly like an alt ring, and would eventually be
   * reported as one).
   */
  isSynthetic?: boolean;
  /**
   * The playtest run that created this character, so its actions can be found
   * afterwards. Not an undo, but it makes the blast radius queryable rather
   * than guessed at.
   */
  syntheticRunId?: string;
  /** Sequential ID for stable URLs (e.g., /character/1) */
  sequentialId?: number;
  /** Patreon profile border key */
  borderKey?: string | null;
  /** Patreon highlight color for tintable borders */
  tintColor?: string | null;
  /** Multi-currency LOC — gated by gameConfig.lineOfCreditEnabled */
  lineOfCredit?: LineOfCreditState;
  /**
   * Set when the character joins a party; unset when they leave or go
   * independent. Used as a third anchor in the 24-hour new-character
   * cooldown for leadership/committee actions.
   */
  partyJoinedAt?: Date;
  /**
   * Game turn at which the character last joined their current party. Stamped
   * on every join/switch/merge-absorption and cleared on leave/purge. Anchors
   * the turn-based leadership tenure gate (see lib/parties/leadershipTenure.ts).
   * Optional: absent on legacy docs (treated as grandfathered) until backfill.
   */
  partyJoinedTurn?: number;
  /** PREE lottery annuity drip — processed each turn until turnsRemaining hits 0. */
  preeLotteryAnnuity?: { turnsRemaining: number; piPerTurn: number };
  /**
   * Anchor for the 24-hour join cooldown. Stamped only when joining an actual
   * party (join route / party creation). Voluntarily leaving to independent
   * does NOT refresh it, and purge clears it — becoming independent never arms
   * a fresh cooldown. Unlike partyJoinedAt it survives an independent stint, so
   * a recent joiner can't dodge the cooldown via a leave-then-rejoin hop.
   */
  lastPartySwitchAt?: Date;
  /**
   * Timestamp the character used their one free party move during a post-reset,
   * pre-first-unpause setup window (see antiAbuseGuards / join route). Absent
   * means the free move is still available. The move is "free" only in that it
   * bypasses the 24h switch cooldown once; a second in-window switch falls back
   * to the normal cooldown. Naturally clears on reset (characters are deleted).
   */
  freePartyMoveUsedAt?: Date | null;
  /**
   * Active per-party rejoin blocks from purges. Pruned of expired entries on
   * every write. Absent/empty means no active blocks. See PurgeRejoinBlock.
   */
  purgeRejoinBlocks?: PurgeRejoinBlock[];
  lastDiscussionPostAt?: Date;
  /**
   * Caucus this Character is currently affiliated with. Null = unaffiliated.
   * Caucuses are a national-only structure — see `Caucus` in db/types/caucus.ts.
   * Source of truth is the `caucusMemberships` collection (where memberType =
   * "character"); this field is a denormalized cache of the player's single
   * active membership for fast roster filtering and faction-grouped views.
   * Constraint: at most one active caucus per Character at a time.
   */
  factionId?: ObjectId | null;
  /**
   * v3 Phase 8 (labourSystemMode >= "full"): the Union this Character leads,
   * or null. Source of truth is `Union.ownerId` (see `src/lib/db/types/union.ts`)
   * — this field is a denormalized read cache, mirroring `factionId` above.
   * Written atomically with `Union.ownerId` (via `runWithOptionalTransaction`)
   * on claim; defensively read-repaired on the union dashboard/leaderboard
   * read path rather than a full periodic maintenance phase (the invariant
   * here — one leader per union, one union per leader, no roster — is
   * simpler than caucus membership's).
   */
  unionLeaderOf?: ObjectId | null;
}
