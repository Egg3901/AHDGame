import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-23-repair-kazakh-law-levels";

function cursor<T>(docs: T[]) {
  return { toArray: async () => docs };
}

describe(migration.id, () => {
  it("repairs an enacted maximum law and a legacy order expiry from authoritative records", async () => {
    const db = createMockDb();
    const billId = new ObjectId();
    const orderId = new ObjectId();
    const billPolicyId = new ObjectId();
    const expiryPolicyId = new ObjectId();

    db.collection("statePolicies");
    db.collectionMocks.statePolicies!.find.mockReturnValue(
      cursor([
        {
          _id: billPolicyId,
          stateId: "KAZ",
          legislationTypeId: "ru.education.universalSchooling.primary",
          policyOptionIndex: 1,
          policyOptionId: "l1",
          economic: 2.5,
          social: 0,
          effectDirection: -1,
          enactedTurn: 308,
          enactedAt: new Date(),
          enactedBy: { kind: "bill", id: billId },
        },
        {
          _id: expiryPolicyId,
          stateId: "KAZ",
          legislationTypeId: "ru.order.courts.primary",
          policyOptionIndex: 0,
          policyOptionId: "l0",
          economic: 0,
          social: -1,
          effectDirection: -1,
          enactedTurn: 74,
          enactedAt: new Date(),
          enactedBy: { kind: "expiry", id: orderId },
        },
      ]) as never
    );

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes!.find.mockReturnValue(
      cursor([
        {
          _id: "ru.education.universalSchooling.primary",
          policyOptions: [0, 1, 2, 3, 4].map((index) => ({
            id: `l${index}`,
            name: `Level ${index}`,
            economic: 3 - index,
            social: index - 2,
            effectDirection: index < 2 ? -1 : index > 2 ? 1 : 0,
          })),
        },
        {
          _id: "ru.order.courts.primary",
          policyOptions: [0, 1, 2, 3, 4].map((index) => ({
            id: `l${index}`,
            name: `Level ${index}`,
            economic: -index,
            social: index - 2,
            effectDirection: index < 2 ? -1 : index > 2 ? 1 : 0,
          })),
        },
      ]) as never
    );

    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          billId,
          stateId: "KAZ",
          legislationTypeId: "ru.education.universalSchooling.primary",
          policyOptionIndex: 4,
        },
      ]) as never
    );

    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders!.find.mockReturnValue(
      cursor([
        {
          _id: orderId,
          stateId: "KAZ",
          legislationTypeId: "ru.order.courts.primary",
          policyOptionIndexBefore: 3,
          policyOptionIndexAfter: 4,
        },
      ]) as never
    );

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsUpdated).toBe(2);
    expect(db.collectionMocks.statePolicies!.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.statePolicies!.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: billPolicyId },
      {
        $set: expect.objectContaining({
          policyOptionIndex: 4,
          policyOptionId: "l4",
          economic: -1,
          social: 2,
          effectDirection: 1,
        }),
      }
    );
    expect(db.collectionMocks.statePolicies!.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: expiryPolicyId },
      {
        $set: expect.objectContaining({
          policyOptionIndex: 3,
          policyOptionId: "l3",
          economic: -3,
          social: 1,
          effectDirection: 1,
        }),
      }
    );
  });

  it("reports repairs without writing during a dry run", async () => {
    const db = createMockDb();
    const billId = new ObjectId();

    db.collection("statePolicies");
    db.collectionMocks.statePolicies!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          stateId: "KAZ",
          legislationTypeId: "law",
          policyOptionIndex: 0,
          policyOptionId: "l0",
          economic: 0,
          social: 0,
          effectDirection: -1,
          enactedTurn: 1,
          enactedAt: new Date(),
          enactedBy: { kind: "bill", id: billId },
        },
      ]) as never
    );
    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes!.find.mockReturnValue(
      cursor([
        {
          _id: "law",
          policyOptions: [
            { id: "l0", economic: 0, social: 0, effectDirection: -1 },
            { id: "l1", economic: 1, social: 1, effectDirection: 1 },
          ],
        },
      ]) as never
    );
    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws!.find.mockReturnValue(
      cursor([{ billId, legislationTypeId: "law", policyOptionIndex: 1 }]) as never
    );
    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders!.find.mockReturnValue(cursor([]) as never);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.[0]).toBe("would repair 1 KAZ policy rows");
    expect(db.collectionMocks.statePolicies!.updateOne).not.toHaveBeenCalled();
  });
});
