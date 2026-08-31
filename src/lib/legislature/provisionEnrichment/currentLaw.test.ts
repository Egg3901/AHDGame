import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { LegislationType } from "@/lib/db/types";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { resolveCurrentLaw, resolveProposedLabel, loadLiveCurrentPolicies } from "./currentLaw";

const lt = {
  _id: "ru_health",
  policyOptions: [
    { id: "o0", name: "Repeal", effectDirection: 1, explanation: "No programme." },
    { id: "o1", name: "Minimal", effectDirection: 1, explanation: "Token funding." },
    { id: "o2", name: "Universal", effectDirection: -1, explanation: "Full coverage." },
  ],
} as unknown as LegislationType;

describe("resolveCurrentLaw — precedence", () => {
  it("prefers the id snapshot over the live row", () => {
    const out = resolveCurrentLaw(
      lt,
      { effectDirection: -1, currentPolicyOptionIdSnapshot: "o1" },
      { policyOptionIndex: 2 }
    );
    expect(out.index).toBe(1);
    expect(out.label).toEqual({ name: "Minimal", explanation: "Token funding." });
  });

  it("REGRESSION: after enactment the live row equals the proposal, but the snapshot still wins", () => {
    // This is the reported bug. Without snapshot precedence the current box
    // renders the bill's own outcome and the bill looks like it re-passed the
    // law already in force.
    const out = resolveCurrentLaw(
      lt,
      { effectDirection: -1, policyOptionId: "o2", currentPolicyOptionIdSnapshot: "o1" },
      { policyOptionIndex: 2 } // live == proposed, post-enactment
    );
    expect(out.label?.name).toBe("Minimal");
    expect(out.index).toBe(1);
  });

  it("prefers a structured label snapshot over re-resolving the id, but keeps the id's index", () => {
    // Frozen text wins so a later seed-text edit does not rewrite history. The
    // index still comes from the id, because it drives the effect chips and the
    // approval shift and must not fall back to the live row.
    const out = resolveCurrentLaw(
      lt,
      {
        effectDirection: -1,
        currentPolicyOptionIdSnapshot: "o1",
        currentPolicyOptionNameSnapshot: "Minimal (as it read then)",
        currentPolicyOptionExplanationSnapshot: "Token funding, historical wording.",
      },
      { policyOptionIndex: 2 }
    );
    expect(out.label).toEqual({
      name: "Minimal (as it read then)",
      explanation: "Token funding, historical wording.",
    });
    expect(out.index).toBe(1);
  });

  it("re-resolves from the id when only a legacy combined label was stored", () => {
    // This is how the 33 lossy labels are corrected on documents the migration
    // has not reached: the combined string dropped the option name, but the id
    // still identifies the option.
    const out = resolveCurrentLaw(
      lt,
      {
        effectDirection: -1,
        currentPolicyOptionIdSnapshot: "o1",
        currentPolicyOptionNameSnapshot: "Token funding.",
      },
      { policyOptionIndex: 2 }
    );
    expect(out.label).toEqual({ name: "Minimal", explanation: "Token funding." });
    expect(out.index).toBe(1);
  });

  it("uses structured name/explanation snapshots when no id snapshot exists", () => {
    const out = resolveCurrentLaw(
      lt,
      {
        effectDirection: -1,
        currentPolicyOptionNameSnapshot: "Minimal",
        currentPolicyOptionExplanationSnapshot: "Token funding.",
      },
      { policyOptionIndex: 2 }
    );
    expect(out.label).toEqual({ name: "Minimal", explanation: "Token funding." });
  });

  it("splits a legacy combined snapshot when there is no structured pair", () => {
    const out = resolveCurrentLaw(
      lt,
      { effectDirection: -1, currentPolicyOptionNameSnapshot: "Minimal: Token funding." },
      undefined
    );
    expect(out.label).toEqual({ name: "Minimal", explanation: "Token funding." });
  });

  it("takes the ladder index from the live row when only a legacy label is stored", () => {
    // There is no id to place the label on the ladder. The index drives the
    // effect chips, and the national path has always taken it from the live row
    // in exactly this case, so returning nothing would silently change the chips.
    const out = resolveCurrentLaw(
      lt,
      { effectDirection: -1, currentPolicyOptionNameSnapshot: "Minimal: Token funding." },
      { policyOptionIndex: 2 }
    );
    expect(out.label).toEqual({ name: "Minimal", explanation: "Token funding." });
    expect(out.index).toBe(2);
  });

  it("falls back to the live index when no snapshot exists", () => {
    const out = resolveCurrentLaw(lt, { effectDirection: -1 }, { policyOptionIndex: 2 });
    expect(out.index).toBe(2);
    expect(out.label).toEqual({ name: "Universal", explanation: "Full coverage." });
  });

  it("falls back to the live option id when no index is stored", () => {
    const out = resolveCurrentLaw(lt, { effectDirection: -1 }, { policyOptionId: "o0" });
    expect(out.index).toBe(0);
    expect(out.label?.name).toBe("Repeal");
  });

  it("returns no label when there is neither a snapshot nor a live row", () => {
    expect(resolveCurrentLaw(lt, { effectDirection: -1 }, undefined)).toEqual({});
  });

  it("ignores an id snapshot that no longer exists in the catalog", () => {
    // A law reseeded with different option ids must not blank the box; fall
    // through to the next precedence step rather than returning nothing.
    const out = resolveCurrentLaw(
      lt,
      { effectDirection: -1, currentPolicyOptionIdSnapshot: "gone" },
      { policyOptionIndex: 0 }
    );
    expect(out.index).toBe(0);
    expect(out.label?.name).toBe("Repeal");
  });
});

describe("resolveProposedLabel", () => {
  it("prefers the structured proposed snapshot", () => {
    const out = resolveProposedLabel(
      lt,
      {
        effectDirection: -1,
        policyOptionId: "o2",
        policyOptionNameSnapshot: "Universal (as proposed)",
        policyOptionExplanationSnapshot: "Full coverage.",
      },
      "Left policy"
    );
    expect(out.label).toEqual({ name: "Universal (as proposed)", explanation: "Full coverage." });
    expect(out.index).toBe(2);
  });

  it("splits a legacy combined proposed snapshot", () => {
    const out = resolveProposedLabel(
      lt,
      { effectDirection: -1, policyOptionNameSnapshot: "Universal: Full coverage." },
      "Left policy"
    );
    expect(out.label).toEqual({ name: "Universal", explanation: "Full coverage." });
  });

  it("resolves live from policyOptionId when no snapshot exists", () => {
    const out = resolveProposedLabel(
      lt,
      { effectDirection: -1, policyOptionId: "o2" },
      "Left policy"
    );
    expect(out.label).toEqual({ name: "Universal", explanation: "Full coverage." });
    expect(out.index).toBe(2);
  });

  it("uses the supplied fallback when nothing resolves", () => {
    const empty = { _id: "e", policyOptions: [] } as unknown as LegislationType;
    const out = resolveProposedLabel(empty, { effectDirection: 1 }, "Right policy");
    expect(out.label).toEqual({ name: "Right policy" });
    expect(out.index).toBeUndefined();
  });
});

describe("loadLiveCurrentPolicies — scoping", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePolicies").find.mockReturnValue({ toArray: async () => [] });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
  });

  it("keys statePolicies on the region id, NOT on a scope field", async () => {
    // StatePolicy.scope is optional on reads — pre-migration docs lack it, so a
    // scope filter would silently miss them. Both pre-merge implementations
    // keyed on stateId; the merge keeps that.
    await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      ["ru_health"]
    );
    const filter = db.collectionMocks["statePolicies"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.stateId).toBe("MOW");
    expect(filter.scope).toBeUndefined();
  });

  it("keys statePolicies on the national pseudo-stateId for national scope", async () => {
    await loadLiveCurrentPolicies(db as unknown as Db, { scope: "national", countryId: "US" }, [
      "us_health",
    ]);
    const filter = db.collectionMocks["statePolicies"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.stateId).toBe("federal");
    expect(filter.scope).toBeUndefined();
  });

  it("falls back to enactedLaws scoped by stateId for a region", async () => {
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({
        toArray: async () => [{ legislationTypeId: "ru_health", policyOptionIndex: 3 }],
      }),
    });
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      ["ru_health"]
    );
    const filter = db.collectionMocks["enactedLaws"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.stateId).toBe("MOW");
    expect(filter.countryId).toBeUndefined();
    expect(out.get("ru_health")).toEqual({ policyOptionIndex: 3 });
  });

  it("falls back to enactedLaws scoped by countryId for national", async () => {
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({
        toArray: async () => [{ legislationTypeId: "us_health", policyOptionIndex: 1 }],
      }),
    });
    await loadLiveCurrentPolicies(db as unknown as Db, { scope: "national", countryId: "US" }, [
      "us_health",
    ]);
    const filter = db.collectionMocks["enactedLaws"]!.find.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.countryId).toBe("US");
    expect(filter.stateId).toBeUndefined();
  });

  it("canonicalizes legislation type ids so legacy tax-rate aliases resolve", async () => {
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [
        { legislationTypeId: "uk_corporation_tax", policyOptionId: "x", policyOptionIndex: 2 },
      ],
    });
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "national", countryId: "UK" },
      ["uk_domestic_corporation_tax"]
    );
    // The state path previously did a raw lookup and missed the legacy alias.
    expect(out.get("uk_domestic_corporation_tax")).toEqual({
      policyOptionIndex: 2,
      policyOptionId: "x",
    });
  });

  it("returns an empty map when given no legislation type ids", async () => {
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      []
    );
    expect(out.size).toBe(0);
    expect(db.collectionMocks["statePolicies"]!.find).not.toHaveBeenCalled();
  });
});

describe("loadLiveCurrentPolicies — regional default for new-generation `both` laws", () => {
  let db: MockDb;
  const bothLaw = getCatalog("RU").find(
    (law) => law.kind !== "tax" && law.allowedScope === "both"
  )!;
  const nationalLaw = getCatalog("RU").find((law) => law.allowedScope === "national")!;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePolicies").find.mockReturnValue({ toArray: async () => [] });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
  });

  it("resolves a `both` law to level 0 in a region with no row, so the comparison block renders", async () => {
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [bothLaw.id]
    );
    expect(out.get(bothLaw.id)).toEqual({ policyOptionIndex: 0 });
  });

  it("never invents a national row — a missing national policy stays missing", async () => {
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      [bothLaw.id]
    );
    expect(out.has(bothLaw.id)).toBe(false);
  });

  it("leaves national-only and legacy-catalog laws alone at region scope", async () => {
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [nationalLaw.id, "us_state_transportation"]
    );
    expect(out.has(nationalLaw.id)).toBe(false);
    expect(out.has("us_state_transportation")).toBe(false);
  });

  it("does not override a real statePolicies row", async () => {
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [{ legislationTypeId: bothLaw.id, policyOptionIndex: 3 }],
    });
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [bothLaw.id]
    );
    expect(out.get(bothLaw.id)).toEqual({ policyOptionIndex: 3 });
  });

  it("does not override an enactedLaws fallback", async () => {
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({
        toArray: async () => [{ legislationTypeId: bothLaw.id, policyOptionIndex: 2 }],
      }),
    });
    const out = await loadLiveCurrentPolicies(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      [bothLaw.id]
    );
    expect(out.get(bothLaw.id)).toEqual({ policyOptionIndex: 2 });
  });
});
