import { describe, it, expect } from "vitest";
import { buildPartyDisplayById, buildPresidentialRegByStateInput } from "./presidentialRegByState";

describe("buildPartyDisplayById", () => {
  it("keys by sequentialId-as-string (matches statePartyOrg.partyId / candidate.party)", () => {
    const out = buildPartyDisplayById([
      { sequentialId: 1, abbreviation: "DEM", color: "#3B82F6" },
      { sequentialId: 2, abbreviation: "REP", color: "#EF4444" },
    ]);
    expect(out).toEqual({
      "1": { abbr: "DEM", color: "#3B82F6" },
      "2": { abbr: "REP", color: "#EF4444" },
    });
  });
});

describe("buildPresidentialRegByStateInput", () => {
  const parties = (stateId: string) => [
    { stateId, partyId: "1", registration: 42.9 },
    { stateId, partyId: "2", registration: 24.9 },
    { stateId, partyId: "3", organization: 0 }, // no registration → excluded
  ];

  it("maps each party's registration to a leanPct and folds in pool buckets", () => {
    const out = buildPresidentialRegByStateInput(parties("WA"), [
      { stateId: "WA", independent: 22.9, unregistered: 9.3 },
    ]);
    expect(out.WA).toEqual({
      partyShares: [
        { partyId: "1", leanPct: 42.9 },
        { partyId: "2", leanPct: 24.9 },
      ],
      independent: 22.9,
      unregistered: 9.3,
    });
  });

  it("excludes party rows whose registration is undefined", () => {
    const out = buildPresidentialRegByStateInput(parties("WA"), []);
    expect(out.WA.partyShares.map((p) => p.partyId)).toEqual(["1", "2"]);
  });

  it("omits states with no registration-bearing rows entirely (card shows 'no data tracked')", () => {
    const out = buildPresidentialRegByStateInput(
      [{ stateId: "XX", partyId: "3", organization: 5 }],
      []
    );
    expect(out.XX).toBeUndefined();
  });

  it("leaves pool buckets undefined when the state has no pool row", () => {
    const out = buildPresidentialRegByStateInput(parties("CA"), []);
    expect(out.CA.independent).toBeUndefined();
    expect(out.CA.unregistered).toBeUndefined();
    expect(out.CA.partyShares).toHaveLength(2);
  });

  it("handles multiple states independently", () => {
    const out = buildPresidentialRegByStateInput(
      [...parties("WA"), ...parties("TX")],
      [
        { stateId: "WA", independent: 22.9, unregistered: 9.3 },
        { stateId: "TX", independent: 30, unregistered: 5 },
      ]
    );
    expect(Object.keys(out).sort()).toEqual(["TX", "WA"]);
    expect(out.TX.independent).toBe(30);
  });
});
