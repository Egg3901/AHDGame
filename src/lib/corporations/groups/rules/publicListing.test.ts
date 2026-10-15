import { describe, expect, it } from "vitest";
import { publicSubsidiaryGroups, type PublicGroupMember } from "./publicListing";
const row = (
  id: string,
  parentId?: string,
  extra: Partial<PublicGroupMember> = {}
): PublicGroupMember => ({
  id,
  pathId: id,
  name: id,
  countryId: "US",
  parentId,
  formalized: !!parentId,
  cashAnchor: 10,
  revenueAnchor: 20,
  marketCapAnchor: 100,
  totalShares: 100,
  corporateHoldings: parentId ? [{ holderId: parentId, shares: 80 }] : [],
  sectors: [{ industry: "logistics", countryId: "US", stateId: "same-region" }],
  ...extra,
});
describe("public subsidiary groups", () => {
  it("lists nested parents separately and includes each descendant once in ancestor totals", () => {
    const groups = publicSubsidiaryGroups([
      row("A", undefined, { groupName: "Harbor", groupLogoUrl: "/group.png" }),
      row("B", "A"),
      row("C", "B"),
      row("D", "A"),
      row("unformalized", "A", { formalized: false }),
    ]);
    const top = groups.find((g) => g.id === "A")!,
      nested = groups.find((g) => g.id === "B")!;
    expect(groups).toHaveLength(2);
    expect(top.name).toBe("Harbor");
    expect(top.logoUrl).toBe("/group.png");
    expect(top.members.map((m) => m.id).sort()).toEqual(["A", "B", "C", "D"]);
    expect(top.cashAnchor).toBe(40);
    expect(top.revenueAnchor).toBe(80);
    expect(top.sectorCount).toBe(4);
    expect(top.regionCount).toBe(1);
    expect(top.equityValueAnchor).toBeCloseTo(160);
    expect(nested.members.map((m) => m.id)).toEqual(["B", "C"]);
    expect(nested.parentGroupId).toBe("A");
    expect(nested.equityValueAnchor).toBeCloseTo(120);
  });
  it("falls back to the immediate parent identity and keeps unavailable quotes unknown", () => {
    const [group] = publicSubsidiaryGroups([
      row("A", undefined, { groupName: " ", logoUrl: "/corp.png" }),
      row("B", "A", { marketCapAnchor: null }),
    ]);
    expect(group.name).toBe("A");
    expect(group.logoUrl).toBe("/corp.png");
    expect(group.equityValueAnchor).toBeNull();
  });
  it("terminates cycles without counting members twice and ignores missing parents", () => {
    const groups = publicSubsidiaryGroups([row("A", "B"), row("B", "A"), row("C", "missing")]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.members.length === 2 && g.cashAnchor === 20)).toBe(true);
  });
  it("deduplicates operating regions by country and reports foreign operations", () => {
    const [g] = publicSubsidiaryGroups([
      row("A"),
      row("B", "A", {
        sectors: [{ industry: "banking", countryId: "UK", stateId: "same-region" }],
      }),
    ]);
    expect(g.regionCount).toBe(2);
    expect(g.countries).toEqual(["UK", "US"]);
    expect(g.industries).toEqual(["banking", "logistics"]);
  });
});
