/**
 * Ticket-split crossover: derive Zweitstimmen (second votes) from Erststimmen.
 *
 * German voters split their ballot — the Erststimme backs a local candidate,
 * often on major-party pragmatism, while the Zweitstimme expresses a party
 * preference and decides the chamber. The classic case is the Leihstimme: a
 * CDU/CSU voter lends the FDP a second vote to keep a coalition partner over
 * the 5% hurdle.
 *
 * ## What this replaced, and why the model changed (#810)
 *
 * The previous table was keyed on demographic ARCHETYPE and was placeholder
 * data throughout: two of its five archetype ids existed nowhere else in the
 * codebase, and every rule targeted `cdu`/`spd`/`greens`/`afd`/`linke`, none of
 * which are party ids in any seed — the Greens, AfD and Linke are also
 * anachronisms in a 1953 world. It was never reached in any case, because
 * `computeZweitstimmen` has no demographic breakdown to pass: the vote tally
 * stores `totalVotes` per candidate and nothing per bucket. So the layer
 * always hit its default bucket, found no rules, and returned the first-vote
 * totals unchanged in every Land.
 *
 * Archetypes are also a retired vocabulary; the engine moved to Layer-1 census
 * buckets.
 *
 * The model is therefore PARTY-TO-PARTY, which is both what the data supports
 * and how ticket splitting is actually measured — post-election studies report
 * it as "x% of CDU first-vote voters gave their second vote to the FDP", not by
 * archetype.
 *
 * ## Rates
 *
 * Era-scoped, because the behaviour genuinely changed. Ticket splitting was
 * rare in the 1950s: the two-vote ballot only began in 1953 and voters
 * overwhelmingly cast both votes for the same party. Deliberate splitting grew
 * from the 1960s, and the FDP's survival on lent CDU/CSU second votes is a
 * feature of 1961 onward, not of 1953.
 *
 * Rates are conservative on purpose. They shift seats, so they are set at the
 * low end of the surveyed range rather than the headline figures.
 */

/** A single directed crossover: `rate` of `fromParty`'s first votes move. */
export interface PartyCrossoverRate {
  /** Party slug as in `DE_PARTY_SLUG_TO_NAME`, e.g. "cdu". */
  fromParty: string;
  toParty: string;
  /** Fraction of `fromParty`'s Erststimmen that switch. 0–0.3. */
  rate: number;
}

/**
 * 1953 West Germany. The two-vote ballot is one election old and split-ticket
 * voting is marginal, so only the two junior Adenauer partners draw anything,
 * and barely. A near-zero table here is the historically honest reading, not a
 * placeholder.
 */
export const CROSSOVER_RATES_1953: PartyCrossoverRate[] = [
  { fromParty: "cdu", toParty: "dp", rate: 0.02 },
  { fromParty: "cdu", toParty: "gbbhe", rate: 0.015 },
  { fromParty: "cdu", toParty: "fdp", rate: 0.02 },
  { fromParty: "spd", toParty: "gbbhe", rate: 0.01 },
];

/**
 * 1991 (post-reunification). The Leihstimme is established practice by now and
 * the PDS holds an eastern base that draws second votes from the SPD.
 */
export const CROSSOVER_RATES_1991: PartyCrossoverRate[] = [
  { fromParty: "cdu", toParty: "fdp", rate: 0.06 },
  { fromParty: "csu", toParty: "fdp", rate: 0.05 },
  { fromParty: "spd", toParty: "grn", rate: 0.05 },
  { fromParty: "spd", toParty: "pds", rate: 0.03 },
];

/**
 * Modern. Splitting is at its widest: Green second votes lent by SPD voters,
 * FDP second votes lent by CDU/CSU voters, and a Linke eastern base.
 */
export const CROSSOVER_RATES_MODERN: PartyCrossoverRate[] = [
  { fromParty: "cdu", toParty: "fdp", rate: 0.07 },
  { fromParty: "cdu", toParty: "grn", rate: 0.02 },
  { fromParty: "csu", toParty: "fdp", rate: 0.05 },
  { fromParty: "spd", toParty: "grn", rate: 0.07 },
  { fromParty: "spd", toParty: "lnk", rate: 0.03 },
  { fromParty: "grn", toParty: "spd", rate: 0.03 },
];

/** Crossover table for a seed preset. Unknown presets get the modern table. */
export function crossoverRatesForPreset(preset: string | undefined): PartyCrossoverRate[] {
  switch (preset) {
    case "1953-default":
      return CROSSOVER_RATES_1953;
    case "1991-default":
      return CROSSOVER_RATES_1991;
    default:
      return CROSSOVER_RATES_MODERN;
  }
}

export interface ErststimmeInput {
  /** Live party id (`sequentialId` as a string), as stored on the tally. */
  partyId: string;
  votes: number;
}

export interface ZweitstimmeOutput {
  partyId: string;
  votes: number;
}

/**
 * Derive Zweitstimmen from Erststimmen.
 *
 * `slugToPartyId` maps the rate table's slugs onto the live party ids on the
 * tally, and is built per world by `buildDEPartySlugToSeqId` — it only contains
 * parties that exist under the active preset, so a rule naming a party the
 * world does not have is skipped rather than inventing votes for it.
 *
 * Total ballots are conserved: crossover moves votes between parties and never
 * creates or destroys them. A party receiving votes but casting none of its own
 * still appears in the output.
 */
export function deriveZweitstimmen(
  erststimmen: ErststimmeInput[],
  rates: PartyCrossoverRate[],
  slugToPartyId: Record<string, string>
): ZweitstimmeOutput[] {
  const zweitstimmen: Record<string, number> = {};
  for (const e of erststimmen) zweitstimmen[e.partyId] = 0;

  // Resolve the slug-keyed table to live party ids once, dropping any rule
  // whose parties are absent under this preset.
  const resolved = rates.flatMap((rule) => {
    const from = slugToPartyId[rule.fromParty];
    const to = slugToPartyId[rule.toParty];
    if (!from || !to || from === to || rule.rate <= 0) return [];
    return [{ from, to, rate: rule.rate }];
  });

  const outgoingByParty = new Map<string, { to: string; rate: number }[]>();
  for (const rule of resolved) {
    const list = outgoingByParty.get(rule.from);
    if (list) list.push(rule);
    else outgoingByParty.set(rule.from, [rule]);
  }

  for (const { partyId: fromParty, votes } of erststimmen) {
    if (votes <= 0) continue;
    const outgoing = outgoingByParty.get(fromParty) ?? [];

    // Clamp so a party can never lend out more than it received.
    let totalRate = outgoing.reduce((sum, r) => sum + r.rate, 0);
    const scale = totalRate > 1 ? 1 / totalRate : 1;
    if (totalRate > 1) totalRate = 1;

    zweitstimmen[fromParty] += votes * (1 - totalRate);
    for (const rule of outgoing) {
      zweitstimmen[rule.to] = (zweitstimmen[rule.to] ?? 0) + votes * rule.rate * scale;
    }
  }

  return Object.entries(zweitstimmen).map(([partyId, votes]) => ({
    partyId,
    votes: Math.round(votes),
  }));
}

/**
 * Zweitstimmen must sum to the Erststimmen total — crossover redistributes
 * ballots, it does not mint them. Tolerates per-party rounding.
 */
export function validateZweitstimmenSum(
  erststimmen: ErststimmeInput[],
  zweitstimmen: ZweitstimmeOutput[],
  tolerance: number = 0.01
): boolean {
  const erstsumme = erststimmen.reduce((s, e) => s + e.votes, 0);
  const zweisumme = zweitstimmen.reduce((s, z) => s + z.votes, 0);
  if (erstsumme === 0) return zweisumme === 0;
  return Math.abs(erstsumme - zweisumme) / erstsumme <= tolerance;
}
