/**
 * One-Party-State Constraints
 *
 * Gating functions that prevent generic parliamentary code paths from
 * allowing non-ruling parties to take over a one-party state's
 * government. These are runtime guards, not compile-time, intended to be
 * called at the entry points of:
 *
 *   - coalition formation eligibility
 *   - VONC / no-confidence processing
 *   - government collapse triggers
 *   - candidate filing (executive and legislative)
 *   - coalition invites
 *
 * The gates derive ruling-party identity from `PoliticalParty.regimeStatus`
 * so the same five guards work for any country configured with
 * `governmentType: "onePartyState"`. CN is the only such country today;
 * adding a second is a pure config change.
 */
import type { CountryConfig } from "@/lib/constants/countries";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";

type ConfigShape = Pick<CountryConfig, "governmentType">;
type PartyShape = Pick<PoliticalParty, "regimeStatus"> | null;

function isOnePartyState(config: ConfigShape): boolean {
  return config.governmentType === "onePartyState";
}

// ── Predicates ─────────────────────────────────────────────────────────────

/** True when this party is the ruling party in a one-party state. */
export function isRulingParty(config: ConfigShape, party: PartyShape): boolean {
  return isOnePartyState(config) && party?.regimeStatus === "ruling";
}

/** True when this party is an approved (tolerated) party in a one-party state. */
export function isApprovedParty(config: ConfigShape, party: PartyShape): boolean {
  return isOnePartyState(config) && party?.regimeStatus === "approved";
}

/** True when this party is banned in a one-party state. Banned parties are inert. */
export function isBannedParty(config: ConfigShape, party: PartyShape): boolean {
  return isOnePartyState(config) && party?.regimeStatus === "banned";
}

// ── Gates ──────────────────────────────────────────────────────────────────

/**
 * In a one-party state, only the ruling party may form government.
 * For non-one-party countries, always returns true.
 */
export function canFormGovernment(config: ConfigShape, party: PartyShape): boolean {
  if (!isOnePartyState(config)) return true;
  return party?.regimeStatus === "ruling";
}

/**
 * In a one-party state, only the ruling party may move a VONC. The generic
 * VONC pathway is also skipped via `confidenceVoteMechanism: false`, but
 * this gate is the defence-in-depth check at the action surface.
 */
export function canTriggerNoConfidence(config: ConfigShape, moverParty: PartyShape): boolean {
  if (!isOnePartyState(config)) return true;
  return moverParty?.regimeStatus === "ruling";
}

/**
 * In a one-party state, government never collapses through generic
 * coalition-loss logic. Crisis-triggered transitions are a future
 * mechanic; this gate locks the standard path.
 */
export function canCollapseGovernment(config: ConfigShape): boolean {
  if (!isOnePartyState(config)) return true;
  return false;
}

/**
 * In a one-party state:
 *   - Executive offices (`premier`, `president`): ruling party only.
 *   - Non-executive offices: ruling or approved parties (banned is blocked).
 * For non-one-party countries, always returns true.
 *
 * Legacy office keys (`npcPremier`, the pre-2026-05-22 CN executive key)
 * are treated as executive for safety in case stale data is queried during
 * any future migration window.
 */
export function canFieldExecutiveCandidate(
  config: ConfigShape,
  party: PartyShape,
  officeType: string
): boolean {
  if (!isOnePartyState(config)) return true;
  const isExecutiveOffice =
    officeType === "premier" || officeType === "president" || officeType === "npcPremier";
  if (isExecutiveOffice) {
    return party?.regimeStatus === "ruling";
  }
  // Non-executive: anything except banned.
  return party?.regimeStatus !== "banned";
}

/**
 * In a one-party state, only the ruling party may invite others to a
 * coalition. For non-one-party countries, always returns true.
 */
export function canInviteToCoalition(config: ConfigShape, invitingParty: PartyShape): boolean {
  if (!isOnePartyState(config)) return true;
  return invitingParty?.regimeStatus === "ruling";
}

/**
 * In a one-party state, only ruling and approved parties may field
 * legislative candidates. Banned-party candidates and independents
 * (no recognised party affiliation) are blocked at filing.
 * Complements `canFieldExecutiveCandidate` which locks executive races
 * to the ruling party only.
 *
 * Non-OPS countries always return true (no gate).
 */
export function canFieldLegislativeCandidate(config: ConfigShape, party: PartyShape): boolean {
  if (!isOnePartyState(config)) return true;
  if (!party) return false;
  return party.regimeStatus === "ruling" || party.regimeStatus === "approved";
}

/**
 * Resolve the per-candidate vote-weight multiplier for the candidate's
 * party in the given country.
 *
 * - Non-OPS countries always return 1.0 (no-op).
 * - In OPS, returns the ruling/approved/independent/banned multiplier
 *   from the country's `opsVoteMultipliers` override, or
 *   `DEFAULT_OPS_VOTE_MULTIPLIERS` when no override is configured.
 * - Independents (no party document) are treated the same as banned —
 *   only ruling and approved parties earn vote weight.
 *
 * See `docs/plans/archive/2026-05/2026-05-27-ops-general-elections-design.md`.
 */
export function resolveRegimeMultiplier(
  config: Pick<CountryConfig, "governmentType" | "opsVoteMultipliers">,
  party: Pick<PoliticalParty, "regimeStatus"> | null
): number {
  if (config.governmentType !== "onePartyState") return 1.0;
  const mults = config.opsVoteMultipliers ?? DEFAULT_OPS_VOTE_MULTIPLIERS;
  if (!party) return mults.independent;
  switch (party.regimeStatus) {
    case "ruling":
      return mults.ruling;
    case "approved":
      return mults.approved;
    case "banned":
      return mults.banned;
    case null:
    case undefined:
      return mults.independent;
    default:
      return mults.independent;
  }
}
