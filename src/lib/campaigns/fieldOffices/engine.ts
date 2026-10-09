import type { Db } from "mongodb";
import type { CampaignFieldOffice } from "@/lib/db/types";
import { FIELD_OFFICES_COLLECTION } from "./commands";
import { fieldOfficeRegionEffect } from "./effects";
import { getFieldOfficeRules } from "./rules";

/**
 * Engine-side reader. One query loads every office for the turn; each race
 * then resolves a turnout multiplier per (candidate, region). Candidates are
 * keyed by the campaign's candidate id (character id, or NPP id), which is
 * `campaignStrengthLookupKey` on the election-candidate row.
 */

export type FieldOfficesByElection = Map<string, CampaignFieldOffice[]>;

const ENGINE_PROJECTION = {
  electionId: 1,
  candidateId: 1,
  countryId: 1,
  regionId: 1,
  electorateShare: 1,
  yieldFactor: 1,
  openedTurn: 1,
} as const;

export async function loadFieldOfficesByElection(db: Db): Promise<FieldOfficesByElection> {
  const rows = await db
    .collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION)
    .find({}, { projection: ENGINE_PROJECTION })
    .toArray();
  const byElection: FieldOfficesByElection = new Map();
  for (const row of rows) {
    const key = row.electionId.toString();
    const list = byElection.get(key);
    if (list) list.push(row);
    else byElection.set(key, [row]);
  }
  return byElection;
}

export async function loadFieldOfficesForElection(
  db: Db,
  electionId: { toString(): string }
): Promise<CampaignFieldOffice[]> {
  return db
    .collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION)
    .find(
      { electionId: electionId as CampaignFieldOffice["electionId"] },
      { projection: ENGINE_PROJECTION }
    )
    .toArray();
}

/**
 * `(candidateKey, regionId) → multiplier` for one race. Returns null when the
 * race has no offices, so callers can skip the per-candidate loop entirely.
 */
export function buildFieldOfficeMultiplier(
  offices: readonly CampaignFieldOffice[] | undefined,
  countryId: string,
  currentTurn: number
): ((candidateKey: string, regionId: string) => number) | null {
  if (!offices || offices.length === 0) return null;
  const rules = getFieldOfficeRules(countryId);
  if (!rules) return null;
  const grouped = new Map<string, CampaignFieldOffice[]>();
  for (const o of offices) {
    const key = `${o.candidateId.toString()}|${o.regionId}`;
    const list = grouped.get(key);
    if (list) list.push(o);
    else grouped.set(key, [o]);
  }
  const cache = new Map<string, number>();
  return (candidateKey, regionId) => {
    const key = `${candidateKey}|${regionId.toUpperCase()}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const list = grouped.get(key);
    const mult = list ? fieldOfficeRegionEffect(list, rules, currentTurn).multiplier : 1;
    cache.set(key, mult);
    return mult;
  };
}
