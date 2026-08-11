import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  ESTATE_PORTFOLIO_BY_COUNTRY,
  getPortfolioCatalog,
  isAbroadSited,
} from "@/lib/constants/cabinetEstates";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import type { CabinetEstate } from "@/lib/db/types/cabinetEstate";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic starting roster for one (country, portfolio) seat. Pure. */
export function buildPortfolioRoster(
  countryId: string,
  positionId: string,
  portfolioKey: string,
  regionIds: string[],
  otherCountryIds: string[],
  currentTurn: number
): Omit<CabinetEstate, "_id">[] {
  const catalog = getPortfolioCatalog(portfolioKey);
  if (catalog.length === 0) return [];
  const isForeign = isAbroadSited(portfolioKey);
  const sites = isForeign ? otherCountryIds : regionIds;
  if (sites.length === 0) return [];

  const r = rng(hash(`${countryId}:${portfolioKey}`));
  const out: Omit<CabinetEstate, "_id">[] = [];
  // 3-5 estates per seat.
  const count = 3 + Math.floor(r() * 3);
  const usedForeign = new Set<string>(); // `${archetypeId}@${host}`
  for (let i = 0; i < count; i++) {
    const arch = catalog[Math.floor(r() * catalog.length)];
    let siteId: string;
    if (isForeign) {
      // Pick a host not already hosting this archetype; skip if none free.
      const candidates = sites.filter((s) => !usedForeign.has(`${arch.id}@${s}`));
      if (candidates.length === 0) continue;
      siteId = candidates[Math.floor(r() * candidates.length)];
      usedForeign.add(`${arch.id}@${siteId}`);
    } else {
      siteId = sites[Math.floor(r() * sites.length)];
    }
    out.push({
      countryId: countryId as CountryId,
      portfolioKey,
      positionId,
      archetypeId: arch.id,
      name: arch.label,
      icon: arch.icon,
      fundingLevel: "standard",
      tier: Math.floor(r() * 2) as 0 | 1,
      condition: 100,
      outputBase: arch.outputBase,
      upkeepBase: arch.upkeepBase,
      siteScope: isForeign ? "country" : "region",
      siteId,
      createdTurn: currentTurn,
    });
  }
  return out;
}

/** Idempotent: seeds a (country, portfolio) roster only when it has zero estates. */
export async function seedCabinetEstates(db: Db): Promise<void> {
  const col = getCabinetEstatesCollection(db);
  const allCountryIds = Object.keys(COUNTRY_CONFIGS) as CountryId[];

  // Every already-populated (country, seat) pair in one grouped read, replacing
  // a countDocuments per seat. `$group` over the two keys is exactly the ">0
  // rows exist" question the old per-seat count asked, just asked once.
  const populated = new Set<string>(
    (
      await col
        .aggregate<{ _id: { countryId: string; positionId: string } }>([
          { $group: { _id: { countryId: "$countryId", positionId: "$positionId" } } },
        ])
        .toArray()
    ).map((r) => `${r._id.countryId}\u0000${r._id.positionId}`)
  );

  // Rosters are staged and inserted once at the end. Safe because
  // buildPortfolioRoster is pure and seeds its own RNG from (country,
  // portfolio), so a row's contents never depend on what was inserted before
  // it — only on regionIds, which is still read per country below.
  const staged: CabinetEstate[] = [];

  for (const countryId of allCountryIds) {
    const seats = ESTATE_PORTFOLIO_BY_COUNTRY[countryId];
    if (!seats) continue;
    const regions = await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray();
    const regionIds = regions.map((s) => String(s._id));
    const otherCountryIds = allCountryIds.filter(
      (c) => c !== countryId && ESTATE_PORTFOLIO_BY_COUNTRY[c]
    );
    for (const [positionId, portfolioKey] of Object.entries(seats)) {
      if (populated.has(`${countryId}\u0000${positionId}`)) continue;
      const roster = buildPortfolioRoster(
        countryId,
        positionId,
        portfolioKey,
        regionIds,
        otherCountryIds,
        1
      );
      if (roster.length === 0) continue;
      staged.push(...roster.map((e) => ({ _id: new ObjectId(), ...e })));
    }
  }

  if (staged.length > 0) await col.insertMany(staged);
}
