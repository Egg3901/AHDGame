import type { Db } from "mongodb";
import { onBillEnacted } from "@/lib/billEnactment";
import { applyLegislationEffect } from "@/lib/legislationEffects";

type EffectBill = Parameters<typeof applyLegislationEffect>[1];
type EnactmentBill = Parameters<typeof onBillEnacted>[1];

/**
 * Run the two shared enactment effect layers and reuse their legislation-type
 * catalog read. Errors remain isolated so one legacy effect cannot suppress
 * the independent enactment hook.
 */
export async function applyEnactedBillEffects(
  db: Db,
  bill: EffectBill & EnactmentBill,
  currentTurn: number,
  labels: { effect: string; enactment: string }
): Promise<void> {
  const legislationTypes = await applyLegislationEffect(db, bill, currentTurn).catch((error) => {
    console.error(labels.effect, error);
    return undefined;
  });
  const enactment = legislationTypes
    ? onBillEnacted(db, bill, currentTurn, legislationTypes)
    : onBillEnacted(db, bill, currentTurn);
  await enactment.catch((error) => console.error(labels.enactment, error));
}
