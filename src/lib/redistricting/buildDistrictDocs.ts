import type { CountryId } from "@/lib/constants/countries";
import type { CongressionalDistrict } from "@/lib/db/types/congressionalDistrict";
import type { PoolPercents } from "./pools";
import { computeSquareBudget } from "./budget";
import { buildShapeTilts, buildDefaultSquares } from "./defaultMap";

export interface BuildDistrictDocsInput {
  countryId: CountryId;
  stateId: string;
  n: number;
  poolPercents: PoolPercents;
  pvis: (number | null)[] | null;
  now: Date;
}

export function buildDistrictDocs(input: BuildDistrictDocsInput): CongressionalDistrict[] {
  const { countryId, stateId, n, poolPercents, pvis, now } = input;
  const budget = computeSquareBudget(poolPercents, n);
  const tilts = buildShapeTilts(stateId, n, pvis);
  const squares = buildDefaultSquares(n, budget, tilts);

  const usedPvi =
    Array.isArray(pvis) && pvis.length === n && pvis.some((p) => p != null && p !== 0);

  return squares.map((sq, i) => {
    const index = i + 1;
    return {
      _id: `${countryId}_${stateId}_${index}`,
      countryId,
      stateId,
      index,
      squares: sq,
      netLean: sq.right - sq.left,
      greyShare: sq.grey / 16,
      holderCharacterId: null,
      holderNppId: null,
      holderParty: null,
      source: usedPvi ? "cookpvi" : "registration",
      lastRedrawnCensus: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}
