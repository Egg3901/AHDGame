/** Recoverable exclusion between increasing LOC obligations and reserve-pool quotes. */
import type { Db } from "mongodb";
import type { CentralBank, Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { SETTLED_KEYS_CAP } from "@/lib/banking/moneyMove";
import type { LocPlan } from "./settlement";

export function locAdmissionBanks(plan: LocPlan): string[] {
  const next = plan.effect.locAfter;
  if (!next) return [];
  const currencies = new Set([
    ...Object.keys(next.balances ?? {}),
    ...Object.keys(next.arrears ?? {}),
  ]);
  const banks = new Set<string>();
  for (const currency of currencies) {
    const c = currency as CurrencyCode;
    const prior = (plan.expectedLoc?.balances?.[c] ?? 0) + (plan.expectedLoc?.arrears?.[c] ?? 0);
    const after = (next.balances?.[c] ?? 0) + (next.arrears?.[c] ?? 0);
    if (after > prior) banks.add(getBankId(getCountryIdForCurrency(c)));
  }
  if (plan.drawAdmission) banks.add(plan.drawAdmission.bankId);
  return [...banks].sort();
}

const stamp = (key: string) => `${key}:loc-book-complete`;

/** A busy owner remains pending and recoverable, never expires into a second writer. */
export async function acquireLocBookAdmission(db: Db, key: string, plan: LocPlan) {
  const banks = db.collection<CentralBank & { settledKeys?: string[] }>("centralBanks");
  for (const bankId of locAdmissionBanks(plan)) {
    const current = await banks.findOne(
      { _id: bankId },
      {
        projection: { pendingLocBookMutationId: 1, settledKeys: 1 },
      }
    );
    if (current?.settledKeys?.includes(stamp(key)) || current?.pendingLocBookMutationId === key)
      continue;
    const claimed = await banks.updateOne(
      {
        _id: bankId,
        pendingLocBookMutationId: { $exists: false },
        settledKeys: { $ne: stamp(key) },
      },
      { $set: { pendingLocBookMutationId: key }, $inc: { locBookRevision: 1 } }
    );
    if (!claimed.matchedCount) {
      const owned = await banks.findOne(
        { _id: bankId, $or: [{ pendingLocBookMutationId: key }, { settledKeys: stamp(key) }] },
        { projection: { _id: 1 } }
      );
      if (!owned) throw new Error("Credit book is busy or unavailable; retry this same command");
    }
  }
}

/** The completion receipt prevents concurrent retries from reacquiring a released owner. */
export async function releaseLocBookAdmission(db: Db, key: string, plan: LocPlan) {
  const banks = db.collection<CentralBank & { settledKeys?: string[] }>("centralBanks");
  for (const bankId of locAdmissionBanks(plan)) {
    const released = await banks.updateOne(
      { _id: bankId, pendingLocBookMutationId: key },
      {
        $unset: { pendingLocBookMutationId: "" },
        $inc: { locBookRevision: 1 },
        $push: { settledKeys: { $each: [stamp(key)], $slice: -SETTLED_KEYS_CAP } },
      }
    );
    if (
      !released.matchedCount &&
      !(await banks.findOne({ _id: bankId, settledKeys: stamp(key) }, { projection: { _id: 1 } }))
    )
      throw new Error("Credit book release remains pending");
  }
}

/** Reuse production underwriting under admission; preserve the original FX amount. */
export async function validateLocDrawAdmission(db: Db, plan: LocPlan): Promise<string | null> {
  if (!plan.drawAdmission) return null;
  const character = await db.collection<Character>("characters").findOne({ _id: plan.characterId });
  const c = plan.request.currency as CurrencyCode;
  if (!character?.lineOfCredit?.accountsOpened?.[c] || character.lineOfCredit.drawFrozen)
    return "The credit account is no longer eligible for this draw";
  const { buildLocSnapshot } = await import("./buildSnapshot");
  const snapshot = await buildLocSnapshot(db, character);
  if (!snapshot || plan.drawAdmission.addInternal > snapshot.perPlayerAvailableInternal + 1e-6)
    return "The available credit changed before settlement; request a new draw";
  return null;
}
