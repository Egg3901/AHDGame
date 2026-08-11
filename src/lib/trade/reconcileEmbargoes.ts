import { ObjectId, type Db } from "mongodb";
import type { Bill } from "@/lib/db/types";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { CountryId } from "@/lib/constants/countries";

type EmbargoBill = Pick<Bill, "_id" | "countryId" | "sponsorId" | "provisions">;

const key = (source: string, target: string, commodity: string, direction: string) =>
  `${source}|${target}|${commodity}|${direction}`;

/**
 * Replay signed embargo / end_embargo provisions (in enactment order) into the
 * final set of durable, legislation-origin embargoes. `embargo` adds (or
 * overwrites) a directed restriction; `end_embargo` repeals a matching one.
 * Pure — the DB wrapper below persists the result.
 */
export function resolveLegislatedEmbargoes(
  bills: EmbargoBill[],
  currentTurn: number
): Omit<TradeEmbargo, "_id">[] {
  const active = new Map<string, Omit<TradeEmbargo, "_id">>();
  for (const bill of bills) {
    const source = bill.countryId;
    if (!source) continue;
    const createdBy = bill.sponsorId ?? bill._id;
    for (const p of bill.provisions ?? []) {
      if (p.type === "embargo") {
        active.set(key(source, p.targetCountry, p.commodity, p.direction), {
          sourceCountry: source,
          targetCountry: p.targetCountry,
          commodity: p.commodity,
          direction: p.direction,
          mode: p.mode,
          ...(p.mode === "cap" && p.cap !== undefined ? { cap: p.cap } : {}),
          origin: "legislation",
          createdTurn: currentTurn,
          createdBy,
          sourceBillId: bill._id,
        });
      } else if (p.type === "end_embargo") {
        active.delete(key(source, p.targetCountry, p.commodity, p.direction));
      }
    }
  }
  return [...active.values()];
}

/**
 * Rebuild legislation-origin embargoes from signed embargo bills. Full rebuild
 * (delete + reinsert) so repeals and overwrites land exactly; minister-origin
 * embargoes are untouched. Idempotent. Mirrors `reconcileSignedTariffBills`.
 */
export async function reconcileSignedEmbargoBills(
  db: Db,
  currentTurn: number,
  countryId?: CountryId
): Promise<void> {
  const query: Record<string, unknown> = {
    status: "signed",
    provisions: { $elemMatch: { type: { $in: ["embargo", "end_embargo"] } } },
  };
  if (countryId) query.countryId = countryId;

  const signedBills = await db
    .collection<Bill>("bills")
    .find(query)
    .sort({ enactedAt: 1, updatedAt: 1, _id: 1 })
    .toArray();

  const resolved = resolveLegislatedEmbargoes(signedBills, currentTurn).filter(
    (e) => !countryId || e.sourceCountry === countryId
  );

  const embargoCol = db.collection<TradeEmbargo>("tradeEmbargoes");
  const deleteFilter: Record<string, unknown> = { origin: "legislation" };
  if (countryId) deleteFilter.sourceCountry = countryId;
  await embargoCol.deleteMany(deleteFilter);
  if (resolved.length > 0) {
    await embargoCol.insertMany(
      resolved.map((e) => ({ ...e, _id: new ObjectId() }) as TradeEmbargo)
    );
  }
}
