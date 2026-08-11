import type { GovernmentType } from "@/lib/constants/countries";

/** Passage rule for a national bill's chamber vote. */
export type BillPassRule = "majority" | "twoThirds";

/**
 * A bill that nationalizes or privatizes state assets — these face a
 * government-type-dependent passage bar (spec 2026-06-05). Policy provisions
 * carry a `legislationTypeId` and no `type`, so they read as `undefined` here.
 */
export function billHasNatPrivProvision(provisions: { type?: string }[] | undefined): boolean {
  return !!provisions?.some((p) => p.type === "nationalize" || p.type === "privatize");
}

/**
 * A bill that declares war. Unlike nat/priv this carries NO government-type
 * exemption — see `getBillPassRule`.
 */
export function billHasDeclareWar(provisions: { type?: string }[] | undefined): boolean {
  return !!provisions?.some((p) => p.type === "declare_war");
}

/**
 * Resolve the passage rule + a human label for a bill in a country. A nat/priv
 * bill needs a two-thirds supermajority everywhere EXCEPT one-party states (which
 * keep a simple majority). Every other bill keeps a simple majority.
 */
export function getBillPassRule(
  governmentType: GovernmentType | null | undefined,
  hasNatPriv: boolean,
  hasDeclareWar = false
): { rule: BillPassRule; label: string } {
  // War is war. The one-party-state exemption below exists because a single-party
  // legislature rubber-stamps economic policy; it is deliberately NOT extended to
  // a declaration of war, which needs two-thirds in every government type.
  if (hasDeclareWar) return { rule: "twoThirds", label: "two-thirds supermajority" };
  const twoThirds = hasNatPriv && governmentType !== "onePartyState";
  return twoThirds
    ? { rule: "twoThirds", label: "two-thirds supermajority" }
    : { rule: "majority", label: "simple majority" };
}

/**
 * Does a chamber tally clear the rule? `majority` is identical to the legacy
 * `didPass` (For must exceed Against; ties fail). `twoThirds` needs For to be at
 * least two-thirds of votes CAST (For + Against; abstentions excluded); no votes
 * cast fails.
 */
export function meetsBillPassRule(
  votesFor: number,
  votesAgainst: number,
  rule: BillPassRule
): boolean {
  if (rule === "twoThirds") {
    const cast = votesFor + votesAgainst;
    return cast > 0 && votesFor * 3 >= 2 * cast;
  }
  return votesFor > votesAgainst;
}
