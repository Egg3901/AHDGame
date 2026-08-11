import { ObjectId, type Db } from "mongodb";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { Bond, Corporation, Character } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { resolveBondCurrency } from "./bondTurnHelpers";

// Tx log entry accumulators (resolved to names + emitted after all phases).
// `charId` carries the holder id in string form for batched name lookup;
// `isImperial` routes the lookup to the imperialCharacters collection so
// imperial bond holders don't end up with a blank subjectName.
export type PartialTxEntry = Omit<
  FinancialTxLogEntry,
  "_id" | "expiresAt" | "flagged" | "subjectName"
> & { charId?: string; isImperial?: boolean };

/**
 * Phase 7: Snapshot bond price history. Returns the number of history
 * snapshots written (the count of still-active bonds after price updates).
 */
export async function snapshotBondHistory(args: {
  db: Db;
  activeBonds: Bond[];
  fxByCurrency: Map<CurrencyCode, number>;
  turn: number;
  now: Date;
}): Promise<number> {
  const { db, activeBonds, fxByCurrency, turn, now } = args;
  // Get updated bonds after all price changes
  const updatedBonds = await db
    .collection<Bond>("bonds")
    .find({ matured: false })
    .project({ _id: 1, marketPrice: 1 })
    .toArray();

  // Calculate cumulative interest paid per bond from existing history
  const existingHistory = await db
    .collection("bondHistory")
    .aggregate<{ _id: ObjectId; maxInterest: number }>([
      { $match: { bondId: { $in: updatedBonds.map((b) => b._id) } } },
      { $group: { _id: "$bondId", maxInterest: { $max: "$totalInterestPaid" } } },
    ])
    .toArray();
  const prevInterestMap = new Map(existingHistory.map((h) => [h._id.toString(), h.maxInterest]));

  if (updatedBonds.length > 0) {
    const historyDocs = updatedBonds.map((bond) => {
      // Find this bond's coupon cost this turn from all active bonds.
      // `couponPerUnit × totalUnits` is LOCAL (bond.currencyCode per Task-18B).
      // Anchor-normalize before accumulating `totalInterestPaid` so cross-bond
      // aggregations at read time can sum in ₳ without mixing currencies. (A16)
      const originalBond = activeBonds.find((b) => b._id.toString() === bond._id.toString());
      const couponPerUnitLocal = originalBond
        ? perTurnCouponPayment(originalBond.couponRate, BOND_UNIT_FACE_VALUE)
        : 0;
      const bondCcy = originalBond ? resolveBondCurrency(originalBond) : undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      const couponPerUnitAnchor = corpCapitalToAnchor(couponPerUnitLocal, bondCcy, bondFxRate);
      const totalUnits = originalBond
        ? originalBond.holders.reduce((sum, h) => sum + h.units, 0)
        : 0;
      const turnInterestAnchor = couponPerUnitAnchor * totalUnits;
      const prevInterest = prevInterestMap.get(bond._id.toString()) ?? 0;

      return {
        bondId: bond._id,
        turn,
        marketPrice: bond.marketPrice,
        totalInterestPaid: Math.round((prevInterest + turnInterestAnchor) * 100) / 100,
        createdAt: now,
      };
    });
    await db.collection("bondHistory").insertMany(historyDocs);
  }

  return updatedBonds.length;
}

/**
 * Emit bond_coupon / bond_maturity for character holders + gov_coupon_payment.
 */
export async function emitBondTurnLedger(args: {
  db: Db;
  txBondEntries: PartialTxEntry[];
  govCouponByCountry: Map<string, { total: number; currency: CurrencyCode }>;
  turn: number;
  now: Date;
}): Promise<void> {
  const { db, txBondEntries, govCouponByCountry, turn, now } = args;
  if (txBondEntries.length > 0 || govCouponByCountry.size > 0) {
    const thresholds = await loadTxThresholds(db);
    // Resolve names. Imperial holders live in imperialCharacters, regulars in
    // characters; pre-fix the resolver only queried `characters`, so imperial
    // bond_coupon/bond_maturity rows shipped with subjectName="" and rendered
    // blank in the admin ledger.
    const regularCharIds = [
      ...new Set(
        txBondEntries
          .filter((e) => e.subjectType === "character" && !e.isImperial)
          .map((e) => e.charId)
          .filter(Boolean)
      ),
    ];
    const imperialCharIds = [
      ...new Set(
        txBondEntries
          .filter((e) => e.subjectType === "character" && e.isImperial)
          .map((e) => e.charId)
          .filter(Boolean)
      ),
    ];
    const [regularNameDocs, imperialNameDocs] = await Promise.all([
      regularCharIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: regularCharIds.map((id) => new ObjectId(id!)) } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as Pick<Character, "_id" | "name">[]),
      imperialCharIds.length > 0
        ? db
            .collection<ImperialCharacter>("imperialCharacters")
            .find({ _id: { $in: imperialCharIds.map((id) => new ObjectId(id!)) } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as Pick<ImperialCharacter, "_id" | "name">[]),
    ]);
    const regularNameById = new Map(
      regularNameDocs.map((c) => [c._id.toString(), c.name as string])
    );
    const imperialNameById = new Map(
      imperialNameDocs.map((c) => [c._id.toString(), c.name as string])
    );

    // Resolve corporation names — bond_coupon to corp holders need a subjectName too.
    const corpSubjectIds = [
      ...new Set(
        txBondEntries
          .filter((e) => e.subjectType === "corporation" && e.subjectId)
          .map((e) => e.subjectId!.toString())
      ),
    ];
    const corpNameDocs =
      corpSubjectIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corpSubjectIds.map((id) => new ObjectId(id)) } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : [];
    const corpNameById = new Map(corpNameDocs.map((c) => [c._id.toString(), c.name as string]));

    const resolvedCharEntries = txBondEntries.map(({ charId, isImperial, ...rest }) => ({
      ...rest,
      subjectName:
        rest.subjectType === "corporation"
          ? (corpNameById.get(rest.subjectId?.toString() ?? "") ?? "")
          : rest.subjectType === "government"
            ? // Government rows derive their name from countryId — same shape as
              // the gov_coupon_payment rows built below.
              `${rest.countryId ?? ""} Government`
            : isImperial
              ? (imperialNameById.get(charId ?? "") ?? "")
              : (regularNameById.get(charId ?? "") ?? ""),
    }));

    const govEntries = [...govCouponByCountry.entries()].map(([cid, { total, currency }]) => ({
      type: "gov_coupon_payment" as const,
      turn,
      createdAt: now,
      subjectType: "government" as const,
      countryId: cid,
      subjectName: `${cid} Government`,
      amount: -total,
      currencyCode: currency,
    }));

    // Bond coupon rows must be durable before the phase returns. The admin
    // ledger and suspect scan run in the same turn pipeline immediately after
    // bondTurn; fire-and-forget emission can be dropped when the cron/request
    // lifecycle closes, leaving holders paid but the audit trail empty.
    await emitTxBulk(db, [...resolvedCharEntries, ...govEntries], thresholds);
  }
}
