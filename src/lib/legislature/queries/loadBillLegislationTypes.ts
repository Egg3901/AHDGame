import type { Db } from "mongodb";
import type { Bill, LegislationType } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { getEquivalentLegislationTypeIds } from "@/lib/legislationTypeAliases";

/** Load only the catalog rows referenced by a page of bills. */
export async function loadBillLegislationTypes(
  db: Db,
  bills: Array<Pick<Bill, "legislationTypeId" | "provisions">>
): Promise<Map<string, LegislationType>> {
  const ids = new Set<string>();
  for (const bill of bills) {
    for (const id of getEquivalentLegislationTypeIds(bill.legislationTypeId)) ids.add(id);
    for (const provision of bill.provisions ?? []) {
      if (!isPolicyProvision(provision)) continue;
      for (const id of getEquivalentLegislationTypeIds(provision.legislationTypeId)) ids.add(id);
    }
  }
  if (ids.size === 0) return new Map();

  const legislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: [...ids] } })
    .toArray();
  return new Map(legislationTypes.map((legislationType) => [legislationType._id, legislationType]));
}
