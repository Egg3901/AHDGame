import type { Bond } from "@/lib/db/types";
import type { ObjectId } from "mongodb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

/**
 * Max share of a single sovereign bond issue any one holder may hold
 * (carry-trade fix, #3064). One player absorbing ~an entire country's sovereign
 * series (1.05T CNY of one issue) was a core amplifier of the exploit — the bond
 * position is where the minted savings were laundered and concentrated. Only
 * sovereign issues are capped; corporate bonds are unaffected.
 */
export const SOVEREIGN_BOND_HOLDER_CAP = 0.25;

type HolderField = "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "nppId";

/** Units a given holder already holds in this bond (0 if none). */
export function currentHolderUnits(bond: Bond, field: HolderField, id: ObjectId): number {
  const holders = bond.holders ?? [];
  for (const h of holders) {
    const hid = h[field];
    if (hid && String(hid) === String(id)) return h.units ?? 0;
  }
  return 0;
}

/**
 * Returns an error string if buying `addUnits` would push this holder over the
 * per-holder sovereign cap, else null. No-op for non-sovereign bonds or when the
 * issue size is unknown.
 */
export function sovereignBondCapError(
  bond: Bond,
  field: HolderField,
  id: ObjectId,
  addUnits: number
): string | null {
  if (bond.issuerType !== "sovereign") return null;
  const totalIssued = bond.totalIssued ?? 0;
  if (totalIssued <= 0) return null;
  // `totalIssued` is stored in currency (dollars); `currentHolderUnits`/`addUnits`
  // are unit counts (each unit = BOND_UNIT_FACE_VALUE currency). Convert the cap to
  // units before comparing, else the limit is ~BOND_UNIT_FACE_VALUE times too loose
  // and a single holder can absorb an entire sovereign issue (the #3064 amplifier).
  const faceValue = bond.faceValue || BOND_UNIT_FACE_VALUE;
  const totalUnitsIssued = totalIssued / faceValue;
  const capUnits = Math.floor(SOVEREIGN_BOND_HOLDER_CAP * totalUnitsIssued);
  const resulting = currentHolderUnits(bond, field, id) + addUnits;
  if (resulting > capUnits) {
    const pct = Math.round(SOVEREIGN_BOND_HOLDER_CAP * 100);
    return `Sovereign bond position limit: a single holder may hold at most ${pct}% of an issue (${capUnits.toLocaleString()} units). This purchase would leave you holding ${resulting.toLocaleString()}.`;
  }
  return null;
}
