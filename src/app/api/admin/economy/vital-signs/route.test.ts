import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("economicVitalSigns");
  vi.clearAllMocks();
});

async function setupAdmin() {
  const { getDb } = await import("@/lib/mongodb");
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", isAdmin: true },
  } as never);
}

describe("GET /api/admin/economy/vital-signs", () => {
  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/vital-signs"));
    expect(response.status).toBe(403);
  });

  it("returns a requested turn without exposing source rows", async () => {
    await setupAdmin();
    const snapshot = { _id: "turn:100", schemaVersion: 1, turn: 100 };
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue(snapshot);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/vital-signs?turn=100")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      snapshot,
      alerts: { corporateNoHolder: { status: "insufficient-data", warn: false } },
    });
    expect(db.collectionMocks.economicVitalSigns.findOne).toHaveBeenCalledWith({ turn: 100 });
  });

  it("passes new money and securities fields through untouched", async () => {
    await setupAdmin();
    const snapshot = {
      _id: "turn:100",
      schemaVersion: 1,
      turn: 100,
      money: {
        intermediatedGrossVelocity48: {
          value: 0.5,
          observations: 3,
          basis: "fund_org_npp_primary_ledger_flow_to_closing_balance",
        },
        householdTransactionalVelocity48: {
          value: 1.2,
          observations: 4,
          basis: "character_primary_ledger_flow_to_closing_balance",
        },
        householdSavingsVelocity48: {
          value: 0.1,
          observations: 4,
          basis: "character_savings_primary_ledger_flow_to_closing_balance",
        },
        savingsShareOfHouseholdBalances: {
          value: 0.4,
          observations: 2,
          basis: "character_savings_share_of_household_closing_balance",
        },
        bankCashReservesAnchor: {
          value: 200,
          observations: 2,
          basis: "active_chartered_bank_cash_reserves_anchor",
        },
        ringFencedShareOfLiquid: {
          value: 0.4,
          observations: 3,
          basis: "ring_fenced_to_ledger_backed_plus_ring_fenced_closing_stock",
        },
      },
      securities: {
        corporateMedianHolders: {
          value: 1,
          observations: 2,
          basis: "unmatured_corporate_issue_count",
        },
        corporateSubscriptionRate: {
          value: 0.4,
          observations: 2,
          basis: "unmatured_corporate_units",
        },
        corporateMedianPriceToParSpreadPct: {
          value: 2.5,
          observations: 2,
          basis: "unmatured_corporate_issue_count",
        },
        corporateMaturityHhi: {
          value: 5000,
          observations: 2,
          basis: "corporate_face_by_maturity_turn",
        },
        medianTopTraderNotionalShare48: {
          value: 0.7,
          observations: 2,
          basis: "named_counterparty_share_of_listing_notional_48_turns",
        },
      },
    };
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue(snapshot);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/vital-signs?turn=100")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot.money.intermediatedGrossVelocity48.value).toBe(0.5);
    expect(body.snapshot.money.householdTransactionalVelocity48.value).toBe(1.2);
    expect(body.snapshot.money.householdSavingsVelocity48.value).toBe(0.1);
    expect(body.snapshot.money.savingsShareOfHouseholdBalances.value).toBe(0.4);
    expect(body.snapshot.money.bankCashReservesAnchor.value).toBe(200);
    expect(body.snapshot.money.ringFencedShareOfLiquid.value).toBe(0.4);
    expect(body.snapshot.securities.corporateMedianHolders.value).toBe(1);
    expect(body.snapshot.securities.corporateSubscriptionRate.value).toBe(0.4);
    expect(body.snapshot.securities.corporateMedianPriceToParSpreadPct.value).toBe(2.5);
    expect(body.snapshot.securities.corporateMaturityHhi.value).toBe(5000);
    expect(body.snapshot.securities.medianTopTraderNotionalShare48.value).toBe(0.7);
  });

  it("reports the corporate no-holder target from the loaded rolling median", async () => {
    await setupAdmin();
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue({
      _id: "turn:100",
      turn: 100,
      securitiesRecent12: {
        corporateNoHolderBondShareMedian: {
          value: 0.672,
          observations: 12,
          basis: "unmatured_corporate_issue_count_median_12",
        },
      },
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/vital-signs"));
    expect(response.status).toBe(200);
    expect((await response.json()).alerts.corporateNoHolder).toMatchObject({
      status: "above-target",
      warn: true,
      threshold: 0.35,
      median: 0.672,
      observations: 12,
    });
    expect(db.collectionMocks.economicVitalSigns.findOne).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid turn", async () => {
    await setupAdmin();
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/vital-signs?turn=-1")
    );
    expect(response.status).toBe(400);
  });
});
