import type { CongressionalDistrict, DistrictSquares } from "@/lib/db/types/congressionalDistrict";

export interface DistrictSquareView {
  index: number;
  cd: string;
  squares: DistrictSquares;
  netLean: number;
  greyShare: number;
  holderParty: string | null;
  holderName: string | null;
}

/**
 * Join the static district cd-codes (sorted) with the live square docs by index
 * (sorted cd i ⇒ district index i+1) and resolve holder names. Indices without a
 * doc are omitted (e.g. seed not yet run for that state).
 */
export function buildDistrictSquareViews(
  staticCds: string[],
  docs: CongressionalDistrict[],
  holderNames: Record<string, string>
): DistrictSquareView[] {
  const byIndex = new Map<number, CongressionalDistrict>();
  for (const d of docs) byIndex.set(d.index, d);

  const sortedCds = [...staticCds].sort((a, b) => a.localeCompare(b));
  const views: DistrictSquareView[] = [];
  sortedCds.forEach((cd, i) => {
    const index = i + 1;
    const d = byIndex.get(index);
    if (!d) return;
    // NPP-held seats key off holderNppId (id in `npps`); player seats off
    // holderCharacterId. holderNames is keyed by whichever id string applies.
    const holderId = d.holderCharacterId ?? d.holderNppId ?? null;
    const holderName = holderId ? (holderNames[String(holderId)] ?? null) : null;
    views.push({
      index,
      cd,
      squares: d.squares,
      netLean: d.netLean,
      greyShare: d.greyShare,
      holderParty: d.holderParty,
      holderName,
    });
  });
  return views;
}
