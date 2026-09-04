/**
 * Eligibility policy for leadership roles.
 *
 * Each `LeadershipRole` has one policy that determines whether a given party
 * (and by extension a seated chamber member of that party) may run for, or
 * vote in, that role's election. The orchestrator, action handlers, and API
 * routes all evaluate the same policy instead of computing party-slug sets
 * inline.
 *
 * Behaviour by kind:
 * - `any-seated`         — every party with at least one seat in the chamber
 *                          (Speaker, Bundestagspräsident).
 * - `largest-single-party` — only the chamber's largest single party
 *                            (Pro Tempore, Majority Leader/Whip).
 * - `non-coalition`      — every chamber party not in the majority bloc
 *                          (Minority Leader/Whip).
 * - `majority-coalition` — every party in the majority bloc. Kept expressible
 *                          for future use; currently no role uses it.
 */
import type { LeadershipRole } from "@/lib/db/types";
import type { Bloc } from "../blocs";

export type RoleEligibilityPolicy =
  | { kind: "any-seated" }
  | { kind: "largest-single-party" }
  | { kind: "non-coalition" }
  | { kind: "majority-coalition" };

export const POLICY_BY_ROLE: Record<LeadershipRole, RoleEligibilityPolicy> = {
  speaker_of_the_house: { kind: "any-seated" },
  // Pro Tempore is a majority-party office: the largest single party runs,
  // votes, and holds it. A sitting Pro Tempore who leaves that party is
  // vacated by `reconcileLeadershipPartyEligibility`.
  president_pro_tempore: { kind: "largest-single-party" },
  speaker_of_the_bundestag: { kind: "any-seated" },
  chair_npcsc: { kind: "any-seated" },
  chair_cppcc: { kind: "largest-single-party" },
  speaker_ng_reps: { kind: "any-seated" },
  president_ng_senate: { kind: "any-seated" },
  majority_leader_house: { kind: "largest-single-party" },
  majority_leader_senate: { kind: "largest-single-party" },
  majority_whip_house: { kind: "largest-single-party" },
  majority_whip_senate: { kind: "largest-single-party" },
  minority_leader_house: { kind: "non-coalition" },
  minority_leader_senate: { kind: "non-coalition" },
  minority_whip_house: { kind: "non-coalition" },
  minority_whip_senate: { kind: "non-coalition" },
};

export interface ChamberLeadershipContext {
  /** Every party with at least one seat in the chamber (excludes "__vacant__"). */
  allChamberPartySlugs: Set<string>;
  /** Largest single party slug, or null if the chamber is empty. */
  majorityParty: string | null;
  /** Coalition holding the majority, or null if no bloc was computed. */
  majorityBloc: Bloc | null;
  /**
   * Human-readable name of the majority party (used in `describeEligibility`).
   * Falls back to the slug when no party document is available.
   */
  majorityPartyName?: string;
}

/** Build a context object from a chamber composition. */
export function buildChamberLeadershipContext(input: {
  composition: Array<{ party: string; partyName?: string }>;
  majorityParty: string | null;
  majorityBloc: Bloc | null;
}): ChamberLeadershipContext {
  const allChamberPartySlugs = new Set(
    input.composition.map((c) => c.party).filter((p) => p !== "__vacant__")
  );
  const majorityPartyName =
    input.composition.find((c) => c.party === input.majorityParty)?.partyName ??
    input.majorityParty ??
    undefined;
  return {
    allChamberPartySlugs,
    majorityParty: input.majorityParty,
    majorityBloc: input.majorityBloc,
    majorityPartyName,
  };
}

/** True if `partySlug` may run for or vote in a role governed by `policy`. */
export function isPartyEligible(
  policy: RoleEligibilityPolicy,
  partySlug: string | null | undefined,
  ctx: ChamberLeadershipContext
): boolean {
  if (!partySlug) return false;
  switch (policy.kind) {
    case "any-seated":
      return ctx.allChamberPartySlugs.has(partySlug);
    case "largest-single-party":
      return ctx.majorityParty !== null && partySlug === ctx.majorityParty;
    case "majority-coalition":
      return ctx.majorityBloc?.partySlugs.has(partySlug) ?? false;
    case "non-coalition":
      return (
        ctx.allChamberPartySlugs.has(partySlug) &&
        !(ctx.majorityBloc?.partySlugs.has(partySlug) ?? false)
      );
  }
}

/** Set of party slugs eligible under `policy` given the chamber state. */
export function eligiblePartySlugsFor(
  policy: RoleEligibilityPolicy,
  ctx: ChamberLeadershipContext
): Set<string> {
  switch (policy.kind) {
    case "any-seated":
      return new Set(ctx.allChamberPartySlugs);
    case "largest-single-party":
      return ctx.majorityParty ? new Set([ctx.majorityParty]) : new Set();
    case "majority-coalition":
      return new Set(ctx.majorityBloc?.partySlugs ?? []);
    case "non-coalition": {
      const out = new Set(ctx.allChamberPartySlugs);
      for (const slug of ctx.majorityBloc?.partySlugs ?? []) out.delete(slug);
      return out;
    }
  }
}

/** Human-readable label used in API error messages and UI hints. */
export function describeEligibility(
  policy: RoleEligibilityPolicy,
  ctx: ChamberLeadershipContext
): string {
  switch (policy.kind) {
    case "any-seated":
      return "any seated chamber member";
    case "largest-single-party":
      return `the majority party (${ctx.majorityPartyName ?? ctx.majorityParty ?? "current majority"})`;
    case "majority-coalition":
      return `the majority coalition (${ctx.majorityBloc?.displayName ?? "current majority"})`;
    case "non-coalition":
      return "non-majority-coalition parties";
  }
}
