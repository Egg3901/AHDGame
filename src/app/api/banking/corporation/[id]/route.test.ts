import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import { CHARTER_CAPITAL_FOUNDING_MULTIPLE } from "@/lib/banking/charter";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), resolveCorporation: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(async () => ({ ok: true, user: { userId: "owner", isAdmin: false } })),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: mocks.resolveCorporation,
  requireCeo: vi.fn(() => null),
}));
vi.mock("@/lib/banking/policy", () => ({
  loadBankingPolicy: vi.fn(async () => ({ privateBanking: true })),
}));
vi.mock("@/lib/banking/rules/policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/banking/rules/policy")>()),
  savingsReadsAuthoritative: () => false,
}));
vi.mock("@/lib/banking/separationLaw", () => ({
  getLegalCharterTypes: vi.fn(async () => ["retail", "investment", "universal"]),
}));
vi.mock("@/lib/banking/regulationQ", () => ({ getRateCorridors: vi.fn(async () => null) }));
vi.mock("@/lib/banking/reserves", () => ({ getReserveRequirement: vi.fn(async () => 0) }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 27) }));

import { GET } from "./route";
import { requireCeo } from "@/lib/api/corporations/resolveQuery";

describe("bank console charter quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCeo).mockReturnValue(null);
  });

  it.each(["1953-default", "1991-default", "2019-default"])(
    "uses one preset read and preserves failed eligibility for %s",
    async (preset) => {
      const db = createMockDb();
      const corporation = {
        _id: new ObjectId(),
        name: "Fixture bank",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        countryId: "US",
      };
      mocks.getDb.mockResolvedValue(db);
      mocks.resolveCorporation.mockResolvedValue({ ok: true, corporation });
      db.collection("gameState");
      db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", preset });
      db.collection("gameConfig");
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ privateBankingEnabled: true });
      db.collection("corporateSectors");
      db.collectionMocks.corporateSectors!.findOne.mockResolvedValue({ _id: new ObjectId() });
      const response = await GET(new Request("http://localhost/api/banking/corporation/1"), {
        params: Promise.resolve({ id: "1" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const expected = Math.max(
        1,
        Math.round(
          (CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE) /
            getEraUnitScale(preset) /
            getGdpAnchorRate("US", preset)
        )
      );
      expect(body.capitalRequirement).toBe(expected);
      expect(body.eligibleTypes).toEqual([]);
      expect(body.canIssueCharter).toBe(false);
      expect(body.switchableTypes).toEqual([]);
      expect(body.eligibilityReasons).toEqual([
        `Insufficient treasury: need ${expected.toLocaleString()} USD posted capital`,
      ]);
      expect(db.collectionMocks.gameState!.findOne).toHaveBeenCalledTimes(1);
      // Visibility plus one gate per legal type, with no redundant failure probe.
      expect(db.collectionMocks.corporateSectors!.findOne).toHaveBeenCalledTimes(4);
    }
  );
});

describe("bank console loan book", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCeo).mockReturnValue(null);
  });

  it.each([
    { cooldown: false, owner: true },
    { cooldown: true, owner: true },
    { cooldown: false, owner: false },
  ])("reads the active charter and excludes blocked switches (%j)", async ({ cooldown, owner }) => {
    vi.mocked(requireCeo).mockReturnValue(owner ? null : new NextResponse(null, { status: 403 }));
    const db = createMockDb();
    const corporation = {
      _id: new ObjectId(),
      name: "Rechartered bank",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      countryId: "US",
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 20,
        charterSwitchCooldownUntilTurn: cooldown ? 40 : null,
        postedCapital: 1000,
        cashReserves: 1000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
      },
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.resolveCorporation.mockResolvedValue({ ok: true, corporation });
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
    });
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ privateBankingEnabled: true });
    db.collection("corporateSectors");
    db.collectionMocks.corporateSectors!.findOne.mockResolvedValue({ _id: new ObjectId() });

    const response = await GET(new Request("http://localhost/api/banking/corporation/1"), {
      params: Promise.resolve({ id: "1" }),
    });

    const body = await response.json();
    expect(body.switchableTypes).toEqual(cooldown || !owner ? [] : ["investment", "universal"]);
    expect(body.canIssueCharter).toBe(false);
    db.collection("bankLoans");
    const find = db.collectionMocks.bankLoans!.find;
    expect(find).toHaveBeenCalled();
    expect(find.mock.calls[0]![0]).toEqual({
      bankCorporationId: corporation._id,
      $or: [
        { charteredTurn: 20 },
        { charteredTurn: { $exists: false }, originatedTurn: { $gte: 20 } },
      ],
    });
  });
});
