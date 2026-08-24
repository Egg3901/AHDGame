import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Bill } from "@/lib/db/types";
import { resolveBillProvisions } from "@/lib/congress/billEnrichment";
import { getStateLegislatureBillDetail } from "@/lib/legislature/queries/stateBillQueries";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));
vi.mock("@/lib/nationalization/billTargetPreview", () => ({
  computeNationalizationProvisionDetail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/nationalization/ledger", () => ({
  resolveActualPayoutLocal: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The same policy provision, resolved through the national adapter and through
 * the regional adapter, must agree on every shared field.
 *
 * Before the merge these were two independent implementations, and the regional
 * one silently lost snapshot awareness — which is the bug this branch fixes.
 * This test is the guard against that recurring: it fails the moment either
 * adapter starts resolving a provision its own way again.
 */
const LEG_TYPE = {
  _id: "ru_health",
  name: "Regional Health Programme",
  policyDomain: "welfare",
  effectTargetsWeighted: [
    { metricCategoryId: "society", metricId: "healthcareQuality", weight: 1 },
  ],
  policyOptions: [
    {
      id: "o1",
      name: "Minimal",
      explanation: "Token funding.",
      stance: "right",
      effectDirection: 1,
      economic: 2,
      social: 0,
    },
    {
      id: "o2",
      name: "Universal",
      explanation: "Full coverage.",
      stance: "left",
      effectDirection: -1,
      economic: -2,
      social: 0,
    },
  ],
};

const PROVISION = {
  legislationTypeId: "ru_health",
  policyOptionId: "o2",
  effectDirection: -1,
  economic: -2,
  currentPolicyOptionIdSnapshot: "o1",
  currentPolicyOptionNameSnapshot: "Minimal",
  currentPolicyOptionExplanationSnapshot: "Token funding.",
  policyOptionNameSnapshot: "Universal",
  policyOptionExplanationSnapshot: "Full coverage.",
};

/** Fields both adapters own. Do NOT trim this list to make the test pass — a
 * mismatch here is a real divergence in one of the two adapters. */
const SHARED_FIELDS = [
  "legislationTypeId",
  "legislationTypeName",
  "policyOptionId",
  "proposed",
  "current",
  "proposedPolicyIndex",
  "currentPolicyIndex",
  "effectDirection",
  "directionLabel",
  "effects",
  "policyDomain",
  "policyOptionScores",
  "economic",
  "social",
  "annualCostPerCapita",
  "gdpPerCapitaMultiplier",
] as const;

const cursorOf = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  sort: vi.fn().mockReturnThis(),
  project: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

function stubCatalog(db: MockDb) {
  db.collection("legislationTypes");
  db.collectionMocks["legislationTypes"]!.find.mockReturnValue(cursorOf([LEG_TYPE]));
  db.collection("statePolicies");
  db.collectionMocks["statePolicies"]!.find.mockReturnValue(cursorOf([]));
  db.collection("enactedLaws");
  db.collectionMocks["enactedLaws"]!.find.mockReturnValue(cursorOf([]));
}

describe("national / regional provision parity", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    stubCatalog(db);
  });

  it("resolves the same provision identically on both paths", async () => {
    const national = await resolveBillProvisions(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "RU",
        stateId: "ru_national",
        provisions: [PROVISION],
      } as unknown as Bill
    );

    const regionalDb = createMockDb();
    stubCatalog(regionalDb);
    regionalDb.collection("stateBills");
    regionalDb.collectionMocks["stateBills"]!.findOne.mockResolvedValue({
      _id: "507f1f77bcf86cd799439011",
      stateId: "MOW",
      countryId: "RU",
      title: "T",
      summary: "S",
      sponsorName: "NPP",
      sponsorParty: "1",
      status: "active",
      votesFor: 1,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      proposedAt: new Date("2026-06-07T00:00:00Z"),
      legislationTypeId: "ru_health",
      provisions: [PROVISION],
    });

    const regional = await getStateLegislatureBillDetail(regionalDb as unknown as Db, {
      countryId: "RU",
      stateId: "MOW",
      billId: "507f1f77bcf86cd799439011",
      authUser: null,
    });

    const a = national.provisionsResolved[0] as unknown as Record<string, unknown>;
    const b = regional!.provisions[0] as unknown as Record<string, unknown>;

    // Guard against a vacuous pass: if both sides resolved to nothing, every
    // field would match and the test would prove nothing.
    expect(a.proposed).toEqual({ name: "Universal", explanation: "Full coverage." });
    expect(a.current).toEqual({ name: "Minimal", explanation: "Token funding." });
    expect(a.effects).toBeTruthy();
    expect(a.policyOptionScores).toEqual([2, -2]);

    for (const field of SHARED_FIELDS) {
      expect({ field, value: b[field] }).toEqual({ field, value: a[field] });
    }
  });
});
