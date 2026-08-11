import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// recordOrgHistoryEvent writes to a wireEvents-adjacent collection; stub it
// so the test can focus on the rescission-sentiment hook without depending on
// the broader org-history wiring.
vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("applyInternationalWithdrawalMeasure — FTA rescission sentiment hook", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  function setupFta(params: {
    legislationId: ObjectId;
    type: string;
    status: string;
    parties: string[];
  }) {
    db.collection("organizationLegislation");
    db.collectionMocks["organizationLegislation"]!.findOne.mockResolvedValue({
      _id: params.legislationId,
      type: params.type,
      status: params.status,
      parties: params.parties,
      title: "Test FTA",
      organizationId: "UN",
    });
  }

  function setupSignedSectorTariffs(perCountry: Record<string, string[]>) {
    // Mock bills.find().project().toArray() to return signed sector-tariff
    // bills filtered by countryId (extracted from the call's filter argument).
    db.collection("bills");
    db.collectionMocks["bills"]!.find.mockImplementation((filter: { countryId?: string }) => ({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(
          (perCountry[filter.countryId ?? ""] ?? []).map((sectorType) => ({
            provisions: [
              { type: "tariff", scopeType: "sector", targetSectorType: sectorType, rate: 30 },
            ],
          }))
        ),
      }),
    }));
  }

  function pulsesByCountry() {
    db.collection("sentimentPulses");
    const calls = db.collectionMocks["sentimentPulses"]!.insertOne.mock.calls.map(
      (c) =>
        c[0] as {
          countryId: string;
          sectorType: string;
          initialImpact: number;
          hqRelation?: string;
        }
    );
    const grouped: Record<string, typeof calls> = {};
    for (const p of calls) {
      grouped[p.countryId] = grouped[p.countryId] ?? [];
      grouped[p.countryId].push(p);
    }
    return grouped;
  }

  it("fires foreign-side sentiment pulses for every original party of an active FTA", async () => {
    const legId = new ObjectId();
    setupFta({
      legislationId: legId,
      type: "free_trade_agreement",
      status: "active",
      parties: ["UK", "US", "JP", "DE"],
    });
    setupSignedSectorTariffs({
      UK: ["energy", "media"],
      US: ["technology"],
      JP: [],
      DE: ["automobiles"],
    });

    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_free_trade_agreement",
          targetCountryId: "US",
          organizationId: "UN",
          organizationName: "United Nations",
          organizationLegislationId: legId.toString(),
          organizationLegislationTitle: "Test FTA",
        } as never,
      },
      100
    );

    const grouped = pulsesByCountry();
    // UK has two sectors (energy, media), US one (technology), JP none, DE one (automobiles)
    expect(grouped.UK).toHaveLength(2);
    expect(grouped.US).toHaveLength(1);
    expect(grouped.JP ?? []).toHaveLength(0);
    expect(grouped.DE).toHaveLength(1);
    // Every pulse must be the foreign-side, sentiment-cap-symmetric -0.07 hit.
    for (const [, pulses] of Object.entries(grouped)) {
      for (const p of pulses) {
        expect(p.hqRelation).toBe("foreign");
        expect(p.initialImpact).toBe(-0.07);
      }
    }
  });

  it("fires pulses on full FTA termination (only one party remains after withdrawal)", async () => {
    const legId = new ObjectId();
    setupFta({
      legislationId: legId,
      type: "free_trade_agreement",
      status: "active",
      parties: ["UK", "US"],
    });
    setupSignedSectorTariffs({ UK: ["energy"], US: ["technology"] });

    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_free_trade_agreement",
          targetCountryId: "US",
          organizationId: "UN",
          organizationName: "United Nations",
          organizationLegislationId: legId.toString(),
          organizationLegislationTitle: "Test FTA",
        } as never,
      },
      100
    );

    // Pulses fire for both former parties even though the FTA dissolves —
    // each party's signed sector tariffs now apply to the other.
    const grouped = pulsesByCountry();
    expect(grouped.UK).toHaveLength(1);
    expect(grouped.US).toHaveLength(1);
  });

  it("does NOT fire pulses for non-FTA legislation withdrawals", async () => {
    const legId = new ObjectId();
    setupFta({
      legislationId: legId,
      type: "treaty", // not an FTA
      status: "active",
      parties: ["UK", "US"],
    });
    setupSignedSectorTariffs({ UK: ["energy"], US: ["technology"] });

    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_free_trade_agreement", // intentional mismatch — bill says FTA-leave but legislation is a treaty
          targetCountryId: "US",
          organizationId: "UN",
          organizationName: "United Nations",
          organizationLegislationId: legId.toString(),
          organizationLegislationTitle: "Test treaty",
        } as never,
      },
      100
    );

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
  });

  it("does NOT fire pulses for an already-terminated FTA (idempotent)", async () => {
    // Defensive: re-running a withdrawal flow against a legislation that
    // already shows status !== "active" must not double-fire pulses.
    const legId = new ObjectId();
    setupFta({
      legislationId: legId,
      type: "free_trade_agreement",
      status: "terminated",
      parties: ["UK", "US"],
    });
    setupSignedSectorTariffs({ UK: ["energy"], US: ["technology"] });

    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_free_trade_agreement",
          targetCountryId: "US",
          organizationId: "UN",
          organizationName: "United Nations",
          organizationLegislationId: legId.toString(),
          organizationLegislationTitle: "Test FTA",
        } as never,
      },
      100
    );

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
  });

  it("does NOT fire pulses when the withdrawing country isn't a party (early return)", async () => {
    // Withdrawal bill says US is leaving, but the FTA's party list doesn't
    // include US — the function early-returns before any state change.
    const legId = new ObjectId();
    setupFta({
      legislationId: legId,
      type: "free_trade_agreement",
      status: "active",
      parties: ["UK", "JP", "DE"],
    });
    setupSignedSectorTariffs({ UK: ["energy"], JP: ["technology"], DE: ["automobiles"] });

    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_free_trade_agreement",
          targetCountryId: "US",
          organizationId: "UN",
          organizationName: "United Nations",
          organizationLegislationId: legId.toString(),
          organizationLegislationTitle: "Test FTA",
        } as never,
      },
      100
    );

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
  });
});

describe("removeOrganizationMembership — withdrawal tombstone", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("records a tombstone so the founding-member self-heal won't re-add the country", async () => {
    const { applyInternationalWithdrawalMeasure } = await import("./withdrawalBills");
    await applyInternationalWithdrawalMeasure(
      db as unknown as Db,
      {
        internationalAction: {
          type: "leave_organization",
          targetCountryId: "DE",
          organizationId: "NATO",
          organizationName: "North Atlantic Treaty Organization",
        } as never,
      },
      628
    );

    // Membership deleted...
    expect(db.collectionMocks.organizationMemberships!.deleteOne).toHaveBeenCalledWith({
      organizationId: "NATO",
      countryId: "DE",
    });
    // ...and a tombstone upserted for (NATO, DE).
    const tombstoneUpsert = db.collectionMocks.organizationWithdrawals!.updateOne;
    expect(tombstoneUpsert).toHaveBeenCalledTimes(1);
    const [filter, , opts] = tombstoneUpsert.mock.calls[0];
    expect(filter).toEqual({ organizationId: "NATO", countryId: "DE" });
    expect(opts).toEqual({ upsert: true });
  });
});

describe("billRequiresExecutiveAction — war declarations", () => {
  it("does not send a declaration to the executive", async () => {
    const { billRequiresExecutiveAction } = await import("./withdrawalBills");
    // The same treatment international-organization bills already get: the
    // executive introduced it, so signing their own bill is a no-op.
    expect(
      billRequiresExecutiveAction({
        countryId: "US",
        stateId: "federal",
        provisions: [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      } as never)
    ).toBe(false);
  });

  it("still routes an ordinary presidential bill to the executive", async () => {
    const { billRequiresExecutiveAction } = await import("./withdrawalBills");
    expect(
      billRequiresExecutiveAction({
        countryId: "US",
        stateId: "federal",
        provisions: [{ type: "embargo", targetCountry: "CN" }],
      } as never)
    ).toBe(true);
  });
});
