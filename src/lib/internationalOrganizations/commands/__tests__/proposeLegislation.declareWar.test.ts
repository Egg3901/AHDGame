import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
const findOne = vi.fn().mockResolvedValue(null);
const validateDeclareWar = vi.fn().mockResolvedValue({ ok: true });
let members = ["US", "UK", "FR"];
let orgCategory = "bloc";

vi.mock("@/lib/db/collections", () => ({
  getOrganizationLegislationCollection: async () => ({ insertOne, findOne }),
  getOrganizationProposalsCollection: async () => ({ findOne: vi.fn() }),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: async () => members,
  loadOrganizationDefWithPowers: async () => ({
    id: "NATO",
    shortName: "NATO",
    category: orgCategory,
  }),
  recordOrgHistoryEvent: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: async () => 500 }));
vi.mock("@/lib/military/validateDeclareWar", () => ({
  validateDeclareWar: (...args: unknown[]) => validateDeclareWar(...args),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({ getConflict: vi.fn() }));

const { proposeOrganizationLegislation } = await import("../proposeLegislation");

const db = {
  collection: () => ({ findOne: async () => ({ conflictsEnabled: true }) }),
} as unknown as Db;

const propose = () =>
  proposeOrganizationLegislation({
    db,
    countryId: "US",
    orgId: "NATO",
    actor: { characterId: new ObjectId(), characterName: "Secretary of State" },
    input: { type: "declare_war", targetCountryId: "CN", warGoal: "punitive" },
  });

describe("tabling an organization declare_war resolution", () => {
  beforeEach(() => {
    insertOne.mockClear();
    findOne.mockReset();
    findOne.mockResolvedValue(null);
    validateDeclareWar.mockReset();
    validateDeclareWar.mockResolvedValue({ ok: true });
    members = ["US", "UK", "FR"];
    orgCategory = "bloc";
  });

  it("stores the target and war goal on a pending bloc resolution", async () => {
    await expect(propose()).resolves.toMatchObject({ ok: true });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "declare_war",
        warDeclarationTargetCountryId: "CN",
        warDeclarationGoal: "punitive",
        status: "pending",
        closesOnTurn: 524,
      })
    );
    expect(validateDeclareWar).toHaveBeenCalledWith(
      db,
      { targetCountry: "CN", warGoal: "punitive" },
      "US",
      500
    );
  });

  it("refuses to target a member of the organization", async () => {
    members = ["US", "UK", "CN"];
    const result = await propose();
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is unavailable outside bloc organizations", async () => {
    orgCategory = "security";
    const result = await propose();
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("refuses a duplicate live declaration against the same target", async () => {
    findOne.mockResolvedValue({ _id: new ObjectId(), status: "pending" });
    const result = await propose();
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(insertOne).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "declare_war",
        warDeclarationTargetCountryId: "CN",
        status: "pending",
      })
    );
  });

  it("allows a later declaration after an earlier resolution was enacted", async () => {
    findOne.mockImplementation(async (filter: { status?: string }) =>
      filter.status === "active" ? { _id: new ObjectId(), status: "active" } : null
    );

    await expect(propose()).resolves.toMatchObject({ ok: true });
    expect(insertOne).toHaveBeenCalledTimes(1);
  });
});
