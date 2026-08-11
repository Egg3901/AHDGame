import type { Db } from "mongodb";
import type { Bill, NationalizeProvision } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporateSector } from "@/lib/db/types";
import type { SectorScope } from "./sectorScope";

/** What a signed sector-wide nationalization bill authorized. */
export interface EnactedSectorTaking {
  scope: SectorScope;
  carveFraction: number;
}

export function sectorTakingKey(countryId: string, sectorType: string): string {
  return `${countryId}:${sectorType}`;
}

/**
 * True when enacted law authorized absorbing private corp holdings (full carve).
 * Unowned-only and partial carves leave private corps legitimate.
 */
export function enactedLawAllowsCorpMerge(taking: EnactedSectorTaking | undefined): boolean {
  if (!taking) return false;
  if (taking.scope === "unowned") return false;
  if (taking.carveFraction < 1) return false;
  return true;
}

function takingFromProvision(p: NationalizeProvision): EnactedSectorTaking | null {
  if (!p.targetSectorType) return null;
  const snap = p.nationalizationSnapshot;
  if (snap?.kind === "sector") {
    return { scope: snap.sector.scope, carveFraction: snap.sector.carveFraction };
  }
  return {
    scope: p.sectorScope ?? "all",
    carveFraction: p.sectorCarveFraction ?? 1,
  };
}

/** Latest enacted sector-wide taking per (countryId, sectorType) from signed bills. */
export async function loadEnactedSectorWideTakingsFromBills(
  db: Db
): Promise<Map<string, EnactedSectorTaking>> {
  const bills = await db
    .collection<Bill>("bills")
    .find(
      {
        status: "signed",
        provisions: { $elemMatch: { type: "nationalize", targetSectorType: { $exists: true } } },
      },
      { projection: { countryId: 1, enactedAt: 1, provisions: 1 } }
    )
    .toArray();

  const map = new Map<string, EnactedSectorTaking & { enactedAt?: Date }>();
  for (const bill of bills) {
    const countryId = bill.countryId;
    if (!countryId) continue;
    for (const p of bill.provisions ?? []) {
      if (p.type !== "nationalize") continue;
      const taking = takingFromProvision(p);
      if (!taking) continue;
      const key = sectorTakingKey(countryId, p.targetSectorType!);
      const existing = map.get(key);
      if (
        !existing ||
        (bill.enactedAt && (!existing.enactedAt || bill.enactedAt > existing.enactedAt))
      ) {
        map.set(key, { ...taking, enactedAt: bill.enactedAt });
      }
    }
  }
  return map;
}

/** Scope stamped on nat-corp sectors at enactment (fallback when bill query misses). */
export async function loadSectorWideTakingsFromNatCorpSectors(
  db: Db,
  nationalCorpIds: ReadonlySet<string>
): Promise<Map<string, EnactedSectorTaking>> {
  const rows = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { sectorNationalizationScope: { $exists: true } },
      {
        projection: {
          countryId: 1,
          sectorType: 1,
          corporationId: 1,
          sectorNationalizationScope: 1,
          sectorNationalizationCarveFraction: 1,
        },
      }
    )
    .toArray();

  const map = new Map<string, EnactedSectorTaking>();
  for (const s of rows) {
    if (!nationalCorpIds.has(s.corporationId.toString())) continue;
    if (!s.sectorNationalizationScope || !s.countryId) continue;
    const key = sectorTakingKey(s.countryId as CountryId, s.sectorType);
    map.set(key, {
      scope: s.sectorNationalizationScope,
      carveFraction: s.sectorNationalizationCarveFraction ?? 1,
    });
  }
  return map;
}

/** Union of bill enactments (preferred) and sector-stamped scope. */
export async function loadSectorWideTakingAuthority(
  db: Db,
  nationalCorpIds: ReadonlySet<string>
): Promise<Map<string, EnactedSectorTaking>> {
  const [fromSectors, fromBills] = await Promise.all([
    loadSectorWideTakingsFromNatCorpSectors(db, nationalCorpIds),
    loadEnactedSectorWideTakingsFromBills(db),
  ]);
  const merged = new Map(fromSectors);
  for (const [k, v] of fromBills) merged.set(k, v);
  return merged;
}
