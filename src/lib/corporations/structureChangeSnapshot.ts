import type { Shareholder } from "@/lib/db/types";
import type { ShareTradeStructureChangeHolder } from "@/lib/db/types/shareTradeHistory";

export interface StructureChangeNameMaps {
  characters: ReadonlyMap<string, string>;
  imperial: ReadonlyMap<string, string>;
  corporations: ReadonlyMap<string, string>;
  /** Optional — index fund display names keyed by fund id. */
  funds?: ReadonlyMap<string, string>;
}

/**
 * Collapse a shareholder array + public float into the flat, presentation-
 * ready row format used by ShareTradeHistory.structureChange. Rows with zero
 * shares are dropped. Percents are fractions of `totalShares` (not 0–100),
 * rounded to 6 decimals so trivial rounding noise doesn't bloat the log.
 * When `totalShares <= 0` an empty array is returned rather than dividing
 * by zero.
 */
export function buildStructureChangeHolderList(
  shareholders: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[],
  totalShares: number,
  publicFloat: number,
  names: StructureChangeNameMaps
): ShareTradeStructureChangeHolder[] {
  if (totalShares <= 0) return [];
  const out: ShareTradeStructureChangeHolder[] = [];
  const pct = (n: number) => Math.round((n / totalShares) * 1_000_000) / 1_000_000;
  for (const h of shareholders) {
    const shares = h.shares ?? 0;
    if (shares <= 0) continue;
    if (h.characterId) {
      const id = h.characterId.toString();
      out.push({
        kind: "character",
        ownerId: id,
        name: names.characters.get(id) ?? "Character",
        shares,
        percent: pct(shares),
      });
    } else if (h.imperialCharacterId) {
      const id = h.imperialCharacterId.toString();
      out.push({
        kind: "imperial",
        ownerId: id,
        name: names.imperial.get(id) ?? "Imperial Character",
        shares,
        percent: pct(shares),
      });
    } else if (h.corporationId) {
      const id = h.corporationId.toString();
      out.push({
        kind: "corporation",
        ownerId: id,
        name: names.corporations.get(id) ?? "Corporation",
        shares,
        percent: pct(shares),
      });
    } else if (h.fundId) {
      const id = h.fundId.toString();
      out.push({
        kind: "fund",
        ownerId: id,
        name: names.funds?.get(id) ?? "Index Fund",
        shares,
        percent: pct(shares),
      });
    }
  }
  if (publicFloat > 0) {
    out.push({
      kind: "public_float",
      name: "Public Float",
      shares: publicFloat,
      percent: pct(publicFloat),
    });
  }
  return out;
}
