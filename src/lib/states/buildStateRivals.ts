import { getPartyHex } from "@/lib/utils/politics";

export interface StateRival {
  partyId: string;
  abbreviation: string;
  color: string;
}

interface RivalRow {
  /** sequentialId-string of the party for this state-party row. */
  partyId: string;
  organization: number;
}

interface RivalParty {
  sequentialId: number;
  abbreviation: string;
  color?: string;
}

/**
 * Build the rival-party list for a state's Contest action: every party with a
 * state-party row in the state EXCEPT the subject party, mapped to
 * `{ partyId, abbreviation, color }` and sorted by Org% descending so the
 * strongest rival is the default target. Mirrors how the State Politics tab
 * derives its rival list. Pure — the caller supplies the already-fetched rows
 * and party docs.
 */
export function buildStateRivals({
  rows,
  parties,
  excludePartyKey,
}: {
  rows: RivalRow[];
  parties: RivalParty[];
  excludePartyKey: string;
}): StateRival[] {
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
  const orgByPartyId = new Map(rows.map((r) => [r.partyId, r.organization ?? 0]));
  const rivalIds = [
    ...new Set(rows.map((r) => r.partyId).filter((pid) => pid !== excludePartyKey)),
  ];
  return rivalIds
    .filter((pid) => partyMap.has(pid))
    .map((pid) => {
      const p = partyMap.get(pid)!;
      return {
        partyId: pid,
        abbreviation: p.abbreviation,
        color: getPartyHex(String(p.sequentialId), p.color),
      };
    })
    .sort((a, b) => (orgByPartyId.get(b.partyId) ?? 0) - (orgByPartyId.get(a.partyId) ?? 0));
}
