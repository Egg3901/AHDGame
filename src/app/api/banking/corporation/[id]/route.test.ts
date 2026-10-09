import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
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

describe("bank console charter quotes", () => {
  beforeEach(() => vi.clearAllMocks());

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
      expect(body.eligibilityReasons).toEqual([
        `Insufficient treasury: need ${expected.toLocaleString()} USD posted capital`,
      ]);
      expect(db.collectionMocks.gameState!.findOne).toHaveBeenCalledTimes(1);
      // Visibility plus one gate per legal type, with no redundant failure probe.
      expect(db.collectionMocks.corporateSectors!.findOne).toHaveBeenCalledTimes(4);
    }
  );
});
