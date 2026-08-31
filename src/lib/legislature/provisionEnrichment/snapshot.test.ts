import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { snapshotBillPolicyProvisions } from "./snapshot";

const LT = {
  _id: "ru_health",
  policyOptions: [
    { id: "o0", name: "Repeal", effectDirection: 1, explanation: "No programme." },
    { id: "o1", name: "Minimal", effectDirection: 1, explanation: "Token funding." },
    { id: "o2", name: "Universal", effectDirection: -1, explanation: "Full coverage." },
  ],
};

describe("snapshotBillPolicyProvisions", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("legislationTypes").find.mockReturnValue({ toArray: async () => [LT] });
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [
        { legislationTypeId: "ru_health", policyOptionId: "o1", policyOptionIndex: 1 },
      ],
    });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
  });

  it("stamps structured proposed and current labels for a region-scoped bill", async () => {
    const [out] = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );

    expect(out.policyOptionNameSnapshot).toBe("Universal");
    expect(out.policyOptionExplanationSnapshot).toBe("Full coverage.");
    expect(out.currentPolicyOptionIdSnapshot).toBe("o1");
    expect(out.currentPolicyOptionNameSnapshot).toBe("Minimal");
    expect(out.currentPolicyOptionExplanationSnapshot).toBe("Token funding.");
  });

  it("keys statePolicies on the region id, not on a scope field", async () => {
    await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );
    const filter = db.collectionMocks["statePolicies"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.stateId).toBe("MOW");
    expect(filter.scope).toBeUndefined();
  });

  it("keys statePolicies on the national pseudo-stateId for national scope", async () => {
    await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "national", countryId: "US" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );
    const filter = db.collectionMocks["statePolicies"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.stateId).toBe("federal");
  });

  it("never combines name and explanation into one string", async () => {
    const [out] = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );
    expect(out.policyOptionNameSnapshot).not.toContain(": ");
  });

  it("leaves tax-slider labels stamped by stampTaxSliderProvisions untouched", async () => {
    // Ordering invariant: the snapshot pass runs AFTER stampTaxSliderProvisions in
    // proposeStateBill. A slider provision's synthetic "rate:" id resolves to no
    // option, so the conditional spread must not overwrite its labels.
    const [out] = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [
        {
          legislationTypeId: "ru_health",
          policyOptionId: "rate:38",
          effectDirection: 1,
          economic: 2,
          social: 0,
          policyOptionNameSnapshot: "Rate: 38%",
          currentPolicyOptionNameSnapshot: "Rate: 35%",
        },
      ]
    );
    expect(out.policyOptionNameSnapshot).toBe("Rate: 38%");
    expect(out.policyOptionExplanationSnapshot).toBeUndefined();
  });

  it("does not stamp a current label when no current law exists", async () => {
    db.collection("statePolicies").find.mockReturnValue({ toArray: async () => [] });
    const [out] = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );
    expect(out.currentPolicyOptionIdSnapshot).toBeUndefined();
    expect(out.currentPolicyOptionNameSnapshot).toBeUndefined();
  });

  it("falls back to enactedLaws for the current law when statePolicies has no row", async () => {
    db.collection("statePolicies").find.mockReturnValue({ toArray: async () => [] });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({
        toArray: async () => [{ legislationTypeId: "ru_health", policyOptionIndex: 0 }],
      }),
    });
    const [out] = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [{ legislationTypeId: "ru_health", policyOptionId: "o2", effectDirection: -1 }]
    );
    expect(out.currentPolicyOptionIdSnapshot).toBe("o0");
    expect(out.currentPolicyOptionNameSnapshot).toBe("Repeal");
  });

  it("returns the input unchanged when there are no provisions", async () => {
    const out = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      []
    );
    expect(out).toEqual([]);
  });
});
