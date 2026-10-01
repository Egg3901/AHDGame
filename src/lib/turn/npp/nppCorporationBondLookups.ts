import type { Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import { isCorporateIssuerBond } from "@/lib/bonds/corporateCredit";

export interface NppCorporationDecisionPreload {
  corporations: readonly Corporation[];
  issuerBondsByCorpId: ReadonlyMap<string, Bond[]>;
  heldBondsByCorpId: ReadonlyMap<string, { bond: Bond; units: number }[]>;
}

export async function loadNppCorporationBondLookups(
  db: Db,
  preloaded?: NppCorporationDecisionPreload
): Promise<{
  issuerBondsByCorpId: ReadonlyMap<string, Bond[]>;
  heldBondsByCorpId: ReadonlyMap<string, { bond: Bond; units: number }[]>;
}> {
  if (preloaded) return preloaded;

  const bonds = await db.collection<Bond>("bonds").find({ matured: false }).toArray();
  const issuerBondsByCorpId = new Map<string, Bond[]>();
  const heldBondsByCorpId = new Map<string, { bond: Bond; units: number }[]>();
  for (const bond of bonds) {
    if (isCorporateIssuerBond(bond)) {
      const id = bond.corporationId.toString();
      issuerBondsByCorpId.set(id, [...(issuerBondsByCorpId.get(id) ?? []), bond]);
    }
    for (const holder of bond.holders ?? []) {
      const id = holder.corporationId?.toString();
      if (!id) continue;
      heldBondsByCorpId.set(id, [
        ...(heldBondsByCorpId.get(id) ?? []),
        { bond, units: holder.units },
      ]);
    }
  }
  return { issuerBondsByCorpId, heldBondsByCorpId };
}
