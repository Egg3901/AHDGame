import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { DiplomaticActionBudget } from "@/lib/db/types/diplomaticAction";
import { DIPLOMATIC_ACTIONS_PER_TURN } from "@/lib/constants/internationalOrganizations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/countryAccess", () => ({ isCountryEnabledForPlayers: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationDef: vi.fn(),
  isMember: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/commands/proposeLegislation", () => ({
  proposeOrganizationLegislation: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
const { loadOrganizationDef, isMember } = await import("@/lib/internationalOrganizations/service");
const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
const { proposeOrganizationLegislation } =
  await import("@/lib/internationalOrganizations/commands/proposeLegislation");
const { getDiplomaticActionsRemaining } =
  await import("@/lib/internationalOrganizations/diplomaticActions");

/** Stateful in-memory `diplomaticActions` collection (the shared MockDb is stateless). */
function makeDb(seed: DiplomaticActionBudget[] = []): Db {
  const rows = [...seed];
  const col = {
    async findOne(filter: { countryId: string }) {
      return rows.find((r) => r.countryId === filter.countryId) ?? null;
    },
    async updateOne(
      filter: { countryId: string },
      update: { $set: Partial<DiplomaticActionBudget> },
      opts?: { upsert?: boolean }
    ) {
      let row = rows.find((r) => r.countryId === filter.countryId);
      if (!row) {
        if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
        row = { _id: new ObjectId(), countryId: filter.countryId } as DiplomaticActionBudget;
        rows.push(row);
      }
      Object.assign(row, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { collection: () => col } as unknown as Db;
}

function authAsDeForeignMinister() {
  const characterId = new ObjectId();
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: characterId, name: "Klaus FM" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: {
      countryId: "DE",
      positionId: "foreign_minister",
      characterId,
      characterName: "Klaus FM",
    },
  } as never);
}

function request() {
  return new Request("http://localhost/api/country/de/international-organizations/EU/legislation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "free_trade_agreement", parties: ["DE", "IE"] }),
  });
}

const params = { params: Promise.resolve({ code: "de", orgId: "EU" }) };

describe("legislation propose — diplomatic budget gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "EU", name: "European Union" } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(200);
    vi.mocked(proposeOrganizationLegislation).mockResolvedValue({
      ok: true,
      legislationId: new ObjectId().toString(),
    } as never);
    authAsDeForeignMinister();
  });

  it("rejects when no diplomatic actions remain", async () => {
    const db = makeDb([
      {
        _id: new ObjectId(),
        countryId: "DE",
        turn: 200,
        remaining: 0,
        updatedAt: new Date(),
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/legislation/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "No diplomatic actions remaining this turn." })
    );
    expect(proposeOrganizationLegislation).not.toHaveBeenCalled();
  });

  it("decrements the budget on a successful proposal", async () => {
    const db = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/legislation/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(proposeOrganizationLegislation).toHaveBeenCalledTimes(1);
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(
      DIPLOMATIC_ACTIONS_PER_TURN - 1
    );
  });
});
