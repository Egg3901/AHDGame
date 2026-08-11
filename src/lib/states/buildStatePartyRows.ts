export interface StatePartyRow {
  regionId: string;
  name: string;
  organization: number;
  politicalStrength: number;
  treasury: number;
  registrationPct: number;
  lean: number;
  chairName: string | null;
  nppCount: number;
  isTarget: boolean;
  hasPresence: boolean;
}

/**
 * Pure mapper that joins a country's regions with this national party's
 * `statePartyOrg` rows, NPP counts, chair names, priority targets and region
 * lean into one row per region. The route fetches the inputs; this stays pure
 * so the join logic is unit-tested without a database.
 */
export function buildStatePartyRows(input: {
  states: Array<{ _id: string; name: string }>;
  orgRows: Array<{
    stateId: string;
    organization?: number;
    politicalStrength?: number;
    treasury?: number;
    registration?: number;
    chairId?: string | null;
    hasPresence?: boolean;
  }>;
  nppCountByState: Record<string, number>;
  chairNameById: Record<string, string>;
  targetStateIds: string[];
  leanByState: Record<string, number>;
}): StatePartyRow[] {
  const orgByState = new Map(input.orgRows.map((o) => [o.stateId, o]));
  const targets = new Set(input.targetStateIds);
  return input.states.map((s) => {
    const o = orgByState.get(s._id);
    const chairId = o?.chairId ?? null;
    return {
      regionId: s._id,
      name: s.name,
      organization: o?.organization ?? 0,
      politicalStrength: o?.politicalStrength ?? 0,
      treasury: o?.treasury ?? 0,
      registrationPct: o?.registration ?? 0,
      lean: input.leanByState[s._id] ?? 0,
      chairName: chairId ? (input.chairNameById[chairId] ?? null) : null,
      nppCount: input.nppCountByState[s._id] ?? 0,
      isTarget: targets.has(s._id),
      hasPresence: o?.hasPresence ?? false,
    };
  });
}
