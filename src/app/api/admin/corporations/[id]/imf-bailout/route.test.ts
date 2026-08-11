import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/api/validate", () => ({ parseJsonBody: vi.fn() }));
vi.mock("@/lib/imf/resolveImfCorporation", () => ({ getImfCorporation: vi.fn() }));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("bonds");
  db.collection("bondHistory");
  db.collection("corporationHistory");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);

  const { getImfCorporation } = await import("@/lib/imf/resolveImfCorporation");
  vi.mocked(getImfCorporation).mockResolvedValue({
    _id: new ObjectId(),
    imfInstitution: true,
  } as never);
});

describe("GET /api/admin/corporations/[id]/imf-bailout", () => {
  it("returns bond rows and simulation for preview mode", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      name: "BondCorp",
      countryId: "US",
      imfBailoutActive: false,
    });
    db.collectionMocks.corporationHistory.findOne.mockResolvedValueOnce({
      income: 50_000,
      turn: 100,
    });
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          totalIssued: 1_000_000,
          couponRate: 5,
        },
      ],
    });

    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://localhost/api/admin/corporations/x/imf-bailout?retention=0.7&annualRate=6&amortizationTurns=240&incomeCapturePercent=35"
      ),
      { params: Promise.resolve({ id: corpId.toString() }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mode).toBe("preview");
    expect(json.bonds).toHaveLength(1);
    expect(json.facilityPrincipal).toBeGreaterThan(0);
    expect(json.simulation).toBeDefined();
    expect(json.lastReportedTurnIncome).toBe(50_000);
  });

  it("PATCH updates income capture fraction when bailout is active", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      name: "ActiveCorp",
      imfBailoutActive: true,
    });

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { incomeCapturePercent: 40 },
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: corpId.toString() }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({
        $set: expect.objectContaining({ imfFacilityIncomeCaptureFraction: expect.any(Number) }),
      })
    );
  });
});

describe("POST /api/admin/corporations/[id]/imf-bailout", () => {
  it("rejects reapplying an already active bailout", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      name: "TestCorp",
      countryId: "US",
      headquartersState: "US_CA",
      totalShares: 1_000_000,
      shareholders: [],
      imfBailoutActive: true,
    });

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: {
        active: true,
        targetOwnershipPercent: 40,
        annualRatePercent: 6,
        amortizationTurns: 240,
        bondHaircutRetention: 0.7,
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });

    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("rejects activation when there is no outstanding bond principal", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      name: "DebtFreeCorp",
      countryId: "US",
      headquartersState: "US_CA",
      totalShares: 1_000_000,
      shareholders: [],
      imfBailoutActive: false,
    });
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [],
    });

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: {
        active: true,
        targetOwnershipPercent: 40,
        annualRatePercent: 6,
        amortizationTurns: 240,
        bondHaircutRetention: 0.7,
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("outstanding bond principal");
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("does not issue more IMF shares when the existing stake already meets the target", async () => {
    const corpId = new ObjectId();
    const imfCorpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      name: "ReactivatedCorp",
      countryId: "US",
      headquartersState: "US_CA",
      totalShares: 1_000_000,
      shareholders: [{ corporationId: imfCorpId, shares: 666_666 }],
      imfBailoutActive: false,
    });
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          totalIssued: 100_000,
          holders: [],
        },
      ],
    });

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: {
        active: true,
        targetOwnershipPercent: 40,
        annualRatePercent: 6,
        amortizationTurns: 240,
        bondHaircutRetention: 0.7,
      },
    } as never);

    const { getImfCorporation } = await import("@/lib/imf/resolveImfCorporation");
    vi.mocked(getImfCorporation).mockResolvedValue({
      _id: imfCorpId,
      imfInstitution: true,
    } as never);

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.newSharesIssuedToImf).toBe(0);
    expect(json.newTotalShares).toBe(1_000_000);
  });
});
