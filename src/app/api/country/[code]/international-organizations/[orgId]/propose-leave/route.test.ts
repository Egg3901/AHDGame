import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: vi.fn(),
}));
vi.mock("@/lib/legislature/billAutoFailWarning", () => ({
  getBillProposalAutoFailWarning: vi.fn(),
  getBillProposalAutoFailWarningError: vi.fn(
    () => "Election timing makes this bill likely to auto-fail."
  ),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: vi.fn(),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
const { checkLegislationFreeze } = await import("@/lib/api/parliamentaryFreeze");
const { getBillProposalAutoFailWarning } = await import("@/lib/legislature/billAutoFailWarning");
const { isMember, loadOrganizationDef, recordOrgHistoryEvent } =
  await import("@/lib/internationalOrganizations/service");
const { getCurrentTurn } = await import("@/lib/turn/currentTurn");

describe("POST /api/country/[code]/international-organizations/[orgId]/propose-leave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkLegislationFreeze).mockResolvedValue({ ok: true });
    vi.mocked(getBillProposalAutoFailWarning).mockResolvedValue(null);
  });

  it("creates a legislature bill for an organization withdrawal", async () => {
    const characterId = new ObjectId();
    const billCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "bills") return billCollection;
        if (name === "characters") return { updateOne: vi.fn().mockResolvedValue({}) };
        return {};
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          name: "Ariadne Cole",
          party: "labour",
        },
      },
    } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      name: "Ariadne Cole",
      party: "labour",
      actions: 25,
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "Ariadne Cole",
      },
    } as never);
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "EU",
      name: "European Union",
    } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(144);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-leave/route");
    const response = await POST(
      new Request("http://localhost/api/country/uk/international-organizations/EU/propose-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "organization" }),
      }),
      { params: Promise.resolve({ code: "uk", orgId: "EU" }) }
    );

    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      _id: ObjectId;
      stateId: string;
      originChamber: string;
      currentChamber: string;
      sponsorName: string;
      category: string;
      status: string;
      provisions: Array<{ type: string; subType: string; organizationId: string }>;
      votingEndsAt: Date;
      votingStartedAt: Date;
      proposalActionCost: number;
    };
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, billId: inserted._id.toString() });
    expect(inserted.stateId).toBe("uk_national");
    expect(inserted.originChamber).toBe("commons");
    expect(inserted.currentChamber).toBe("commons");
    expect(inserted.sponsorName).toBe("Ariadne Cole");
    expect(inserted.category).toBe("foreign policy");
    expect(inserted.status).toBe("active");
    expect(inserted.proposalActionCost).toBe(10);
    expect(inserted.provisions?.[0]).toMatchObject({
      type: "international_organization",
      subType: "leave",
      organizationId: "EU",
    });
    expect(inserted.votingEndsAt.getTime() - inserted.votingStartedAt.getTime()).toBe(
      24 * 60 * 60 * 1000
    );
    expect(db.collection).toHaveBeenCalledWith("characters");
    expect(recordOrgHistoryEvent).toHaveBeenCalledWith(
      db,
      "UK",
      144,
      expect.stringContaining("proposed a legislative withdrawal"),
      expect.objectContaining({
        organizationId: "EU",
        billId: inserted._id.toString(),
        targetType: "organization",
      })
    );
  });

  it("allows a withdrawal proposal when the sponsor already has a regular national bill", async () => {
    const characterId = new ObjectId();
    const regularBill = {
      _id: new ObjectId(),
      sponsorId: characterId,
      countryId: "UK",
      status: "active",
    };
    const billCollection = {
      findOne: vi.fn((query: Record<string, unknown>) => {
        // The open-international guard ($or) and the duplicate filter (provisions.*)
        // both target international/withdrawal bills — return none so the regular
        // national bill doesn't block a withdrawal proposal.
        if (
          "$or" in query ||
          Object.keys(query).some(
            (key) => key.startsWith("internationalAction") || key.startsWith("provisions")
          )
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve(regularBill);
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "bills") return billCollection;
        if (name === "characters") return { updateOne: vi.fn().mockResolvedValue({}) };
        return {};
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          name: "Ariadne Cole",
          party: "labour",
        },
      },
    } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      name: "Ariadne Cole",
      party: "labour",
      actions: 25,
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "Ariadne Cole",
      },
    } as never);
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "EU",
      name: "European Union",
    } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(144);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-leave/route");
    const response = await POST(
      new Request("http://localhost/api/country/uk/international-organizations/EU/propose-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "organization" }),
      }),
      { params: Promise.resolve({ code: "uk", orgId: "EU" }) }
    );

    expect(response.status).toBe(201);
    expect(billCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it("blocks a second unresolved international-organization withdrawal bill", async () => {
    const characterId = new ObjectId();
    const billCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: new ObjectId(),
        sponsorId: characterId,
        countryId: "UK",
        status: "active",
        internationalAction: {
          type: "leave_organization",
          organizationId: "NATO",
          targetCountryId: "UK",
        },
      }),
      insertOne: vi.fn(),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "bills") return billCollection;
        return {};
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          name: "Ariadne Cole",
        },
      },
    } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      name: "Ariadne Cole",
      actions: 25,
    } as never);
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "EU",
      name: "European Union",
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "Ariadne Cole",
      },
    } as never);
    vi.mocked(isMember).mockResolvedValue(true);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-leave/route");
    const response = await POST(
      new Request("http://localhost/api/country/uk/international-organizations/EU/propose-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "organization" }),
      }),
      { params: Promise.resolve({ code: "uk", orgId: "EU" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error:
          "You already have an international-organization withdrawal measure in progress. Wait for it to resolve before proposing another.",
      })
    );
    expect(billCollection.insertOne).not.toHaveBeenCalled();
  });

  it("blocks withdrawal proposals during a parliamentary legislation freeze", async () => {
    const characterId = new ObjectId();
    vi.mocked(getDb).mockResolvedValue({} as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          name: "Ariadne Cole",
        },
      },
    } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      name: "Ariadne Cole",
      actions: 25,
    } as never);
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "EU",
      name: "European Union",
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "Ariadne Cole",
      },
    } as never);
    vi.mocked(checkLegislationFreeze).mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Government is in formation; legislation is frozen until a PM is seated",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      ) as never,
    });

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-leave/route");
    const response = await POST(
      new Request("http://localhost/api/country/uk/international-organizations/EU/propose-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "organization" }),
      }),
      { params: Promise.resolve({ code: "uk", orgId: "EU" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Government is in formation; legislation is frozen until a PM is seated",
    });
    expect(isMember).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation when the lower-chamber election window would auto-fail the bill", async () => {
    const characterId = new ObjectId();
    const db = {
      collection: vi.fn(() => ({ findOne: vi.fn(), updateOne: vi.fn() })),
    };

    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          name: "Ariadne Cole",
        },
      },
    } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: characterId,
      name: "Ariadne Cole",
      actions: 25,
    } as never);
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "EU",
      name: "European Union",
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "Ariadne Cole",
      },
    } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(144);
    vi.mocked(getBillProposalAutoFailWarning).mockResolvedValue({
      countryId: "UK",
      originChamber: "commons",
      originChamberName: "House of Commons",
      lowerChamberKey: "commons",
      lowerChamberName: "House of Commons",
      electionType: "commons",
      electionName: "House of Commons general election",
      electionStatus: "upcoming",
      electionEndsAt: new Date("2026-05-01T12:00:00.000Z").toISOString(),
      lowerChamberExposureStartsAt: new Date("2026-04-30T12:00:00.000Z").toISOString(),
      lowerChamberExposureEndsAt: new Date("2026-05-01T12:00:00.000Z").toISOString(),
    });

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-leave/route");
    const response = await POST(
      new Request("http://localhost/api/country/uk/international-organizations/EU/propose-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "organization" }),
      }),
      { params: Promise.resolve({ code: "uk", orgId: "EU" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Election timing makes this bill likely to auto-fail.",
        requiresElectionRiskConfirmation: true,
        autoFailWarning: expect.objectContaining({
          electionName: "House of Commons general election",
        }),
      })
    );
  });
});
