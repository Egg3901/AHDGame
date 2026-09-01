/**
 * The settlement crisis a peace term may settle, for `validatePeaceTerm`.
 *
 * `validatePeaceTerm` is pure and holds no database, so the two roads that can carry
 * a `reunification` term (the offer route and the dictate route) load this and pass
 * it in, the same way they already load the indemnity ceiling and the target's party
 * list. One loader behind both, so the offer road and the dictate road cannot come to
 * different answers about whether a war is carrying the German Question.
 *
 * FROZEN only. A question that is still `open` has not been attached to any war, and
 * one already `resolved` has been answered; neither is something a term can settle.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";

export interface TermSettlement {
  /** The side reunification would settle the question for. */
  challenger: CountryId;
}

export async function loadTermSettlement(
  db: Db,
  conflictId: string
): Promise<TermSettlement | null> {
  const crises = await getSettlementCrisesCollection(db);
  const crisis = (await crises.findOne({
    conflictId,
    status: "frozen",
  } as Parameters<typeof crises.findOne>[0])) as SettlementCrisisDoc | null;
  if (!crisis) return null;
  return { challenger: crisis.challengerEntityId as CountryId };
}
