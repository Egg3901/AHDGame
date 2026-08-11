/**
 * PLAYER-IMPACT BUDGET
 *
 * The restraint layer for autonomous NPP behaviour. Everything else in the
 * autonomy stack answers "what would this politician plausibly do?"; this module
 * answers the separate question "how much of that is a human player willing to
 * absorb?".
 *
 * The distinction matters because the two goals pull against each other. Making
 * NPPs smarter and less predictable is *supposed* to increase the variety of
 * things they do — but variety must not become volume. An NPP world that files a
 * bill every few turns, dogpiles one player's corporation from six directions,
 * and buys out every share of public float is "more alive" by any simulation
 * metric and actively worse to play against.
 *
 * So: unpredictability governs WHICH NPP does WHAT. This module caps HOW MUCH
 * lands on a player. The caps are deliberately blunt and deliberately low —
 * a cap that never binds costs nothing, and a cap that binds is doing its job.
 *
 * Everything here is pure and constant-driven so the rails can be unit-tested
 * without a database, and so the numbers live in one reviewable place rather
 * than scattered across five turn phases.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { NPP_SPONSOR_ACTIVE_CAP, NPP_SPONSOR_COOLDOWN_TURNS } from "./constants";

// ── Legislature ──────────────────────────────────────────────────────────────

/**
 * Active-bill cap for NPP sponsorship inside a PLAYER-enabled country (v4 only).
 * Half the non-player cap: in a country with no human legislators, NPP bills are
 * the only legislative activity there is; in a player country they are noise on
 * top of what players are already doing, and every one of them is something a
 * player has to read and vote on.
 */
export const NPP_SPONSOR_ACTIVE_CAP_PLAYER_COUNTRY = 1;

/**
 * Sponsorship cooldown inside a player-enabled country — 3× the non-player
 * cooldown. At ~1 bill per 36 turns per party this reads as an occasional
 * backbench bill rather than a legislative treadmill.
 */
export const NPP_SPONSOR_COOLDOWN_TURNS_PLAYER_COUNTRY = 36;

export interface NppSponsorLimits {
  activeCap: number;
  cooldownTurns: number;
}

/**
 * Sponsorship throttles for a country. Player-enabled countries get the tighter
 * pair; everywhere else keeps the established non-player numbers unchanged.
 */
export function nppSponsorLimitsForCountry(isPlayerCountry: boolean): NppSponsorLimits {
  return isPlayerCountry
    ? {
        activeCap: NPP_SPONSOR_ACTIVE_CAP_PLAYER_COUNTRY,
        cooldownTurns: NPP_SPONSOR_COOLDOWN_TURNS_PLAYER_COUNTRY,
      }
    : { activeCap: NPP_SPONSOR_ACTIVE_CAP, cooldownTurns: NPP_SPONSOR_COOLDOWN_TURNS };
}

// ── Primary challengers ──────────────────────────────────────────────────────

/**
 * Maximum ambitious primary challengers NPPs may add across an entire country in
 * one election-entry pass. The per-primary cap already prevents an N-way race in
 * any single contest; this prevents the *aggregate* case where a player logs in
 * to find every race in the country newly contested on the same turn.
 */
export const NPP_CHALLENGERS_PER_COUNTRY_PER_PASS = 2;

/**
 * A player candidate may be primary-challenged by an NPP at most this many times
 * per election. Being challenged once is a game; being re-challenged every pass
 * until the primary closes is harassment.
 */
export const NPP_CHALLENGES_PER_PLAYER_CANDIDATE = 1;

/**
 * Simple per-pass counter for challenger entries, scoped per country. Kept in
 * memory for the duration of one election-entry pass — the cap is about what
 * lands on a player at once, not a persistent quota.
 */
export class ChallengerBudget {
  private readonly usedByCountry = new Map<CountryId, number>();
  private readonly challengedPlayerCandidates = new Set<string>();

  constructor(private readonly perCountryCap: number = NPP_CHALLENGERS_PER_COUNTRY_PER_PASS) {}

  /**
   * Whether a challenger may enter against `incumbentCandidateKey`. Pass the
   * candidate key only when the sitting candidate belongs to a human player —
   * NPP-vs-NPP primaries carry no annoyance cost and are only bounded by the
   * per-country cap.
   */
  canChallenge(countryId: CountryId, playerCandidateKey?: string): boolean {
    if ((this.usedByCountry.get(countryId) ?? 0) >= this.perCountryCap) return false;
    if (playerCandidateKey && this.challengedPlayerCandidates.has(playerCandidateKey)) return false;
    return true;
  }

  /** Record a challenger entry against the budget. Call only after the entry succeeds. */
  record(countryId: CountryId, playerCandidateKey?: string): void {
    this.usedByCountry.set(countryId, (this.usedByCountry.get(countryId) ?? 0) + 1);
    if (playerCandidateKey) this.challengedPlayerCandidates.add(playerCandidateKey);
  }
}

// ── Corporate aggression ─────────────────────────────────────────────────────

/**
 * Minimum turns between autonomous attacks landing on the SAME player-owned
 * defender, from any attacker.
 *
 * The existing ATTACK_COOLDOWN_TURNS is per-attacker only, which bounds how often
 * one NPP corp attacks but does nothing about N different NPP corps converging on
 * one player. Three days of game clock between hits on the same player keeps
 * economic aggression a recurring threat rather than a siege.
 */
export const NPP_ATTACK_PLAYER_DEFENDER_COOLDOWN_TURNS = 72;

/**
 * Whether a player-owned defender is off the shared cooldown. NPP-owned
 * defenders are unrestricted — the budget exists to protect humans, and
 * throttling NPP-vs-NPP aggression would just make the simulated economy
 * quieter for no player-facing benefit.
 */
export function canAttackDefender(args: {
  defenderIsPlayerOwned: boolean;
  lastPlayerAttackedTurn: number | undefined;
  currentTurn: number;
}): boolean {
  const { defenderIsPlayerOwned, lastPlayerAttackedTurn, currentTurn } = args;
  if (!defenderIsPlayerOwned) return true;
  if (lastPlayerAttackedTurn == null) return true;
  return currentTurn - lastPlayerAttackedTurn >= NPP_ATTACK_PLAYER_DEFENDER_COOLDOWN_TURNS;
}

// ── Market politeness ────────────────────────────────────────────────────────

/**
 * Fraction of any instrument's public float that autonomous NPP sweeps must
 * leave on the table.
 *
 * Bond and share float is finite and shared. An NPP sweep sized as a fraction of
 * the NPP's own savings has no notion of how much of the market it is consuming,
 * so a wealthy NPP could clear an entire issue in one cycle and a player would
 * simply find nothing to buy — the most invisible and most infuriating kind of
 * competition, since there is no event to read and nothing to react to.
 */
export const NPP_FLOAT_RESERVE_FRACTION = 0.25;

/**
 * Largest quantity an autonomous sweep may take from `publicFloat`, leaving the
 * reserve fraction untouched. Returns 0 when the float is already at or below
 * the reserve — NPPs stop buying rather than nibbling it to zero.
 */
export function politeFloatLimit(publicFloat: number): number {
  if (!Number.isFinite(publicFloat) || publicFloat <= 0) return 0;
  return Math.floor(publicFloat * (1 - NPP_FLOAT_RESERVE_FRACTION));
}

// ── Notification volume ──────────────────────────────────────────────────────

/**
 * Maximum autonomous-NPP notifications a single player may receive per rolling
 * window. Beyond this the turn phase should coalesce rather than continue
 * emitting: the tenth "your sector was attacked" notification in a day carries
 * no information the first nine didn't.
 */
export const NPP_PLAYER_NOTIFICATIONS_PER_WINDOW = 3;
export const NPP_NOTIFICATION_WINDOW_TURNS = 24;

/**
 * Whether another autonomous-NPP notification may be sent to this player in the
 * current window. `sentInWindow` is the count the caller has already tallied.
 */
export function canNotifyPlayer(sentInWindow: number): boolean {
  return sentInWindow < NPP_PLAYER_NOTIFICATIONS_PER_WINDOW;
}

/**
 * Count of autonomous-NPP notifications delivered to a user inside the current
 * window. Used by the corporate-attack phase to decide between notifying and
 * coalescing. Cheap: one indexed count on `notifications`.
 */
export async function countRecentNppNotifications(
  db: Db,
  userId: ObjectId | string,
  types: string[],
  windowStart: Date
): Promise<number> {
  return db.collection("notifications").countDocuments({
    userId,
    type: { $in: types },
    createdAt: { $gte: windowStart },
  });
}
