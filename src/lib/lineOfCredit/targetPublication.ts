/** LOC target cash stays protected until its durable journal outcome is acknowledged. */
import { isDeepStrictEqual } from "node:util";
import type { Db, Document } from "mongodb";
import { MONEY_MOVE_COLLECTION, SETTLED_KEYS_CAP } from "@/lib/banking/moneyMove";

interface TargetSpec {
  token: string;
  collection: "characters" | "centralBanks";
  id: unknown;
  revision: "locSettlementRevision" | "locReserveCreditRevision";
  marker: "pendingLocSettlement" | "pendingLocReserveCredit";
  guard: Document;
  increments: Document;
  set: Document;
  receipt: string;
}
interface Outcome {
  status: "delivered" | "rejected";
  error?: string;
}

/**
 * The target generation consumes each admission once. A protected claimed,
 * delivered or rejected outcome survives bounded receipt eviction. Cleanup
 * occurs only after the original journal permanently records that outcome.
 */
export async function publishLocTarget(db: Db, key: string, spec: TargetSpec): Promise<Outcome> {
  const journal = db.collection<Document>(MONEY_MOVE_COLLECTION);
  const target = db.collection<Document & { settledKeys?: string[] }>(spec.collection);
  const journalId = { _id: key as never };
  const targetId = { _id: spec.id as never };
  const outcomePath = `locTargetOutcomes.${spec.token}`;
  const admissionPath = `locTargetAdmissions.${spec.token}`;
  const acknowledge = async (outcome: Outcome, marker?: Document) => {
    await journal.updateOne(
      { ...journalId, status: "partial", [outcomePath]: { $exists: false } },
      { $set: { [outcomePath]: outcome } }
    );
    const saved = await journal.findOne(journalId, { projection: { [outcomePath]: 1 } });
    if (!isDeepStrictEqual(saved?.locTargetOutcomes?.[spec.token], outcome))
      throw new Error("LOC target outcome conflicts with its durable journal");
    if (marker)
      await target.updateOne(
        { ...targetId, [spec.marker]: marker },
        { $unset: { [spec.marker]: "" } }
      );
    return outcome;
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await journal.findOne(journalId, {
      projection: {
        status: 1,
        locSettlementVersion: 1,
        [outcomePath]: 1,
        [admissionPath]: 1,
      },
    });
    const outcome: Outcome | undefined = record?.locTargetOutcomes?.[spec.token];
    const current = await target.findOne(targetId, {
      projection: {
        [spec.revision]: 1,
        [spec.marker]: 1,
        settledKeys: 1,
      },
    });
    if (!current) throw new Error("LOC settlement destination is unavailable");
    let marker: Document | undefined = current[spec.marker];
    if (outcome) {
      if (marker?.key === key && marker.token === spec.token)
        await target.updateOne(
          { ...targetId, [spec.marker]: marker },
          { $unset: { [spec.marker]: "" } }
        );
      return outcome;
    }
    if (!record || record.status !== "partial")
      throw new Error("LOC journal is no longer awaiting target publication");
    if (record.locSettlementVersion !== 2) {
      if (current.settledKeys?.includes(spec.receipt)) return acknowledge({ status: "delivered" });
      throw new Error("Legacy pending LOC target needs reconciliation before cash delivery");
    }
    if (marker && (marker.key !== key || marker.token !== spec.token))
      throw new Error("LOC target is owned by another pending command; retry this command");
    if (!marker) {
      const revision = current[spec.revision] ?? 0;
      const originalAdmission = record.locTargetAdmissions?.[spec.token];
      if (originalAdmission !== revision) {
        const quote = await journal.updateOne(
          {
            ...journalId,
            status: "partial",
            [outcomePath]: { $exists: false },
            [admissionPath]: originalAdmission ?? { $exists: false },
          },
          { $set: { [admissionPath]: revision } }
        );
        if (!quote.matchedCount) continue;
      }
      marker = { key, token: spec.token, generation: revision + 1, status: "claimed" };
      const claim = await target.updateOne(
        {
          ...targetId,
          [spec.marker]: { $exists: false },
          [spec.revision]: current[spec.revision] ?? { $exists: false },
        },
        { $inc: { [spec.revision]: 1 }, $set: { [spec.marker]: marker } }
      );
      if (!claim.matchedCount) continue;
    }
    if (marker.status === "claimed") {
      const delivered = { ...marker, status: "delivered" };
      const write = await target.updateOne(
        { ...targetId, ...spec.guard, [spec.marker]: marker },
        {
          $inc: spec.increments,
          $set: { ...spec.set, [spec.marker]: delivered },
          $push: { settledKeys: { $each: [spec.receipt], $slice: -SETTLED_KEYS_CAP } },
        }
      );
      if (write.matchedCount) return acknowledge({ status: "delivered" }, delivered);
      // Refusal competes with publication on the SAME claimed target outcome.
      // A delayed losing worker cannot label already delivered cash rejected.
      const refused = {
        ...marker,
        status: "rejected",
        error: "Your line of credit or wallet changed before credit settlement",
      };
      const stopped = await target.updateOne(
        { ...targetId, [spec.marker]: marker },
        { $set: { [spec.marker]: refused } }
      );
      if (stopped.matchedCount)
        return acknowledge({ status: "rejected", error: refused.error }, refused);
      continue;
    }
    if (marker.status === "delivered") return acknowledge({ status: "delivered" }, marker);
    if (marker.status === "rejected")
      return acknowledge({ status: "rejected", error: String(marker.error) }, marker);
    throw new Error("Invalid protected LOC target outcome");
  }
  throw new Error("LOC target changed during admission; retry this command");
}
