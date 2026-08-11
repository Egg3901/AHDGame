import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";

/** Strip a country prefix from legacy slug-style party ids (`cn_ccp` → `ccp`). */
export function stripCountryPartyPrefix(partyRef: string): string {
  return partyRef.toLowerCase().replace(/^(cn|uk|us|de|jp|ie|br|ng)_/, "");
}

/**
 * Normalize a party id string to its canonical sequential-id form when it is
 * numeric (`"01"` → `"1"`). Non-numeric refs are returned lowercased.
 */
export function normalizePartyRef(partyRef: string): string {
  const trimmed = partyRef.trim();
  const asNum = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNum) && String(asNum) === trimmed.replace(/^0+(\d)/, "$1")) {
    return String(asNum);
  }
  return trimmed.toLowerCase();
}

export type PartyIdResolver = (partyRef: string | null | undefined) => string | null;

/**
 * Build a resolver that maps any party reference in `countryId` to the canonical
 * sequential-id string stored on characters (`"1"`, `"2"`, …) or
 * `"independent"`. Abbreviations (`CCP`) and legacy slugs (`cn_ccp`, `ccp`)
 * resolve through the country's party registry.
 */
export async function buildPartyIdResolver(db: Db, countryId: CountryId): Promise<PartyIdResolver> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .project<{ sequentialId: number; abbreviation?: string }>({
      sequentialId: 1,
      abbreviation: 1,
    })
    .toArray();

  const cache = new Map<string, string>();
  cache.set("independent", "independent");

  for (const party of parties) {
    const canon = String(party.sequentialId);
    cache.set(canon, canon);
    if (party.abbreviation) {
      cache.set(party.abbreviation.toLowerCase(), canon);
    }
  }

  return (partyRef) => {
    if (!partyRef) return null;
    if (partyRef === "independent") return "independent";

    const direct = cache.get(partyRef) ?? cache.get(partyRef.toLowerCase());
    if (direct) return direct;

    const normalized = normalizePartyRef(partyRef);
    const fromNormalized = cache.get(normalized);
    if (fromNormalized) return fromNormalized;

    const stripped = stripCountryPartyPrefix(partyRef);
    const fromStripped = cache.get(stripped);
    if (fromStripped) return fromStripped;

    // Last resort: return normalized numeric if it looks like a sequential id.
    const asNum = Number.parseInt(normalized, 10);
    if (Number.isFinite(asNum)) return String(asNum);

    return normalized;
  };
}

/** True when two party references denote the same party within a country. */
export async function partiesMatchInCountry(
  db: Db,
  countryId: CountryId,
  partyA: string | null | undefined,
  partyB: string | null | undefined
): Promise<boolean> {
  if (!partyA || !partyB) return false;
  const resolve = await buildPartyIdResolver(db, countryId);
  return resolve(partyA) === resolve(partyB);
}
