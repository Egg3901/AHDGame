/**
 * Income-tax collection batches guarded wallet debits and treasury credits.
 * One active batch freezes each payer's outcome before any treasury is credited;
 * monotonic target receipts make crashes, concurrency and stale retries safe.
 */
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import { createHash } from "node:crypto";
import { ObjectId, type Db, type Document, type AnyBulkWriteOperation } from "mongodb";
import type {
  PlayerIncomeTaxAssessment as Assessment,
  IncomeTaxBatchReceipt,
} from "@/lib/db/types/incomeTax";
import { computeExpiresAtSync } from "@/lib/financialTxLog/expiresAt";

interface Payer {
  ownerCollection: Assessment["ownerCollection"];
  characterId: ObjectId;
  debits: Record<string, number>;
  assessmentIds: string[];
}
interface Batch {
  _id: string;
  key: string;
  turn: number;
  stage: "claimed" | "debited" | "credited" | "complete";
  payers: Payer[];
  assessments: Assessment[];
  paidIds: string[];
  scanAfter?: string;
  fundedTreasury: boolean;
  ledgerShadow: boolean;
  createdAt: Date;
  turnLengthMinutes: number;
}
const idFor = (key: string) =>
  new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
const receiptGuard = (turn: number) => ({
  $or: [
    { incomeTaxBatchReceipt: { $exists: false } },
    { incomeTaxBatchReceipt: null },
    { "incomeTaxBatchReceipt.turn": { $lt: turn } },
  ],
});

/** All monetary writes are batched; a failed wallet guard cannot block another payer. */
async function deliver(db: Db, original: Batch): Promise<void> {
  const batches = db.collection<Batch>("playerIncomeTaxBatches");
  let batch = original;
  if (batch.stage === "complete") return;
  const identity = { _id: batch._id, key: batch.key };
  if (batch.stage === "claimed") {
    const operations = (
      collection: Assessment["ownerCollection"]
    ): AnyBulkWriteOperation<Document>[] =>
      batch.payers
        .filter((payer) => payer.ownerCollection === collection)
        .map((payer) => {
          const canPay = {
            $and: Object.entries(payer.debits).map(([path, amount]) => ({
              $gte: [{ $ifNull: ["$" + path, 0] }, amount],
            })),
          };
          return {
            updateOne: {
              filter: { _id: payer.characterId, ...receiptGuard(batch.turn) },
              update: [
                {
                  $set: {
                    ...Object.fromEntries(
                      Object.entries(payer.debits).map(([path, amount]) => [
                        path,
                        {
                          $cond: [
                            canPay,
                            { $subtract: [{ $ifNull: ["$" + path, 0] }, amount] },
                            { $ifNull: ["$" + path, 0] },
                          ],
                        },
                      ])
                    ),
                    incomeTaxBatchReceipt: {
                      key: { $literal: batch.key },
                      turn: batch.turn,
                      paid: canPay,
                    },
                  },
                },
              ],
            },
          };
        });
    const regularOps = operations("characters"),
      imperialOps = operations("imperialCharacters");
    if (regularOps.length) await db.collection("characters").bulkWrite(regularOps);
    if (imperialOps.length) await db.collection("imperialCharacters").bulkWrite(imperialOps);
    const [regularProof, imperialProof] = await Promise.all([
      db
        .collection<{ _id: ObjectId; incomeTaxBatchReceipt?: IncomeTaxBatchReceipt }>("characters")
        .find(
          {
            _id: {
              $in: batch.payers
                .filter((payer) => payer.ownerCollection === "characters")
                .map((payer) => payer.characterId),
            },
          },
          { projection: { incomeTaxBatchReceipt: 1 } }
        )
        .toArray(),
      db
        .collection<{ _id: ObjectId; incomeTaxBatchReceipt?: IncomeTaxBatchReceipt }>(
          "imperialCharacters"
        )
        .find(
          {
            _id: {
              $in: batch.payers
                .filter((payer) => payer.ownerCollection === "imperialCharacters")
                .map((payer) => payer.characterId),
            },
          },
          { projection: { incomeTaxBatchReceipt: 1 } }
        )
        .toArray(),
    ]);
    const byId = new Map([
      ...regularProof.map(
        (character) =>
          ["characters:" + character._id.toHexString(), character.incomeTaxBatchReceipt] as const
      ),
      ...imperialProof.map(
        (character) =>
          [
            "imperialCharacters:" + character._id.toHexString(),
            character.incomeTaxBatchReceipt,
          ] as const
      ),
    ]);
    if (
      [...regularProof, ...imperialProof].some(
        (character) => character.incomeTaxBatchReceipt?.key !== batch.key
      )
    )
      throw new Error("Income-tax wallet receipt unavailable");
    const paidIds = batch.payers
      .filter(
        (payer) =>
          byId.get(payer.ownerCollection + ":" + payer.characterId.toHexString())?.paid === true
      )
      .flatMap((payer) => payer.assessmentIds);
    await batches.updateOne(
      { ...identity, stage: "claimed" },
      { $set: { paidIds, stage: "debited" } }
    );
    batch = (await batches.findOne(identity))!;
  }
  const paid = new Set(batch.paidIds);
  const assessments = batch.assessments.filter((assessment) => paid.has(assessment._id));
  if (batch.stage === "debited") {
    if (batch.paidIds.length)
      await db
        .collection<Assessment>("playerIncomeTaxAssessments")
        .updateMany(
          { _id: { $in: batch.paidIds }, status: "unpaid" },
          { $set: { status: "collected", collectedTurn: batch.turn } }
        );
    const national = new Map<string, { amount: number; countryId: Assessment["countryId"] }>(),
      regional = new Map<string, { amount: number; countryId: Assessment["countryId"] }>();
    for (const assessment of assessments) {
      if (assessment.federal) {
        const sum = national.get(assessment.nationalBudgetId) ?? {
          amount: 0,
          countryId: assessment.countryId,
        };
        sum.amount += (assessment.federal / assessment.sourceFx) * assessment.nationalFx;
        national.set(assessment.nationalBudgetId, sum);
      }
      if (assessment.regional) {
        const sum = regional.get(assessment.stateId) ?? {
          amount: 0,
          countryId: assessment.countryId,
        };
        sum.amount += (assessment.regional / assessment.sourceFx) * assessment.regionalFx;
        regional.set(assessment.stateId, sum);
      }
    }
    const nationalOps: AnyBulkWriteOperation<FederalBudget>[] = Array.from(
      national,
      ([id, sum]) => ({
        updateOne: {
          filter: { _id: id, countryId: sum.countryId, ...receiptGuard(batch.turn) },
          update: {
            $inc: {
              treasuryBalance: sum.amount,
              ...(batch.fundedTreasury ? { treasuryCashLocal: sum.amount } : {}),
            },
            $set: { incomeTaxBatchReceipt: { key: batch.key, turn: batch.turn } },
          },
        },
      })
    );
    const regionalOps: AnyBulkWriteOperation<StateBudget>[] = Array.from(regional, ([id, sum]) => ({
      updateOne: {
        filter: { _id: id, countryId: sum.countryId, ...receiptGuard(batch.turn) },
        update: {
          $inc: { balance: sum.amount },
          $set: { incomeTaxBatchReceipt: { key: batch.key, turn: batch.turn } },
        },
      },
    }));
    if (nationalOps.length)
      await db.collection<FederalBudget>("federalBudget").bulkWrite(nationalOps);
    if (regionalOps.length) await db.collection<StateBudget>("stateBudgets").bulkWrite(regionalOps);
    const [nationalProof, regionalProof] = await Promise.all([
      db
        .collection<FederalBudget>("federalBudget")
        .find({ _id: { $in: [...national.keys()] } }, { projection: { incomeTaxBatchReceipt: 1 } })
        .toArray(),
      db
        .collection<StateBudget>("stateBudgets")
        .find({ _id: { $in: [...regional.keys()] } }, { projection: { incomeTaxBatchReceipt: 1 } })
        .toArray(),
    ]);
    if (
      nationalProof.length !== national.size ||
      regionalProof.length !== regional.size ||
      [...nationalProof, ...regionalProof].some(
        (target) => target.incomeTaxBatchReceipt?.key !== batch.key
      )
    )
      throw new Error("Income-tax treasury delivery is incomplete");
    await batches.updateOne({ ...identity, stage: "debited" }, { $set: { stage: "credited" } });
    batch = (await batches.findOne(identity))!;
  }
  if (batch.stage === "credited") {
    const transactions = assessments.map((assessment) => ({
      _id: idFor(assessment._id + ":tax"),
      type: "player_income_tax",
      turn: batch.turn,
      createdAt: batch.createdAt,
      expiresAt: computeExpiresAtSync(batch.createdAt, batch.turnLengthMinutes),
      subjectType: "character",
      subjectId: assessment.characterId,
      subjectName: assessment.name,
      amount: -(assessment.federal + assessment.regional),
      currencyCode: assessment.currency,
      anchorAmount: -(assessment.federal + assessment.regional) / assessment.sourceFx,
      flagged: false,
      meta: {
        imperial: assessment.ownerCollection === "imperialCharacters",
        ledgerOwnedBySettlement: true,
        assessmentId: assessment._id,
        assessedTurn: assessment.turn,
        incomeTier: assessment.tier,
        grossIncome: assessment.gross,
        nationalTax: assessment.federal,
        regionalTax: assessment.regional,
        netIncome: assessment.net,
      },
    }));
    const governmentReceipts = assessments.flatMap((assessment) => [
      ...(assessment.federal
        ? [
            {
              _id: idFor(assessment._id + ":national-receipt"),
              type: "gov_tax_revenue",
              turn: batch.turn,
              createdAt: batch.createdAt,
              expiresAt: computeExpiresAtSync(batch.createdAt, batch.turnLengthMinutes),
              subjectType: "government",
              countryId: assessment.countryId,
              subjectName: assessment.countryId + " Treasury",
              amount: (assessment.federal / assessment.sourceFx) * assessment.nationalFx,
              currencyCode: assessment.nationalCurrency,
              anchorAmount: assessment.federal / assessment.sourceFx,
              flagged: false,
              meta: {
                source: "player_income_tax",
                assessmentId: assessment._id,
                ledgerOwnedBySettlement: true,
                treasuryCashMovement: true,
              },
            },
          ]
        : []),
      ...(assessment.regional
        ? [
            {
              _id: idFor(assessment._id + ":regional-receipt"),
              type: "gov_tax_revenue",
              turn: batch.turn,
              createdAt: batch.createdAt,
              expiresAt: computeExpiresAtSync(batch.createdAt, batch.turnLengthMinutes),
              subjectType: "government",
              countryId: assessment.countryId,
              subjectName: assessment.stateId + " Treasury",
              amount: (assessment.regional / assessment.sourceFx) * assessment.regionalFx,
              currencyCode: assessment.regionalCurrency,
              anchorAmount: assessment.regional / assessment.sourceFx,
              flagged: false,
              meta: {
                source: "player_income_tax",
                assessmentId: assessment._id,
                stateId: assessment.stateId,
                ledgerOwnedBySettlement: true,
                treasuryCashMovement: false,
              },
            },
          ]
        : []),
    ]);
    if (transactions.length)
      await db.collection("financialTxLog").bulkWrite(
        [...transactions, ...governmentReceipts].map((transaction) => ({
          updateOne: {
            filter: { _id: transaction._id },
            update: { $setOnInsert: transaction },
            upsert: true,
          },
        }))
      );
    if (batch.ledgerShadow && assessments.length) {
      const entries = assessments.flatMap((assessment) => {
        const total = assessment.federal + assessment.regional;
        const legs = [
          {
            account:
              "character:" + assessment.characterId.toHexString() + ":" + assessment.currency,
            amount: -total,
            currencyCode: assessment.currency,
            anchorAmount: -total / assessment.sourceFx,
            role: "primary",
          },
        ];
        if (assessment.federal)
          legs.push({
            account: "government:" + assessment.countryId + ":" + assessment.nationalCurrency,
            amount: (assessment.federal / assessment.sourceFx) * assessment.nationalFx,
            currencyCode: assessment.nationalCurrency,
            anchorAmount: assessment.federal / assessment.sourceFx,
            role: "primary",
          });
        if (assessment.regional)
          legs.push({
            account: "sink:regional_income_tax:" + assessment.regionalCurrency,
            amount: (assessment.regional / assessment.sourceFx) * assessment.regionalFx,
            currencyCode: assessment.regionalCurrency,
            anchorAmount: assessment.regional / assessment.sourceFx,
            role: "contra",
          });
        const entry = {
          _id: idFor(assessment._id + ":ledger"),
          turn: batch.turn,
          createdAt: batch.createdAt,
          txType: "player_income_tax",
          legs,
          balanced: true,
          emitSite: "budget/playerIncomeTaxSettlement",
        };
        if (!batch.fundedTreasury || !assessment.federal) return [entry];
        return [
          entry,
          {
            ...entry,
            _id: idFor(assessment._id + ":cash-ledger"),
            legs: [
              {
                account:
                  "government_cash:" + assessment.countryId + ":" + assessment.nationalCurrency,
                amount: (assessment.federal / assessment.sourceFx) * assessment.nationalFx,
                currencyCode: assessment.nationalCurrency,
                anchorAmount: assessment.federal / assessment.sourceFx,
                role: "primary",
              },
              {
                account:
                  "character:" + assessment.characterId.toHexString() + ":" + assessment.currency,
                amount: -assessment.federal,
                currencyCode: assessment.currency,
                anchorAmount: -assessment.federal / assessment.sourceFx,
                role: "contra",
              },
            ],
          },
        ];
      });
      await db.collection("ledgerEntries").bulkWrite(
        entries.map((entry) => ({
          updateOne: {
            filter: { _id: entry._id },
            update: { $setOnInsert: entry },
            upsert: true,
          },
        }))
      );
    }
    if (batch.paidIds.length)
      await db
        .collection<Assessment>("playerIncomeTaxAssessments")
        .updateMany({ _id: { $in: batch.paidIds } }, { $set: { status: "paid" } });
    await batches.updateOne({ ...identity, stage: "credited" }, { $set: { stage: "complete" } });
  }
}

export async function settlePlayerIncomeTaxAssessments(
  db: Db,
  turn: number,
  now: Date,
  worldId: string,
  fundedTreasury: boolean,
  ledgerShadow: boolean,
  turnLengthMinutes: number
): Promise<void> {
  const batches = db.collection<Batch>("playerIncomeTaxBatches");
  let active = await batches.findOne({ _id: worldId });
  if (active && active.stage !== "complete") {
    await deliver(db, active);
    active = await batches.findOne({ _id: worldId });
  }
  if (active && active.turn >= turn) return;
  // A rotating bounded scan prevents long-lived unfunded debts from growing
  // the active BSON plan indefinitely or starving other taxpayers.
  const scanLimit = 1000;
  const scan = (limit: number, after?: string, through?: string) =>
    db
      .collection<Assessment>("playerIncomeTaxAssessments")
      .find({
        worldId,
        status: "unpaid",
        turn: { $lte: turn },
        ...(after ? { _id: { $gt: after } } : through ? { _id: { $lte: through } } : {}),
      })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
  const candidates = await scan(scanLimit, active?.scanAfter);
  // Fresh income can keep the forward range nonempty forever. Fill unused
  // capacity from the disjoint older range so those liabilities get revisited.
  if (active?.scanAfter && candidates.length < scanLimit)
    candidates.push(...(await scan(scanLimit - candidates.length, undefined, active.scanAfter)));
  const [regularWallets, imperialWallets] = await Promise.all([
    db
      .collection("characters")
      .find(
        {
          _id: {
            $in: candidates
              .filter((row) => row.ownerCollection === "characters")
              .map((row) => row.characterId),
          },
        },
        { projection: { "currencyBalances.personal": 1, cashOnHand: 1 } }
      )
      .toArray(),
    db
      .collection("imperialCharacters")
      .find(
        {
          _id: {
            $in: candidates
              .filter((row) => row.ownerCollection === "imperialCharacters")
              .map((row) => row.characterId),
          },
        },
        { projection: { "currencyBalances.personal": 1, cashOnHand: 1 } }
      )
      .toArray(),
  ]);
  const wallets = new Map([
    ...regularWallets.map((wallet) => ["characters:" + wallet._id.toHexString(), wallet] as const),
    ...imperialWallets.map(
      (wallet) => ["imperialCharacters:" + wallet._id.toHexString(), wallet] as const
    ),
  ]);
  const available = new Map<string, number>();
  const assessments = candidates.filter((assessment) => {
    const actorKey = assessment.ownerCollection + ":" + assessment.characterId.toHexString();
    const key = actorKey + ":" + assessment.sourcePath;
    const wallet = wallets.get(actorKey);
    const balance =
      available.get(key) ??
      (assessment.sourcePath === "cashOnHand"
        ? wallet?.cashOnHand
        : wallet?.currencyBalances?.personal?.[assessment.currency]) ??
      0;
    const owed = assessment.federal + assessment.regional;
    if (!Number.isFinite(balance) || balance < owed) return false;
    available.set(key, balance - owed);
    return true;
  });
  const payerMap = new Map<string, Payer>();
  for (const assessment of assessments) {
    const id = assessment.ownerCollection + ":" + assessment.characterId.toHexString();
    const payer = payerMap.get(id) ?? {
      characterId: assessment.characterId,
      ownerCollection: assessment.ownerCollection,
      debits: {},
      assessmentIds: [],
    };
    payer.debits[assessment.sourcePath] =
      (payer.debits[assessment.sourcePath] ?? 0) + assessment.federal + assessment.regional;
    payer.assessmentIds.push(assessment._id);
    payerMap.set(id, payer);
  }
  const batch: Batch = {
    _id: worldId,
    key: worldId + ":" + turn,
    turn,
    stage: "claimed",
    payers: [...payerMap.values()],
    assessments,
    paidIds: [],
    scanAfter: candidates.at(-1)?._id,
    fundedTreasury,
    ledgerShadow,
    createdAt: now,
    turnLengthMinutes,
  };
  if (active) await batches.replaceOne({ _id: worldId, key: active.key, stage: "complete" }, batch);
  else {
    try {
      await batches.insertOne(batch);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
  }
  const owned = await batches.findOne({ _id: worldId });
  if (!owned || owned.turn !== turn) throw new Error("Income-tax batch ownership unavailable");
  await deliver(db, owned);
}
