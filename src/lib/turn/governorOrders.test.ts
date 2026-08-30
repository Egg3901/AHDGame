import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processGovernorExecutiveOrders } from "./governorOrders";

describe("processGovernorExecutiveOrders", () => {
  it("reconstructs an expired legacy order's prior option from the legislation ladder", async () => {
    const db = createMockDb();
    const orderId = new ObjectId();
    const issuedByCharacterId = new ObjectId();

    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: orderId,
          countryId: "ru",
          stateId: "KAZ",
          issuedByCharacterId,
          issuedByName: "Governor",
          legislationTypeId: "ru.order.courts.primary",
          effectDirection: 1,
          policyOptionIndexBefore: 3,
          policyOptionIndexAfter: 4,
          issuedAtTurn: 50,
          expiresAtTurn: 74,
          status: "active",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    } as never);

    db.collection("statePolicies");
    db.collectionMocks.statePolicies!.findOne.mockResolvedValue({
      stateId: "KAZ",
      legislationTypeId: "ru.order.courts.primary",
      policyOptionId: "l4",
      policyOptionIndex: 4,
      economic: 0,
      social: -3,
      effectDirection: 1,
      enactedAt: new Date("2026-01-01T00:00:00Z"),
      enactedTurn: 50,
      enactedBy: { kind: "order", id: orderId },
    });

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes!.findOne.mockResolvedValue({
      _id: "ru.order.courts.primary",
      policyOptions: [
        { id: "l0", name: "None", economic: 0, social: -1, effectDirection: -1 },
        { id: "l1", name: "Weak", economic: -1, social: -1, effectDirection: -1 },
        { id: "l2", name: "Limited", economic: -1, social: 0, effectDirection: 0 },
        { id: "l3", name: "Standard", economic: -2, social: 1, effectDirection: 1 },
        { id: "l4", name: "Maximum", economic: -3, social: 2, effectDirection: 1 },
      ],
    });

    await processGovernorExecutiveOrders(db as unknown as Db, 74);

    const update = db.collectionMocks.statePolicies!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).toEqual(
      expect.objectContaining({
        policyOptionIndex: 3,
        policyOptionId: "l3",
        economic: -2,
        social: 1,
        effectDirection: 1,
      })
    );
  });

  it("uses the before-index when an old order snapshot has a mismatched option id", async () => {
    const db = createMockDb();
    const orderId = new ObjectId();
    const issuedByCharacterId = new ObjectId();

    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: orderId,
          countryId: "US",
          stateId: "NY",
          issuedByCharacterId,
          issuedByName: "Governor",
          legislationTypeId: "us.sec.hospitalConstruction",
          effectDirection: 1,
          policyOptionIndexBefore: 3,
          policyOptionIndexAfter: 4,
          policyOptionIdBefore: "l4",
          economicBefore: 0,
          socialBefore: 0,
          issuedAtTurn: 225,
          expiresAtTurn: 249,
          status: "active",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    } as never);

    db.collection("statePolicies");
    db.collectionMocks.statePolicies!.findOne.mockResolvedValue({
      stateId: "NY",
      legislationTypeId: "us.sec.hospitalConstruction",
      policyOptionId: "l4",
      policyOptionIndex: 4,
      economic: -5,
      social: 0,
      effectDirection: 1,
      enactedAt: new Date("2026-01-01T00:00:00Z"),
      enactedTurn: 225,
      enactedBy: { kind: "order", id: orderId },
    });

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes!.findOne.mockResolvedValue({
      _id: "us.sec.hospitalConstruction",
      policyOptions: [
        { id: "l0", name: "No Grants", economic: 5, social: 0, effectDirection: -1 },
        { id: "l1", name: "Rural", economic: 2.5, social: 0, effectDirection: -1 },
        { id: "l2", name: "Program", economic: 0, social: 0, effectDirection: 0 },
        { id: "l3", name: "Regional", economic: -2.5, social: 0, effectDirection: 1 },
        { id: "l4", name: "Universal", economic: -5, social: 0, effectDirection: 1 },
      ],
    });

    await processGovernorExecutiveOrders(db as unknown as Db, 249);

    const update = db.collectionMocks.statePolicies!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).toEqual(
      expect.objectContaining({
        policyOptionIndex: 3,
        policyOptionId: "l3",
        economic: -2.5,
        social: 0,
      })
    );
  });
});
