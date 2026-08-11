import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CongressionalDistrict,
  PoliticalParty,
  State,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import {
  aggregatePoolPercents,
  derivePoolPercentsFromPvi,
  getPartyPool,
  MIN_TWO_PARTY_PERCENT,
  type Pool,
} from "./pools";
import { buildDistrictDocs } from "./buildDistrictDocs";
import { loadCookPvi } from "./loadCookPvi";

/**
 * Build CongressionalDistrict docs for every state of `countryId` (or just
 * `stateIds` when given). DB reads only; no writes. Multiparty pool binning by
 * economicPosition; partyId keyed on sequentialId.
 */
export async function buildDistrictDocsForStates(
  db: Db,
  countryId: CountryId,
  now: Date,
  stateIds?: string[]
): Promise<CongressionalDistrict[]> {
  const stateFilter =
    stateIds && stateIds.length > 0 ? { countryId, _id: { $in: stateIds } } : { countryId };
  const states = (await db
    .collection<State>("states")
    .find(stateFilter as Partial<State>)
    .toArray()) as State[];
  const parties = (await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId } as Partial<PoliticalParty>)
    .toArray()) as PoliticalParty[];
  const orgRows = (await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId } as Partial<StatePartyOrg>)
    .toArray()) as StatePartyOrg[];
  const poolDocs = (await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find({ countryId } as Partial<StateRegistrationPool>)
    .toArray()) as StateRegistrationPool[];

  const poolByParty = new Map<string, Pool>();
  for (const p of parties) {
    const pool = getPartyPool({
      economicPosition: p.economicPosition,
      pool: (p as { pool?: Pool }).pool,
    });
    poolByParty.set(String(p.sequentialId), pool);
    poolByParty.set(String(p._id), pool);
    if (p.abbreviation) poolByParty.set(p.abbreviation, pool);
  }
  const poolOf = (partyId: string): Pool => poolByParty.get(String(partyId)) ?? "grey";

  const poolDocByState = new Map<string, StateRegistrationPool>();
  for (const d of poolDocs) poolDocByState.set(d.stateId, d);

  const out: CongressionalDistrict[] = [];
  for (const state of states) {
    const stateId = String(state._id);
    const n = state.houseDistricts ?? 0;
    if (n <= 0) continue;
    // Prefer the normalized `registration` pool when present (set by the
    // registration-lane seed), but fall back to `organization` — the party-org
    // presence that `generateStatePartyOrg` always seeds with the state's lean
    // baked in. Without this fallback every state reads 0 left/right at seed time
    // (registration is unset) and collapses to the neutral grey default.
    const rows = orgRows
      .filter((r) => r.stateId === stateId)
      .map((r) => ({ partyId: r.partyId, registration: r.registration ?? r.organization }));
    const pvis = loadCookPvi(stateId, n);
    let poolPercents = aggregatePoolPercents(rows, poolOf, poolDocByState.get(stateId) ?? null);
    // No real two-party registration signal (e.g. 1991 seeds with no party-org
    // rows) ⇒ derive from PVI/neutral so the budget isn't shipped all-grey.
    if (poolPercents.left + poolPercents.right < MIN_TWO_PARTY_PERCENT) {
      poolPercents = derivePoolPercentsFromPvi(pvis);
    }
    out.push(...buildDistrictDocs({ countryId, stateId, n, poolPercents, pvis, now }));
  }
  return out;
}
