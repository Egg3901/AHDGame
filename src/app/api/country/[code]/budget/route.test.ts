import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

const {
  getDbMock,
  requireHumanSessionMock,
  getGameStateMock,
  chancellorFindOneMock,
  governmentFindOneMock,
  upsertBudgetDraftMock,
  tableBudgetWithBillMock,
  buildAnnualBudgetProvisionsMock,
  getEnactedLevelsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireHumanSessionMock: vi.fn(),
  getGameStateMock: vi.fn(),
  chancellorFindOneMock: vi.fn(),
  governmentFindOneMock: vi.fn(),
  upsertBudgetDraftMock: vi.fn(),
  tableBudgetWithBillMock: vi.fn(),
  buildAnnualBudgetProvisionsMock: vi.fn(),
  getEnactedLevelsMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: requireHumanSessionMock,
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: getGameStateMock }));
vi.mock("@/lib/db/collections/cabinetMembers", () => ({
  getCabinetMembersCollection: vi.fn(() => ({ findOne: chancellorFindOneMock })),
}));
vi.mock("@/lib/db/collections/governmentFormation", () => ({
  getGovernmentFormationsCollection: vi.fn(() => ({ findOne: governmentFindOneMock })),
}));
vi.mock("@/lib/db/collections/ukBudgets", () => ({
  getBudgetForFiscalYear: vi.fn(),
  upsertBudgetDraft: upsertBudgetDraftMock,
  tableBudgetWithBill: tableBudgetWithBillMock,
}));
vi.mock("@/lib/politicalLegislation/enactedLevels", () => ({
  getEnactedLevels: getEnactedLevelsMock,
}));
vi.mock("@/lib/uk/budget/annualBudget", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/uk/budget/annualBudget")>();
  return {
    ...original,
    buildAnnualBudgetProvisions: buildAnnualBudgetProvisionsMock,
    previewAnnualBudget: vi.fn(),
  };
});

function postBudget(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/uk/budget", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/budget", () => {
  const primeMinisterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockResolvedValue({ collection: vi.fn() } as unknown as Db);
    requireHumanSessionMock.mockResolvedValue({
      ok: true,
      user: {
        character: {
          _id: primeMinisterId,
          name: "Prime Minister",
          party: "labour",
        },
      },
    });
    chancellorFindOneMock.mockResolvedValue(null);
    governmentFindOneMock.mockResolvedValue({ pmCharacterId: primeMinisterId });
    getGameStateMock.mockResolvedValue({
      currentTurn: 100,
      currentYear: 1953,
      startingYear: 1953,
    });
    upsertBudgetDraftMock.mockResolvedValue({ ok: true });
    getEnactedLevelsMock.mockResolvedValue(new Map());
    buildAnnualBudgetProvisionsMock.mockResolvedValue({
      ok: true,
      provisions: [
        {
          legislationTypeId: "uk.tax.incomeTax",
          policyOptionId: "rate:46",
          proposedRate: 46,
          effectDirection: 1,
        },
      ],
    });
    tableBudgetWithBillMock.mockResolvedValue({ ok: true, billId: new ObjectId() });
  });

  it("lets the Prime Minister table the omnibus bill while the Chancellorship is vacant", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      postBudget({
        action: "table",
        taxRates: { "uk.tax.incomeTax": 46 },
        programLevels: {},
      }),
      { params: Promise.resolve({ code: "uk" }) }
    );
    if (!response) throw new Error("route returned no response");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ ok: true, tabled: true, billId: expect.any(String) })
    );
    expect(tableBudgetWithBillMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chancellorCharacterId: primeMinisterId,
        chancellorName: "Prime Minister",
        currentTurn: 100,
        provisions: [
          expect.objectContaining({
            legislationTypeId: "uk.tax.incomeTax",
            proposedRate: 46,
          }),
        ],
      })
    );
  });

  it("rejects an ordinary viewer even when the Chancellorship is vacant", async () => {
    governmentFindOneMock.mockResolvedValue({ pmCharacterId: new ObjectId() });
    const { POST } = await import("./route");
    const response = await POST(postBudget({ action: "save", taxRates: {}, programLevels: {} }), {
      params: Promise.resolve({ code: "uk" }),
    });
    if (!response) throw new Error("route returned no response");

    expect(response.status).toBe(403);
    expect(upsertBudgetDraftMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/country/[code]/budget", () => {
  const billId = new ObjectId();

  function dbWithBills(bills: unknown[]) {
    return {
      collection: (name: string) => {
        if (name === "bills") {
          return { find: () => ({ toArray: async () => bills }) };
        }
        return { findOne: async () => null };
      },
    } as unknown as Db;
  }

  it("includes the fiscal year's vote-vehicle bill (ticket #1268)", async () => {
    getDbMock.mockResolvedValue(
      dbWithBills([
        {
          _id: billId,
          status: "active",
          votesFor: 297,
          votesAgainst: 221,
          votesAbstain: 3,
          votingEndsAt: new Date("2026-09-03T22:04:33.627Z"),
          votingEndsOnTurn: 605,
          proposedTurn: 581,
        },
      ])
    );
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/uk/budget"), {
      params: Promise.resolve({ code: "uk" }),
    });
    if (!response) throw new Error("route returned no response");

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.voteBill).toEqual({
      id: billId.toString(),
      status: "active",
      votesFor: 297,
      votesAgainst: 221,
      votesAbstain: 3,
      votingEndsAt: "2026-09-03T22:04:33.627Z",
      votingEndsOnTurn: 605,
    });
  });

  it("returns a null voteBill when no budget bill exists yet", async () => {
    getDbMock.mockResolvedValue(dbWithBills([]));
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/uk/budget"), {
      params: Promise.resolve({ code: "uk" }),
    });
    if (!response) throw new Error("route returned no response");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ voteBill: null }));
  });
});
