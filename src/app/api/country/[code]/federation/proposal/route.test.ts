import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getCountryConfig } from "@/lib/constants/countries";
import { processFederationRatifications } from "@/lib/turn/federationRatifications";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getGameState: vi.fn(),
  requireBasicAuth: vi.fn(),
  getCharacterByUserId: vi.fn(),
  checkLegislationFreeze: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/gameState", () => ({ getGameState: mocks.getGameState }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: mocks.getCharacterByUserId }));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: mocks.checkLegislationFreeze,
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ code: "cs" }) };
const characterId = new ObjectId();
function request(financialTerms: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/country/cs/federation/proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ negotiatedCustodians: {}, ...financialTerms }),
  });
}

describe("federation proposal action", () => {
  let mem: ReturnType<typeof createInMemoryDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 96 },
    ]);
    mem.seed("states", csRegions1991 as unknown as Record<string, unknown>[]);
    mocks.getDb.mockResolvedValue(mem as unknown as Db);
    mocks.getGameState.mockResolvedValue({
      preset: "1991-default",
      currentYear: 1992,
      currentTurn: 96,
    });
    mocks.requireBasicAuth.mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: false },
    });
    mocks.getCharacterByUserId.mockResolvedValue({ _id: characterId });
    mocks.checkLegislationFreeze.mockResolvedValue({ ok: true });
  });

  it("rejects an unseated character without opening a vote", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(await mem.collection("bills").countDocuments({})).toBe(0);
  });

  it("binds separate asset and debt shares into the ordinary mandate", async () => {
    const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        characterId,
        countryId: "CS",
        officeType: getOfficeTypeForChamber("CS", chamber, "1991-default"),
      },
    ]);
    const response = await POST(
      request({ assetSharesBps: { CZ2: 6000, SK: 4000 }, debtSharesBps: { CZ2: 7000, SK: 3000 } }),
      params
    );
    expect(response.status).toBe(201);
    const proposal = await mem
      .collection("federationPoliticalProposals")
      .findOne({ sourceEntityId: "CS" });
    const bill = await mem.collection("bills").findOne({ _id: proposal!.billId });
    expect(bill?.summary).toContain("Public financial assets use CZ2 60.00%, SK 40.00%");
    expect(bill?.summary).toContain("Existing debt and any cash deficit use CZ2 70.00%, SK 30.00%");
    expect(proposal?.terms).toMatchObject({
      assetBasis: "negotiated",
      debtBasis: "negotiated",
      assetWeights: { CZ2: 6000, SK: 4000 },
      debtWeights: { CZ2: 7000, SK: 3000 },
    });
  });

  it("opens a fresh mandate after rejection and exposes the latest revision", async () => {
    const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        characterId,
        countryId: "CS",
        officeType: getOfficeTypeForChamber("CS", chamber, "1991-default"),
      },
    ]);
    expect((await POST(request(), params)).status).toBe(201);
    const first = await mem
      .collection("federationPoliticalProposals")
      .findOne({ sourceEntityId: "CS" });
    await mem.collection("bills").updateOne({ _id: first!.billId }, { $set: { status: "failed" } });
    await processFederationRatifications(mem as unknown as Db, "1991-default", 97);
    const before = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    expect(await before.json()).toMatchObject({
      proposal: { revision: 1, status: "rejected", canRevise: true },
    });
    expect(
      (await POST(request({ revision: 2, assetSharesBps: { CZ2: 6000, SK: 4000 } }), params)).status
    ).toBe(201);
    const after = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    expect(await after.json()).toMatchObject({
      proposal: {
        revision: 2,
        status: "open",
        canRevise: false,
        consents: [],
        financialTerms: { assetSharesBps: { CZ2: 6000, SK: 4000 } },
      },
    });
    expect((await POST(request({ revision: 3 }), params)).status).toBe(409);
    expect(await mem.collection("bills").countDocuments({})).toBe(2);
  });

  it("exposes an autonomous rejection reason and permits a fresh vote without reusing consent", async () => {
    const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        characterId,
        countryId: "CS",
        officeType: getOfficeTypeForChamber("CS", chamber, "1991-default"),
      },
    ]);
    expect(
      (
        await POST(
          request({ assetSharesBps: { CZ2: 10000, SK: 0 }, debtSharesBps: { CZ2: 0, SK: 10000 } }),
          params
        )
      ).status
    ).toBe(201);
    const first = await mem
      .collection("federationPoliticalProposals")
      .findOne({ sourceEntityId: "CS" });
    await mem
      .collection("bills")
      .updateOne({ _id: first!.billId }, { $set: { status: "signed", enactedAt: new Date(1) } });
    await processFederationRatifications(mem as unknown as Db, "1991-default", 97);
    const before = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    const body = await before.json();
    expect(body.proposal).toMatchObject({ status: "rejected", canRevise: true });
    expect(body.proposal.consents).toContainEqual(
      expect.objectContaining({
        entityId: "SK",
        choice: "reject",
        reason: expect.stringContaining("Debt exceeds"),
      })
    );
    expect((await POST(request({ revision: 2 }), params)).status).toBe(201);
    const after = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    expect(await after.json()).toMatchObject({ proposal: { revision: 2, consents: [] } });
    expect(await mem.collection("federationRatifications").countDocuments({ revision: 1 })).toBe(2);
    expect(await mem.collection("federationRatifications").countDocuments({ revision: 2 })).toBe(0);
  });

  it.each([{ CZ2: 6000, SK: 3000 }, { CZ2: 6000, RU: 4000 }, { CZ2: 10000 }])(
    "rejects incomplete or unbalanced financial shares before opening a bill: %j",
    async (assetSharesBps) => {
      const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
      mem.seed("electedOfficials", [
        {
          _id: new ObjectId(),
          characterId,
          countryId: "CS",
          officeType: getOfficeTypeForChamber("CS", chamber, "1991-default"),
        },
      ]);
      expect((await POST(request({ assetSharesBps }), params)).status).toBe(400);
      expect(await mem.collection("bills").countDocuments({})).toBe(0);
    }
  );

  it("opens the Soviet split through the seated Union Congress and lists all republics", async () => {
    mem.seed("states", sovietUnionRegions1991 as unknown as Record<string, unknown>[]);
    const chamber = getCountryConfig("RU", "1991-default").legislature.lowerChamber.key;
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        characterId,
        countryId: "RU",
        officeType: getOfficeTypeForChamber("RU", chamber, "1991-default"),
      },
    ]);
    const ruParams = { params: Promise.resolve({ code: "ru" }) };
    const response = await POST(
      new Request("http://localhost/api/country/ru/federation/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ negotiatedCustodians: {} }),
      }),
      ruParams
    );
    expect(response.status).toBe(201);
    const listed = await GET(
      new Request("http://localhost/api/country/ru/federation/proposal"),
      ruParams
    );
    const body = await listed.json();
    expect(body.participants).toHaveLength(15);
    expect(body.participants).toContain("RU");
    expect(body.proposal.billStatus).toBe("active");
    expect(await mem.collection("federationSettlementApplications").countDocuments({})).toBe(0);
  });

  it("opens one normal bill for a seated legislator and exposes its status", async () => {
    const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
    const officeType = getOfficeTypeForChamber("CS", chamber, "1991-default");
    mem.seed("electedOfficials", [
      { _id: new ObjectId(), characterId, countryId: "CS", officeType },
    ]);
    const response = await POST(request(), params);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { billId: string };
    expect(ObjectId.isValid(body.billId)).toBe(true);
    const listed = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    expect(await listed.json()).toMatchObject({
      proposal: { billId: body.billId, billStatus: "active" },
    });
    expect(await mem.collection("bills").countDocuments({})).toBe(1);
  });
});
