import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { changeDevolutionPolicy, type ChangeDevolutionPolicyInput } from "./changeDevolutionPolicy";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
} from "@/lib/constants/devolution";

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(1000),
}));

function input(overrides?: Partial<ChangeDevolutionPolicyInput>): ChangeDevolutionPolicyInput {
  return {
    countryId: "UK",
    stateId: "SCO",
    policy: "independence",
    ...overrides,
  };
}

describe("changeDevolutionPolicy", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("rejects non-UK country", async () => {
    const result = await changeDevolutionPolicy(db as unknown as Db, input({ countryId: "US" }));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/UK-only/);
  });

  it("rejects a region without a Devolution axis", async () => {
    const result = await changeDevolutionPolicy(db as unknown as Db, input({ stateId: "LON" }));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/no Devolution Policy axis/);
  });

  it("rejects when officeState row missing", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue(null);
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Office state row missing/);
  });

  it("rejects when policy is already set to requested value", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 5,
      devolutionPolicy: "independence",
    });
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/already set/);
  });

  it("rejects when AP insufficient", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 1, // less than 2
      devolutionPolicy: "pro",
    });
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Insufficient office action points/);
  });

  it("rejects when cooldown still active", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 5,
      devolutionPolicy: "pro",
      devolutionPolicyChangedAtTurn: 950, // 950 + 72 = 1022 > currentTurn 1000
    });
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/cooldown/);
    expect(result.body.cooldownReadyAtTurn).toBe(950 + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS);
  });

  it("succeeds when cooldown has expired", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 5,
      devolutionPolicy: "pro",
      devolutionPolicyChangedAtTurn: 900, // 900 + 72 = 972 < currentTurn 1000
    });
    db.collection("governorOfficeState").updateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(200);
    expect(result.body.policy).toBe("independence");
    expect(result.body.changedAtTurn).toBe(1000);
  });

  it("succeeds on first-ever change (no devolutionPolicyChangedAtTurn)", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 5,
      devolutionPolicy: "pro",
      // devolutionPolicyChangedAtTurn intentionally absent
    });
    db.collection("governorOfficeState").updateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await changeDevolutionPolicy(db as unknown as Db, input());
    expect(result.status).toBe(200);
  });

  it("decrements AP and sets policy on success", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 5,
      devolutionPolicy: "pro",
    });
    db.collection("governorOfficeState").updateOne.mockResolvedValue({ modifiedCount: 1 });
    await changeDevolutionPolicy(db as unknown as Db, input());
    const call = db.collection("governorOfficeState").updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "UK", stateId: "SCO" });
    expect(call[1].$set).toMatchObject({
      devolutionPolicy: "independence",
      devolutionPolicyChangedAtTurn: 1000,
    });
    expect(call[1].$inc).toEqual({
      gubernatorialActions: -DEVOLUTION_POLICY_CHANGE_AP_COST,
    });
  });

  it("admin override skips AP, cooldown, and AP decrement", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "SCO",
      gubernatorialActions: 0, // would fail without override
      devolutionPolicy: "pro",
      devolutionPolicyChangedAtTurn: 990, // would be on cooldown without override
    });
    db.collection("governorOfficeState").updateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await changeDevolutionPolicy(
      db as unknown as Db,
      input({ adminOverride: true })
    );
    expect(result.status).toBe(200);
    const call = db.collection("governorOfficeState").updateOne.mock.calls[0];
    expect(call[1].$inc).toBeUndefined();
    expect(call[1].$set.devolutionPolicy).toBe("independence");
  });

  it("rejects bogus policy value", async () => {
    const result = await changeDevolutionPolicy(
      db as unknown as Db,
      input({ policy: "neutral" as unknown as "anti" })
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Invalid policy/);
  });
});
