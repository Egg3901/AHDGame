import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export interface StatePartyOrg {
  _id: string;
  countryId: CountryId;
  stateId: string;
  partyId: string;
  organization: number;
  chairId: ObjectId | null;
  viceChairId: ObjectId | null;
  treasurerId: ObjectId | null;
  /**
   * Single chair-assigned campaigner character for this state-party row.
   * Picker is filtered to party members in THIS state. Gains auth to
   * spend state PS to Build Org. NPP Management / Move / Recruitment stay
   * chair / vice-chair / admin only.
   *
   * Assigned by the state chair only.
   */
  campaignerId?: ObjectId | null;
  treasury: number;
  stateTaxRate: number;
  /**
   * Political Strength reserve — the renamed-from-`actionPool` PS pool for
   * this state-party row. Phase 3 model: passive `+1/turn` trickle plus
   * treasury-driven gains at `50%` of the national rate per Phase 0.5
   * §"Recommended" #2; cap defaults to `STATE_PS_CAP_DEFAULT` (`30`).
   *
   * See plan §"Phase 3 — Political Strength Migration" + Phase 0.5 §8.
   */
  politicalStrength: number;
  /**
   * State-chair-set per-turn budget for explicit PS investment on this
   * state-party row, on top of the flat state passive (5/turn). Half-priced
   * relative to national (`psInvestmentRate(countryId, "state")`) — matches the
   * convention that state PS is twice as efficient per unit of treasury.
   *
   * Defaults to `0` (off). See `partyActionGeneration` for the math.
   */
  psInvestmentBudget?: number;
  /**
   * Dedicated NPP Action Points pool (state scope). Same economy as the
   * national `PoliticalParty.nppActionPoints` field but with state caps/regen
   * and the owning party's tier. See `src/lib/npp/actionPoints.ts`.
   */
  nppActionPoints?: number;
  heroImageUrl?: string;
  createdAt: Date;
  updatedAt: Date;

  // Presence tracking — true when this party has at least one player
  // character or elected official in this state.
  hasPresence: boolean;

  /** State-level NPP recruitment cooldown end (Date). Legacy fallback. Independent of the national party cooldown. */
  nppRecruitmentCooldownUntil?: Date;
  /** State-level NPP recruitment cooldown end turn (currentTurn + 24). Turn-first source. */
  nppRecruitmentCooldownUntilTurn?: number;

  /**
   * Party Registration percent in this state — slow-moving partisan lean,
   * NOT a literal vote-share promise.
   *
   * Phase 1: schema added; field defaults to undefined on existing rows.
   * Phase 1.5 / Phase 2 prerequisite: bootstrap backfill from the plan's
   *   Bootstrap Seed appendix populates real values.
   * Phase 3+: Reg drift / decay / poach actions mutate this field.
   *
   * Bounds 0..100 per individual row. The full state registration pool
   * is normalized to 100% across all parties' `registration` plus
   * `StateRegistrationPool.{independent, unregistered}` in the same state.
   *
   * Defaulting: undefined means "not yet computed / seeded" — readers must
   * treat as 0 and surface honest placeholder UI rather than fabricating
   * a derived value.
   *
   * See docs/design/political-system-reg-support.md §4.2 for the full model.
   */
  registration?: number;

  /**
   * Seed-authored party share (0-100) of this region's partisan electorate,
   * derived from era polling/vote-share tables at seed time (today written
   * only by the UK org calculation path — `ukStatePartyOrgCalculations.ts`).
   *
   * Consumed by `regBaselineMultiplier` as a concave (`share^0.5`) structural
   * vote-weight scalar in general elections. Deliberately SEPARATE from
   * `registration` so the US registration lanes (regResistance / peel curves)
   * are never double-counted: undefined → the multiplier is exactly 1.0 and
   * behavior is byte-identical to pre-field worlds. Static after seeding —
   * no turn phase mutates it.
   */
  registrationShare?: number;

  /**
   * Presidential primary delegate allocation method chosen by the state party chair.
   * Unset → falls back to family default (Dem-family = PR, GOP-family = WTA).
   * Frozen at election.status "upcoming → active" transition for that cycle.
   */
  primaryAllocation?: "PR" | "WTA";

  /**
   * Temporary additive boost to this state party's organization during a
   * presidential primary — populated by a candidate's home-state surge action.
   * Added to `organization` ONLY when computing primary projection + stagger
   * vote distribution, not for non-primary flows. Cleared at primary resolution.
   */
  primarySurge?: number;

  // DEPRECATED - kept for migration compatibility, remove after migration
  consecutiveLosses?: number;
}
