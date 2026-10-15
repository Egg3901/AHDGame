import { describe, expect, it } from "vitest";
import { publicSubsidiaryGroups, type PublicGroupMember } from "./publicListing";
import { resolveMembershipRows } from "./membership";
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
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("A");
    expect(groups[0].parentGroupId).toBeUndefined();
    expect(groups[0].members.map((member) => member.id)).toEqual(["A", "B"]);
    expect(groups[0].cashAnchor).toBe(20);
  });
  it.each([
    { totalShares: 0 },
    { totalShares: Infinity },
    { totalShares: NaN },
    { marketCapAnchor: Infinity },
    { marketCapAnchor: NaN },
    { marketCapAnchor: -1 },
    { corporateHoldings: [{ holderId: "A", shares: Infinity }] },
    { corporateHoldings: [{ holderId: "A", shares: -1 }] },
    { corporateHoldings: [{ holderId: "A", shares: 101 }] },
  ])("keeps invalid equity inputs unknown: %o", (extra) => {
    const [group] = publicSubsidiaryGroups([row("A"), row("B", "A", extra)]);
    expect(group.equityValueAnchor).toBeNull();
  });
  it("does not publish non-finite member amounts or overflowing totals", () => {
    const [group] = publicSubsidiaryGroups([
      row("A", undefined, { cashAnchor: Infinity, revenueAnchor: NaN }),
      row("B", "A"),
    ]);
    expect(group.cashAnchor).toBeNull();
    expect(group.revenueAnchor).toBeNull();
    expect(group.members[0].cashAnchor).toBeNull();
    expect(group.members[0].revenueAnchor).toBeNull();
    const [overflow] = publicSubsidiaryGroups([
      row("A", undefined, { cashAnchor: Number.MAX_VALUE, marketCapAnchor: Number.MAX_VALUE }),
      row("B", "A", {
        cashAnchor: Number.MAX_VALUE,
        marketCapAnchor: Number.MAX_VALUE,
        corporateHoldings: [],
      }),
    ]);
    expect(overflow.cashAnchor).toBeNull();
    expect(overflow.equityValueAnchor).toBeNull();
  });
  it("resolves cyclic trees consistently regardless of document order", () => {
    const rows = [row("A", "B"), row("B", "A"), row("C", "B"), row("D", "C")];
    for (const input of [rows, [...rows].reverse()]) {
      const groups = publicSubsidiaryGroups(input);
      expect(
        groups
          .find((g) => g.id === "A")
          ?.members.map((m) => m.id)
          .sort()
      ).toEqual(["A", "B", "C", "D"]);
      expect(groups.find((g) => g.id === "B")?.parentGroupId).toBe("A");
      expect(groups.find((g) => g.id === "C")?.parentGroupId).toBe("B");
    }
  });
  it("stabilizes duplicate custom names with the corporation ID", () => {
    const rows = [
      row("B", undefined, { groupName: "Same" }),
      row("B-child", "B"),
      row("A", undefined, { groupName: "Same" }),
      row("A-child", "A"),
    ];
    expect(publicSubsidiaryGroups(rows).map((group) => group.id)).toEqual(["A", "B"]);
    expect(publicSubsidiaryGroups([...rows].reverse()).map((group) => group.id)).toEqual([
      "A",
      "B",
    ]);
  });
  it("keeps orphaned hierarchies public without offering unavailable management", () => {
    const [group] = publicSubsidiaryGroups([row("A", "missing"), row("B", "A")]);
    expect(group.id).toBe("A");
    expect(group.members).toHaveLength(2);
    expect(group.parentGroupId).toBeUndefined();
    expect(group.managementAvailable).toBe(false);
  });
  it("does not mutate caller-owned data", () => {
    const rows = [row("A"), row("B", "A")],
      before = structuredClone(rows);
    publicSubsidiaryGroups(rows);
    expect(rows).toEqual(before);
  });
  it("matches an independent ancestor-walk oracle across generated forests", () => {
    for (let seed = 0; seed < 64; seed++) {
      const rows = Array.from({ length: 20 }, (_, index) =>
        row(String(index), index ? String((index * 7 + seed) % index) : undefined, {
          formalized: index > 0 && (seed + index) % 4 !== 0,
          cashAnchor: index + 1,
          revenueAnchor: (index + 1) * 2,
          marketCapAnchor: (index + 1) * 100,
        })
      );
      const byId = new Map(rows.map((member) => [member.id, member]));
      const groups = publicSubsidiaryGroups(seed % 2 ? [...rows].reverse() : rows);
      let expectedCount = 0;
      for (const root of rows) {
        const expected = rows.filter((candidate) => {
          let current = candidate;
          while (current.id !== root.id && current.formalized && current.parentId)
            current = byId.get(current.parentId)!;
          return current.id === root.id;
        });
        if (expected.length < 2) continue;
        expectedCount++;
        const group = groups.find((entry) => entry.id === root.id)!;
        expect(group.members.map((member) => member.id).sort()).toEqual(
          expected.map((member) => member.id).sort()
        );
        expect(group.cashAnchor).toBe(
          expected.reduce((sum, member) => sum + member.cashAnchor!, 0)
        );
        expect(group.revenueAnchor).toBe(
          expected.reduce((sum, member) => sum + member.revenueAnchor!, 0)
        );
        expect(group.equityValueAnchor).toBeCloseTo(
          expected.reduce(
            (sum, member) => sum + member.marketCapAnchor! * (member.id === root.id ? 1 : 0.2),
            0
          )
        );
      }
      expect(groups).toHaveLength(expectedCount);
    }
  });
  it("preserves the engine's top-level memberships across generated cyclic graphs", () => {
    for (let seed = 0; seed < 40; seed++) {
      const rows = Array.from({ length: 20 }, (_, index) =>
        row(String(index), String((index * 7 + seed) % 20), {
          formalized: (seed + index) % 5 !== 0,
        })
      );
      const expected = [...resolveMembershipRows(rows).membersByRootId]
        .map(([id, members]) => ({ id, members: [...members].sort() }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const actual = publicSubsidiaryGroups(rows)
        .filter((group) => !group.parentGroupId)
        .map((group) => ({
          id: group.id,
          members: group.members.map((member) => member.id).sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(actual).toEqual(expected);
    }
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
