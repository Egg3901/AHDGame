import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * A single Shadow Cabinet appointment (player suggestion #52) — the character
 * the Leader of the Opposition has named to shadow one cabinet post. Display /
 * roleplay only; carries no mechanical or gameplay effect. Stored in
 * `PoliticalParty.shadowCabinet`, keyed by cabinet position id.
 */
export interface ShadowCabinetAppointment {
  /** Appointed character's id. */
  characterId: ObjectId;
  /** Denormalized name so the hub renders without a characters join. */
  characterName: string;
  /** When the sitting Opposition Leader made the appointment. */
  appointedAt: Date;
}

export interface PoliticalParty {
  _id: ObjectId;
  /** Sequential ID for URLs - unique per country (e.g., /parties/1?country=us) */
  sequentialId: number;
  countryId: CountryId;
  name: string;
  abbreviation: string;
  color: string;
  economicPosition: number;
  socialPosition: number;
  /**
   * Phase 6 D6 — foreign-policy axis on the same `[-5, +5]` scale as
   * `economicPosition` / `socialPosition`. -5 = isolationist, +5 =
   * interventionist. Default-party seeds carry hand-curated values
   * derived from real-world stances; custom parties inherit from
   * `PartyCharter.platform.foreignPolicy / 12` at ratification.
   *
   * Currently scaffolding only — no engine reads this yet. When future
   * mechanics (Phase 7+) consume it, undefined falls back to 0.
   */
  foreignPolicy?: number;
  /**
   * Phase 6 D6 — culture axis on the same `[-5, +5]` scale. -5 = open
   * (cosmopolitan / multicultural / secular), +5 = traditional
   * (nationalist / religious-conservative / mono-cultural). Same
   * sourcing rule as `foreignPolicy`.
   */
  culture?: number;
  chairId: ObjectId | null;
  viceChairId: ObjectId | null;
  treasurerId: ObjectId | null;
  /**
   * Up to 3 chair-assigned campaigner characters. Campaigners gain auth to
   * spend party PS to Build Org on any state-party row owned by this party.
   * NPP Management / Move / Recruitment stay chair / vice-chair / admin.
   *
   * Assigned in the Chair's Office UI; chair-only assignment (vice-chair
   * cannot reassign campaigners). Default: empty array.
   */
  campaignerIds?: ObjectId[];
  committeeIds: ObjectId[];
  memberCount: number;
  isDefault: boolean;
  createdBy: ObjectId | null;
  treasury: number;
  nationalTaxRate: number;
  /**
   * Political Strength reserve — the renamed-from-`actionPool` PS pool.
   *
   * Phase 3 model: PS is a stored reserve that grows from a flat passive
   * per-turn gain plus a treasury-driven country-normalized spend stream, both
   * limited solely by the hard `politicalStrengthCap` (soft-cap slowdown bands
   * removed 2026-06-28). PS is spent on party actions (Org Building, Influence,
   * GOTV, Suppression, Contest, etc.) via the shared `spendPoliticalStrength`
   * command, which also tracks per-geography pressure escalation.
   *
   * See plan §"Phase 3 — Political Strength Migration" and Phase 0.5 §8.
   */
  politicalStrength: number;
  /**
   * Optional override for the per-party PS cap. When unset, the cap derives
   * from the party tier: Major → the flat `NATIONAL_PS_CAP`; Minor →
   * `minorPartyPsCap(earnedRegions, NATIONAL_PS_CAP)`. Override exists for
   * future per-party adjustments (e.g. a charter perk).
   */
  politicalStrengthCap?: number;
  /**
   * Chair-set per-turn budget for explicit PS investment, on top of the flat
   * passive (national 20 / state 5). Each turn, `min(budget, treasury)` is
   * debited and converted to PS at the country-scoped rate
   * (`psInvestmentRate(countryId, scope)`), capped at `+PS_INVESTMENT_MAX_TIERS`
   * PS/turn.
   *
   * Spend converts at the full rate up to the hard cap (soft-cap bands removed
   * 2026-06-28); near the cap only the PS that fits below it is bought and
   * charged. Treasury at `0` only zeroes the spend stream — the flat passive is
   * still paid.
   *
   * Defaults to `0` (off). See `partyActionGeneration` for the math.
   */
  psInvestmentBudget?: number;
  /**
   * Dedicated NPP Action Points pool (national scope). Banked, regenerates a
   * flat passive per turn (tier-scaled) up to `nppActionPointCap("national",
   * tier)`. Sole currency for NPP Recruitment (5 AP) and NPP Management (1 AP);
   * PS/treasury are no longer charged for NPP work. `undefined` on legacy rows
   * is treated as a full pool until the next regen heals it. See
   * `src/lib/npp/actionPoints.ts`.
   */
  nppActionPoints?: number;
  /**
   * Priority Region cluster — 2–3 adjacent states / regions where this party
   * gets a `+25%` effectiveness bonus on direct national PS actions. Locked
   * for `168 turns` once set.
   *
   * The lock survives chair turnover; ineligible states are auto-evicted by
   * the per-turn validator but the slot stays empty until cooldown expires.
   *
   * See plan §"Phase 3 — Decisions Recorded During Execution" D6.
   */
  priorityRegion?: {
    stateIds: string[];
    setAtTurn: number;
    setBy: ObjectId;
  };
  /** NPP recruitment cooldown end (Date). Legacy fallback for the cooldown check. */
  nppRecruitmentCooldownUntil?: Date;
  /** NPP recruitment cooldown end turn (currentTurn + 24). Turn-first source. */
  nppRecruitmentCooldownUntilTurn?: number;
  /** Turn on which the last member purge was executed. Used to enforce the cooldown. */
  lastPurgeAtTurn?: number;
  /** Number of consecutive purges executed by the chair (resets after cooldown expires). */
  purgeCount?: number;
  heroImageUrl?: string;
  logoUrl?: string;
  discordInviteUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Coalition this party belongs to, if any */
  coalitionId?: ObjectId | null;
  /** Set when this party has merged into another party and no longer exists as an active party */
  isDefunct?: boolean;
  defunctAtTurn?: number;
  mergedIntoPartyId?: ObjectId;
  /**
   * Presidential primary calendar family. Determines wave schedule + delegate table.
   * Built-in parties (democrat/green/progressive/dem-socialist → "dem",
   * republican/libertarian/reform → "gop") ignore this field and use their hardcoded
   * assignment. Custom parties set this explicitly; unset falls back to economicPosition sign.
   */
  primaryCalendar?: "dem" | "gop";
  /**
   * How national leadership elections are decided.
   * "party"     = all members, one vote each (default)
   * "committee" = committee members + national leadership only, one vote each
   * "influence" = all members, votes weighted by character partyInfluence
   */
  leadershipElectionMethod?: "party" | "committee" | "influence";
  /** Custom election duration in turns (168–420). Falls back to NATIONAL_ELECTION_DURATION_TURNS when unset. */
  customElectionDurationTurns?: number;
  /**
   * Per-axis lockedUntilTurn for `positionShift` CommitteeProposals.
   * When a positionShift on an axis passes, that axis is locked for
   * `POSITION_SHIFT_COOLDOWN_TURNS` (336) before another positionShift
   * on the same axis can be proposed. Each axis tracks independently
   * so a passed `social` shift does not lock `economic`.
   *
   * Absent map / absent axis entry = unlocked. No migration needed.
   */
  positionShiftCooldowns?: {
    economic?: { lockedUntilTurn: number };
    social?: { lockedUntilTurn: number };
    foreignPolicy?: { lockedUntilTurn: number };
    culture?: { lockedUntilTurn: number };
  };
  /**
   * Per-type lockedUntilTurn for non-positionShift CommitteeProposals.
   * When a non-positionShift proposal passes, that type is locked for
   * `PROPOSAL_COOLDOWN_TURNS` (96) before another of the same type can
   * be proposed. Independent per-type: a passed `rename` does not
   * block `merge`.
   */
  proposalCooldowns?: {
    rename?: { lockedUntilTurn: number };
    merge?: { lockedUntilTurn: number };
    electionMethod?: { lockedUntilTurn: number };
    electionDuration?: { lockedUntilTurn: number };
    removeOfficeHolder?: { lockedUntilTurn: number };
    transactionApprovalMode?: { lockedUntilTurn: number };
  };
  /**
   * Transaction approval mode for "Send to Member" and "Transfer to
   * State Party" actions. "double" (default) writes a
   * `pendingTreasuryTransactions` row requiring Treasurer + Chair/VC
   * to both approve before the underlying transfer executes. "single"
   * auto-approves on propose (immediate execution, matches pre-2026-
   * 05-22 behavior).
   *
   * Toggled via the `transactionApprovalMode` CommitteeProposal.
   * Default-party seeds and chartered-party ratification both set
   * "double". Absent value on legacy rows is treated as "double" so
   * the new default lights up retroactively on next read.
   */
  transactionApprovalMode?: "single" | "double";
  /**
   * Regime status in countries whose `governmentType` is `"onePartyState"`.
   *
   * - `"ruling"`: the single party allowed to form government, field
   *   executive candidates, trigger VONC, or invite coalitions. Invariant:
   *   at most one party per country has this status.
   * - `"approved"`: minor party tolerated by the regime. Full legislative
   *   participation (hold seats, run candidates for non-executive offices,
   *   propose bills, vote, accept donations, cabinet) but blocked from
   *   forming government.
   * - `"banned"`: inert. Cannot field candidates, propose bills, vote,
   *   receive donations, or be appointed to cabinet. Existing seats are
   *   vacated when status flips to banned mid-game.
   * - `null`: not applicable. Always `null` when the country's
   *   `governmentType !== "onePartyState"`.
   *
   * Authoritative at runtime. `CountryConfig.rulingPartyId` is a seed-time
   * pointer only.
   */
  regimeStatus?: "ruling" | "approved" | "banned" | null;

  /**
   * Party tier (D5, 2026-06-18) — drives the national PS cap + the player-facing
   * Major/Minor badge. Custom parties start `"minor"`; default parties are
   * seeded per country/era. Recomputed each turn by the tier turn-phase:
   * Minor → Major on ≥20% Org in ≥⌈regions/3⌉ regions; Major → Minor after the
   * `majorDemotionWarning` countdown expires. Undefined on legacy rows until the
   * heal runs — readers fall back via `resolvePartyTier` (default-party = major,
   * custom = minor). See `src/lib/parties/partyTier.ts`.
   */
  tier?: "major" | "minor";

  /**
   * Regions (state ids) where this party currently "earns" +`MINOR_PARTY_PS_CAP_PER_REGION`
   * toward its Minor PS cap — i.e. it reached ≥20% Org there and has not since
   * dropped below 10% (hysteresis). Maintained by the tier turn-phase via
   * `updateEarnedRegions`. Drives the Minor cap; ignored while Major.
   */
  psCapEarnedRegions?: string[];

  /**
   * Active Major→Minor demotion warning. Set when the party falls below 10% Org
   * in ≥⌈2·regions/3⌉ regions; cleared when it regains the graduation condition.
   * The National Party page surfaces the countdown (`startedTurn +
   * MAJOR_DEMOTION_GRACE_TURNS − currentTurn`). Absent = not at risk.
   */
  majorDemotionWarning?: { startedTurn: number };

  /**
   * Membership gate (player suggestion #72). "open" or absent — a join takes
   * effect immediately. "approval" — a join instead files a pending request in
   * `pendingJoinRequests` for a party leader (chair, or acting vice-chair when
   * the chair seat is vacant) to accept or decline. Mirrors the coalition
   * join-request flow.
   */
  membershipMode?: "open" | "approval";
  /**
   * Pending character join requests, populated only while `membershipMode` is
   * "approval". A leader's accept sets the requesting character's `party` and
   * clears the entry; a decline just clears it. Mirrors `CoalitionJoinRequest`.
   */
  pendingJoinRequests?: PartyJoinRequest[];
  /**
   * Shadow Cabinet appointments (player suggestion #52). When this party's
   * chair is the resolved Leader of the Opposition, they may name characters to
   * shadow versions of the country's cabinet posts. Keyed by cabinet position
   * id (from the country's parliamentary cabinet config); each value records
   * the shadow appointee.
   *
   * Display / roleplay only — no mechanical or gameplay effect, and never read
   * by the turn engine. Appointment and clearing are gated to the sitting
   * Opposition Leader by the shadow-cabinet route
   * (`/api/country/[code]/executive/shadow-cabinet`). Absent on parties that
   * have never named a shadow cabinet.
   */
  shadowCabinet?: Record<string, ShadowCabinetAppointment>;
}

/**
 * A character's pending request to join an approval-gated party (suggestion
 * #72). Mirror of `CoalitionJoinRequest`, keyed on the requesting character.
 */
export interface PartyJoinRequest {
  /** Character requesting to join. */
  characterId: ObjectId;
  /** Requesting character's display name at request time (survives rename). */
  characterName: string;
  requestedAt: Date;
}
