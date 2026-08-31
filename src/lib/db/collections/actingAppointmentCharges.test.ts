import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  hasUnspentActingCharge,
  spendActingCharge,
  type ActingChargeKey,
} from "./actingAppointmentCharges";

let db: MockDb;
const presidentCharacterId = new ObjectId();
const startedAt = new Date("2026-01-01T00:00:00.000Z");

const key: ActingChargeKey = {
  countryId: "US",
  positionId: "secretary_of_treasury",
  presidentCharacterId,
  presidencyStartedAt: startedAt,
};

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("actingAppointmentCharges");
});

describe("hasUnspentActingCharge", () => {
  it("is true when no charge row exists for the seat this presidency", async () => {
    db.collectionMocks["actingAppointmentCharges"]!.findOne.mockResolvedValue(null);
    await expect(hasUnspentActingCharge(db as never, key)).resolves.toBe(true);
  });

  it("is false once a charge has been spent", async () => {
    db.collectionMocks["actingAppointmentCharges"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
    });
    await expect(hasUnspentActingCharge(db as never, key)).resolves.toBe(false);
  });

  it("scopes the lookup by country, seat, president and presidency start", async () => {
    db.collectionMocks["actingAppointmentCharges"]!.findOne.mockResolvedValue(null);
    await hasUnspentActingCharge(db as never, key);
    expect(db.collectionMocks["actingAppointmentCharges"]!.findOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_treasury",
      presidentCharacterId,
      presidencyStartedAt: startedAt,
    });
  });
});

describe("spendActingCharge", () => {
  it("records the appointee and the turn it was spent", async () => {
    const appointee = new ObjectId();
    await spendActingCharge(db as never, key, appointee, 412);
    const call = db.collectionMocks["actingAppointmentCharges"]!.insertOne.mock.calls[0][0];
    expect(call).toMatchObject({
      countryId: "US",
      positionId: "secretary_of_treasury",
      presidentCharacterId,
      presidencyStartedAt: startedAt,
      appointeeCharacterId: appointee,
      spentOnTurn: 412,
    });
  });
});
