/**
 * Pure planner for reconciling a seceding region's parties to the new country's
 * configured major parties (the "only the nationalist party transfers" rule):
 *
 *  - The region-homed major (no presence outside the region — SNP, Plaid) moves
 *    WHOLESALE: its party doc flips country and takes a fresh id, leading as
 *    party 1. It is the party that defines the new nation.
 *  - Every OTHER region party — UK-wide majors (Labour) and non-majors alike —
 *    is INDEPENDENTIZED: its regional members become independent and no party
 *    doc survives in the new country. Players re-form those parties themselves.
 */

export interface RegionParty {
  sequentialId: number;
  /** True when the party has NO presence outside the seceding region. */
  isRegionHomed: boolean;
}

export interface PlanPartyRemapArgs {
  /** `COUNTRY_CONFIGS[newCountry].majorPartyIds` (party abbreviations). */
  majorPartyIds: string[];
  /** Parties with a member/official/org in the seceding region. */
  regionParties: RegionParty[];
  /** Old `sequentialId` → party abbreviation. */
  partyAbbrevById: Record<number, string>;
  /** First free `sequentialId` in the new country (assigned in ascending order). */
  nextSequentialId: number;
}

export interface PartyRemapPlan {
  /** Old seq ids of region-homed majors whose party doc flips country. */
  wholesale: number[];
  /** Old seq id → new seq id, for every transferred (wholesale) major. */
  idMap: Record<number, number>;
  /** Old seq ids of all other region parties; their members become independent. */
  independentized: number[];
}

export function planPartyRemap(args: PlanPartyRemapArgs): PartyRemapPlan {
  const { regionParties, partyAbbrevById, nextSequentialId } = args;
  const majors = new Set(args.majorPartyIds.map((a) => a.toUpperCase()));

  const plan: PartyRemapPlan = {
    wholesale: [],
    idMap: {},
    independentized: [],
  };

  let nextId = nextSequentialId;
  // Only the region-homed nationalist major (SNP/Plaid) transfers — it leads as
  // party 1. UK-wide majors (Labour) and non-majors are independentized; players
  // re-form them. Deterministic id assignment: ascending by old seq id.
  for (const party of [...regionParties].sort((a, b) => a.sequentialId - b.sequentialId)) {
    const abbrev = (partyAbbrevById[party.sequentialId] ?? "").toUpperCase();
    if (party.isRegionHomed && majors.has(abbrev)) {
      plan.idMap[party.sequentialId] = nextId++;
      plan.wholesale.push(party.sequentialId);
    } else {
      plan.independentized.push(party.sequentialId);
    }
  }
  return plan;
}
