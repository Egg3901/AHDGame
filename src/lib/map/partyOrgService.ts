import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { UK_REGIONS } from "@/lib/constants/uk";

export interface MapPartyOrgState {
  leadingParty: string;
  leadColor: string;
  organization: number;
  tooltip: string[];
}

const VACANT_COLOR = "#334155";
const DEFAULT_COLORS: Record<string, string> = {
  democrat: "#3B82F6",
  republican: "#EF4444",
  independent: "#9CA3AF",
  LAB: "#E4003B",
  CON: "#0087DC",
  LD: "#FAA61A",
  SNP: "#FFF95D",
  PC: "#3F8428",
  GREEN: "#02A95B",
  REF: "#12B6CF",
};

function partyColor(partyId: string, storedColor?: string): string {
  return DEFAULT_COLORS[partyId] ?? storedColor ?? "#8B5CF6";
}

export async function computePartyOrgMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapPartyOrgState>> {
  // Fetch all parties for this country
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();

  // Build lookup maps using ONLY sequentialId (the current party identifier)
  // Old slug-based partyIds are stale data and should be filtered out
  const partyColorMap = new Map<string, string>();
  const partyNameMap = new Map<string, string>();
  const validPartyIds = new Set<string>();

  for (const p of parties) {
    const seqIdKey = String(p.sequentialId);
    const color = partyColor(seqIdKey, p.color);

    partyColorMap.set(seqIdKey, color);
    partyNameMap.set(seqIdKey, p.name);
    validPartyIds.add(seqIdKey);
  }

  // Fetch statePartyOrg records for this country
  // Filter by countryId to ensure we only get orgs for the correct country
  const allPartyOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId })
    .toArray();

  // Filter out any orgs whose partyId is not a valid sequentialId for this country
  // This removes stale records with old slug-based partyIds
  const filteredOrgs = allPartyOrgs.filter((org) => validPartyIds.has(org.partyId));

  if (countryId === COUNTRY_CONFIGS.UK.id) {
    return buildPartyOrgUK(filteredOrgs, partyColorMap, partyNameMap);
  }
  return buildPartyOrg(filteredOrgs, partyColorMap, partyNameMap);
}

function buildPartyOrg(
  orgs: StatePartyOrg[],
  partyColorMap: Map<string, string>,
  partyNameMap: Map<string, string>
): Record<string, MapPartyOrgState> {
  const orgByState = new Map<string, StatePartyOrg[]>();
  for (const org of orgs) {
    const list = orgByState.get(org.stateId) ?? [];
    list.push(org);
    orgByState.set(org.stateId, list);
  }
  const result: Record<string, MapPartyOrgState> = {};
  for (const [stateId, list] of orgByState.entries()) {
    const sorted = [...list].sort((a, b) => b.organization - a.organization);
    const top = sorted[0];
    if (!top || top.organization === 0) continue;
    const runnerUp = sorted[1];
    const color = partyColorMap.get(top.partyId) ?? VACANT_COLOR;
    const name = partyNameMap.get(top.partyId) ?? top.partyId;
    result[stateId] = {
      leadingParty: top.partyId,
      leadColor: color,
      organization: top.organization,
      tooltip: [
        `${name}: ${top.organization}`,
        ...(runnerUp ? [`Lead: +${(top.organization - runnerUp.organization).toFixed(0)}`] : []),
        ...sorted
          .slice(0, 4)
          .filter((o) => o.organization > 0)
          .map((o) => `${partyNameMap.get(o.partyId) ?? o.partyId}: ${o.organization}`),
      ],
    };
  }
  return result;
}

function buildPartyOrgUK(
  orgs: StatePartyOrg[],
  partyColorMap: Map<string, string>,
  partyNameMap: Map<string, string>
): Record<string, MapPartyOrgState> {
  const orgByState = new Map<string, StatePartyOrg[]>();
  for (const org of orgs) {
    const list = orgByState.get(org.stateId) ?? [];
    list.push(org);
    orgByState.set(org.stateId, list);
  }
  const result: Record<string, MapPartyOrgState> = {};
  for (const region of UK_REGIONS) {
    const stateId = region.id;
    const list = orgByState.get(stateId) ?? [];
    const sorted = [...list].sort((a, b) => b.organization - a.organization);
    const top = sorted[0];
    if (!top || top.organization === 0) continue;
    const runnerUp = sorted[1];
    const color = partyColorMap.get(top.partyId) ?? VACANT_COLOR;
    const name = partyNameMap.get(top.partyId) ?? top.partyId;
    result[region.id] = {
      leadingParty: top.partyId,
      leadColor: color,
      organization: top.organization,
      tooltip: [
        `${name}: ${top.organization}`,
        ...(runnerUp ? [`Lead: +${(top.organization - runnerUp.organization).toFixed(0)}`] : []),
        ...sorted
          .slice(0, 4)
          .filter((o) => o.organization > 0)
          .map((o) => `${partyNameMap.get(o.partyId) ?? o.partyId}: ${o.organization}`),
      ],
    };
  }
  return result;
}
