/**
 * Soft electoral hook for UK SCO/WAL/NIR Independence/Reunification Desire.
 *
 * When resolving a SCO/WAL/NIR general election, the region's
 * `independenceDesire` metric translates into a small vote-share nudge for the
 * legacy independence parties and a stepped bonus for the current First
 * Minister's party when the office is pursuing independence or reunification.
 *
 * See docs/design/uk-devolution-policy.md §"Soft electoral hook".
 *
 * Applies to: regionalCouncil (devolved parliament), commons (UK Westminster
 * within those regions), governor (FM / Mayor of London — LON skipped because
 * it has no devolution axis).
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { ElectedOfficial, GovernorOfficeState, PoliticalParty } from "@/lib/db/types";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import { getRegionalExecutiveOfficeKey } from "@/lib/constants/countries";
import { isUKDevolutionRegion } from "@/lib/constants/devolution";
import { applyFirstMinisterHighDesireBonus } from "@/lib/turn/election/rules/highDesireElectionBonus";

/** Election types where the hook is applied. */
const HOOKED_ELECTION_TYPES = new Set(["commons", "snap_commons", "regionalCouncil", "governor"]);

/** Per-region pro-independence + unionist-rival party slugs. */
const REGION_PARTY_MAP: Record<string, { proIndy: string[]; rivals: string[] }> = {
  SCO: { proIndy: ["uk_snp"], rivals: ["uk_conservative"] },
  WAL: { proIndy: ["uk_plaid"], rivals: ["uk_conservative"] },
  NIR: { proIndy: ["uk_sf"], rivals: ["uk_dup", "uk_uup"] },
};

/** Magnitude of the nudge: (desire − 50) × 0.001, clamped to ±0.05. */
function shareNudgeFromDesire(desire: number): number {
  const raw = (desire - 50) * 0.001;
  return Math.max(-0.05, Math.min(0.05, raw));
}

export interface CandidateLite {
  _id: import("mongodb").ObjectId;
  party: string;
}

export interface FirstMinisterBonusContext {
  firstMinisterPartyId: string | null;
  devolutionPolicy: DevolutionPolicy | null;
}

/**
 * Batch-load the office inputs used by the high-desire bonus. Call once before
 * resolving a group of elections, never once per election.
 */
export async function loadFirstMinisterBonusContexts(
  db: Db,
  regions: readonly string[]
): Promise<Map<string, FirstMinisterBonusContext>> {
  const normalizedRegions = [
    ...new Set(regions.map((region) => region.toUpperCase()).filter(isUKDevolutionRegion)),
  ];
  if (normalizedRegions.length === 0) return new Map();

  const [officeHolders, officeStates] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        {
          countryId: "UK",
          officeType: getRegionalExecutiveOfficeKey("UK"),
          state: { $in: normalizedRegions },
        },
        { projection: { state: 1, party: 1 } }
      )
      .toArray(),
    db
      .collection<GovernorOfficeState>("governorOfficeState")
      .find(
        { countryId: "UK", stateId: { $in: normalizedRegions } },
        { projection: { stateId: 1, devolutionPolicy: 1 } }
      )
      .toArray(),
  ]);

  const partyByRegion = new Map(
    officeHolders
      .filter((holder): holder is ElectedOfficial & { state: string } => !!holder.state)
      .map((holder) => [holder.state.toUpperCase(), holder.party ?? null])
  );
  const policyByRegion = new Map(
    officeStates.map((officeState) => [
      officeState.stateId.toUpperCase(),
      officeState.devolutionPolicy ?? null,
    ])
  );

  return new Map(
    normalizedRegions.map((region) => [
      region,
      {
        firstMinisterPartyId: partyByRegion.get(region) ?? null,
        devolutionPolicy: policyByRegion.get(region) ?? null,
      },
    ])
  );
}

/**
 * Apply the vote-share nudge in place to a copy of `effectiveVotes`. Returns
 * the new vote map. Pure; no DB I/O.
 *
 * @param effectiveVotes  candidateId → vote count
 * @param candidates      candidates with their party (sequentialId as string)
 * @param partyBySeq      sequentialId → slug map (resolves c.party to a slug)
 * @param desire          current independenceDesire value (0..100)
 * @param totalVotes      total votes cast (used to scale the share nudge)
 * @param region          stateId — SCO/WAL/NIR
 */
export function applyIndependenceDesireNudge(args: {
  effectiveVotes: Record<string, number>;
  candidates: CandidateLite[];
  partyBySeq: Map<string, string>;
  desire: number;
  totalVotes: number;
  region: string;
}): { adjustedVotes: Record<string, number>; nudgeApplied: number } {
  const { effectiveVotes, candidates, partyBySeq, desire, totalVotes, region } = args;
  const regionMap = REGION_PARTY_MAP[region.toUpperCase()];
  if (!regionMap) return { adjustedVotes: effectiveVotes, nudgeApplied: 0 };
  if (totalVotes <= 0) return { adjustedVotes: effectiveVotes, nudgeApplied: 0 };

  const nudge = shareNudgeFromDesire(desire);
  if (nudge === 0) return { adjustedVotes: effectiveVotes, nudgeApplied: 0 };

  // Bucket candidates by slug so we can split per-party totals among them.
  const proIndyByParty = new Map<string, CandidateLite[]>();
  const rivalByParty = new Map<string, CandidateLite[]>();
  for (const c of candidates) {
    const slug = partyBySeq.get(c.party);
    if (!slug) continue;
    if (regionMap.proIndy.includes(slug)) {
      const arr = proIndyByParty.get(slug) ?? [];
      arr.push(c);
      proIndyByParty.set(slug, arr);
    } else if (regionMap.rivals.includes(slug)) {
      const arr = rivalByParty.get(slug) ?? [];
      arr.push(c);
      rivalByParty.set(slug, arr);
    }
  }

  // No-op when no pro-indy candidate is running. The hook is a sentiment
  // *transfer* — without anyone to transfer to, leave the tally alone.
  if (proIndyByParty.size === 0) {
    return { adjustedVotes: effectiveVotes, nudgeApplied: 0 };
  }

  const adjusted: Record<string, number> = { ...effectiveVotes };

  // Pro-indy bonus: +nudge × totalVotes per party (summed across candidates,
  // distributed proportional to existing share within the party).
  const proIndyBonusPerParty = nudge * totalVotes;
  for (const cands of proIndyByParty.values()) {
    distributeWithinParty(adjusted, cands, proIndyBonusPerParty);
  }

  // Rival penalty: -nudge × totalVotes × (proIndyParties / rivalParties),
  // split equally per rival party. Conserves vote total: total bonus to
  // pro-indy = (n_proIndy) × nudge × totalVotes, total penalty to rivals =
  // (n_rivals) × (n_proIndy × nudge × totalVotes / n_rivals) = same.
  const numRivalParties = rivalByParty.size;
  const numProIndyParties = proIndyByParty.size;
  if (numRivalParties > 0) {
    const totalPenalty = -nudge * totalVotes * numProIndyParties;
    const rivalPenaltyPerParty = totalPenalty / numRivalParties;
    for (const cands of rivalByParty.values()) {
      distributeWithinParty(adjusted, cands, rivalPenaltyPerParty);
    }
  }

  // Final clamp: no candidate may end up negative — a large penalty applied
  // to a tiny vote share can otherwise produce nonsense numbers downstream.
  for (const id of Object.keys(adjusted)) {
    if (adjusted[id] < 0) adjusted[id] = 0;
  }

  return { adjustedVotes: adjusted, nudgeApplied: nudge };
}

/** Distribute `delta` across `cands` proportional to their existing votes.
 *  When all candidates have 0 votes, splits evenly. */
function distributeWithinParty(
  adjusted: Record<string, number>,
  cands: CandidateLite[],
  delta: number
): void {
  const ids = cands.map((c) => c._id.toString());
  const partyTotal = ids.reduce((s, id) => s + (adjusted[id] ?? 0), 0);
  if (partyTotal > 0) {
    for (const id of ids) {
      const share = (adjusted[id] ?? 0) / partyTotal;
      adjusted[id] = (adjusted[id] ?? 0) + delta * share;
    }
  } else {
    const perCandidate = delta / ids.length;
    for (const id of ids) {
      adjusted[id] = (adjusted[id] ?? 0) + perCandidate;
    }
  }
}

/**
 * Look up the slug → party-sequentialId map for UK parties. Used by callers
 * that have candidate.party as a sequentialId string but need to match
 * slug-keyed config. Returns a Map<sequentialIdString, slug>.
 */
export async function buildUKPartySlugMap(db: Db): Promise<Map<string, string>> {
  const ukParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "UK" })
    .project<{ sequentialId: number; name: string; abbreviation: string }>({
      sequentialId: 1,
      name: 1,
      abbreviation: 1,
    })
    .toArray();
  const map = new Map<string, string>();
  for (const p of ukParties) {
    // PoliticalParty has no canonical slug field — derive from name +
    // abbreviation. This covers every default UK party we care about for
    // the soft electoral hook (SNP/Plaid/SF, Con/DUP/UUP).
    const derived = deriveUKSlug(p.name, p.abbreviation);
    if (derived) map.set(String(p.sequentialId), derived);
  }
  return map;
}

function deriveUKSlug(name: string, abbr: string): string | null {
  const n = name.toLowerCase();
  if (abbr === "SNP" || n.includes("scottish national")) return "uk_snp";
  if (abbr === "PC" || n.includes("plaid")) return "uk_plaid";
  if (abbr === "SF" || n.includes("sinn")) return "uk_sf";
  if (abbr === "DUP" || n.includes("democratic unionist")) return "uk_dup";
  if (abbr === "UUP" || n.includes("ulster unionist")) return "uk_uup";
  if (abbr === "CON" || n.includes("conservative")) return "uk_conservative";
  if (abbr === "LAB" || n.includes("labour")) return "uk_labour";
  if (abbr === "LD" || n.includes("liberal")) return "uk_libdem";
  if (abbr === "GRN" || n.includes("green")) return "uk_green";
  if (abbr === "REF" || n.includes("reform")) return "uk_reform";
  return null;
}

/**
 * High-level entry: looks up the region's independenceDesire + party-slug
 * map, applies BOTH (a) the soft electoral transfer nudge and (b) the stepped
 * First Minister party bonus, in that order. Returns the input unchanged if
 * the election doesn't qualify.
 */
export async function maybeApplyIndependenceDesireHook(
  db: Db,
  args: {
    countryId: string;
    electionType: string;
    state?: string;
    effectiveVotes: Record<string, number>;
    candidates: CandidateLite[];
    totalVotes: number;
    bonusContext?: FirstMinisterBonusContext | null;
  }
): Promise<{
  adjustedVotes: Record<string, number>;
  nudgeApplied: number;
  firstMinisterBonusApplied: number;
}> {
  const noop = {
    adjustedVotes: args.effectiveVotes,
    nudgeApplied: 0,
    firstMinisterBonusApplied: 0,
  };
  const { countryId, electionType, state, effectiveVotes, candidates, totalVotes, bonusContext } =
    args;
  if (countryId !== "UK") return noop;
  if (!state || !isUKDevolutionRegion(state)) return noop;
  if (!HOOKED_ELECTION_TYPES.has(electionType)) return noop;

  // SP5: independenceDesire lives top-level on macroMetrics.
  const metric = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .findOne({ _id: state.toUpperCase() });
  const desire = metric?.independenceDesire?.value;
  if (desire == null) return noop;

  const partyBySeq = await buildUKPartySlugMap(db);

  // Step 1: vote-share transfer (existing soft electoral hook).
  const transfer = applyIndependenceDesireNudge({
    effectiveVotes,
    candidates,
    partyBySeq,
    desire,
    totalVotes,
    region: state,
  });

  // Step 2: additive vote gain for the qualifying First Minister's party,
  // applied on top of the already-transferred tally with no rival penalty.
  const boost = applyFirstMinisterHighDesireBonus({
    effectiveVotes: transfer.adjustedVotes,
    candidates: candidates.map((candidate) => ({
      id: candidate._id.toString(),
      partyId: candidate.party,
    })),
    desire,
    region: state,
    firstMinisterPartyId: bonusContext?.firstMinisterPartyId ?? null,
    devolutionPolicy: bonusContext?.devolutionPolicy ?? null,
  });

  return {
    adjustedVotes: boost.adjustedVotes,
    nudgeApplied: transfer.nudgeApplied,
    firstMinisterBonusApplied: boost.bonusApplied,
  };
}
