import { describe, expect, it } from "vitest";
import { buildAttentionItems, type AttentionInput } from "./overviewModel";
import type { BondInfo, SectorDetail } from "./CorporationPageTypes";

function sector(over: Partial<SectorDetail>): SectorDetail {
  return {
    _id: "s",
    stateId: "PA",
    stateName: "Pennsylvania",
    sectorLabel: "Energy",
    revenue: 100,
    profit: 10,
    ...over,
  } as SectorDetail;
}

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    netIncomePerTurn: 100,
    retainedPerTurn: 50,
    cash: 10_000,
    sectors: [],
    bondInfo: null,
    openVoteCount: 0,
    leverageRating: "AA",
    fmt: (n) => `$${n}`,
    ...over,
  };
}

const keys = (over: Partial<AttentionInput>) => buildAttentionItems(input(over)).map((i) => i.key);

describe("buildAttentionItems", () => {
  it("is empty for a healthy corporation", () => {
    expect(buildAttentionItems(input())).toEqual([]);
  });

  it("warns on a short cash runway and escalates when it is very short", () => {
    const soon = buildAttentionItems(input({ cash: 1_000, retainedPerTurn: -50 }));
    expect(soon[0]).toMatchObject({ key: "runway", tone: "warning" });
    expect(soon[0].title).toBe("Cash lasts about 20 turns at this rate");
    const urgent = buildAttentionItems(input({ cash: 100, retainedPerTurn: -50 }));
    expect(urgent[0]).toMatchObject({ key: "runway", tone: "error" });
    expect(keys({ cash: 100_000, retainedPerTurn: -50 })).not.toContain("runway");
  });

  it("flags negative cash instead of a runway", () => {
    expect(keys({ cash: -5, retainedPerTurn: -50 })).toEqual(["cash-negative"]);
  });

  it("says nothing about money when the books are hidden", () => {
    expect(keys({ cash: null, retainedPerTurn: null, netIncomePerTurn: null })).toEqual([]);
  });

  it("lists losing, low-fill and embargoed sectors but skips mothballed ones", () => {
    const sectors = [
      sector({ _id: "a", stateName: "Ohio", profit: -5 }),
      sector({ _id: "b", stateName: "Iowa", fillRateBand: "low" }),
      sector({ _id: "c", stateName: "Utah", embargoSuspended: true, profit: -9 }),
      sector({ _id: "d", stateName: "Maine", mothballed: true, profit: -50, fillRateBand: "low" }),
    ];
    const items = buildAttentionItems(input({ sectors }));
    expect(items.map((i) => i.key)).toEqual(["embargo", "losing-sectors", "low-fill"]);
    expect(items.find((i) => i.key === "losing-sectors")?.detail).toBe("Ohio Energy");
  });

  it("counts bonds due inside the window from the next maturity", () => {
    const bondInfo = {
      currentTurn: 100,
      bonds: [
        { maturityTurn: 130, defaulted: false, matured: false },
        { maturityTurn: 140, defaulted: false, matured: false },
        { maturityTurn: 200, defaulted: false, matured: false },
        { maturityTurn: 90, defaulted: false, matured: true },
      ],
    } as unknown as BondInfo;
    const due = buildAttentionItems(input({ bondInfo })).find((i) => i.key === "bond-due");
    expect(due).toMatchObject({ tone: "warning", title: "2 bonds due within 48 turns" });
    expect(due?.detail).toBe("Next repayment in 30 turns, on turn 130.");
  });

  it("flags a weak leverage grade and open votes", () => {
    expect(keys({ leverageRating: "CCC", openVoteCount: 2 })).toEqual(["leverage", "votes"]);
    expect(keys({ leverageRating: "BB" })).toEqual([]);
  });
});
