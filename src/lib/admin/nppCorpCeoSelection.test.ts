import { describe, it, expect } from "vitest";
import { chooseNppCorpCeo, buildCeoAffiliations } from "./nppCorpCeoSelection";

const npp = (id: string, influence = 5, seq = 1) => ({ id, influence, seq });

describe("buildCeoAffiliations", () => {
  const find = (rows: ReturnType<typeof buildCeoAffiliations>, party: string) =>
    rows.find((a) => a.party === party);

  it("includes every non-defunct party plus an independent bucket", () => {
    const rows = buildCeoAffiliations({
      nonDefunctPartyIds: ["1", "2"],
      existingCorpCeos: [],
      activeNpps: [],
    });
    expect(rows.map((r) => r.party).sort()).toEqual(["1", "2", "independent"]);
  });

  it("tallies corp counts per affiliation from existing CEOs", () => {
    const rows = buildCeoAffiliations({
      nonDefunctPartyIds: ["1", "2"],
      existingCorpCeos: [
        { nppId: "x", party: "1" },
        { nppId: "y", party: "1" },
        { nppId: "z", party: "independent" },
      ],
      activeNpps: [],
    });
    expect(find(rows, "1")!.corpCount).toBe(2);
    expect(find(rows, "2")!.corpCount).toBe(0);
    expect(find(rows, "independent")!.corpCount).toBe(1);
  });

  it("excludes NPPs that already run a corp from the free pool", () => {
    const rows = buildCeoAffiliations({
      nonDefunctPartyIds: ["1"],
      existingCorpCeos: [{ nppId: "ceo", party: "1" }],
      activeNpps: [
        { id: "ceo", party: "1", influence: 9, seq: 1 },
        { id: "free", party: "1", influence: 4, seq: 2 },
      ],
    });
    expect(find(rows, "1")!.freeNpps.map((n) => n.id)).toEqual(["free"]);
  });

  it("drops NPPs whose party is defunct / not participating", () => {
    const rows = buildCeoAffiliations({
      nonDefunctPartyIds: ["1"],
      existingCorpCeos: [],
      activeNpps: [
        { id: "a", party: "1", influence: 5, seq: 1 },
        { id: "b", party: "9", influence: 5, seq: 2 }, // 9 is defunct (absent)
      ],
    });
    expect(find(rows, "1")!.freeNpps.map((n) => n.id)).toEqual(["a"]);
    expect(find(rows, "9")).toBeUndefined();
  });

  it("routes independents into the independent bucket", () => {
    const rows = buildCeoAffiliations({
      nonDefunctPartyIds: ["1"],
      existingCorpCeos: [],
      activeNpps: [{ id: "ind", party: "independent", influence: 6, seq: 3 }],
    });
    expect(find(rows, "independent")!.freeNpps.map((n) => n.id)).toEqual(["ind"]);
  });
});

describe("chooseNppCorpCeo — auto balance", () => {
  it("reuses an existing free NPP instead of creating a new one", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [{ party: "1", corpCount: 0, freeNpps: [npp("a")] }],
    });
    expect(choice).toEqual({ kind: "existing", party: "1", nppId: "a" });
  });

  it("assigns to the affiliation with the fewest current corps", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        { party: "1", corpCount: 5, freeNpps: [npp("a")] },
        { party: "2", corpCount: 1, freeNpps: [npp("b")] },
        { party: "3", corpCount: 3, freeNpps: [npp("c")] },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "2", nppId: "b" });
  });

  it("skips affiliations that have no free NPP", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        { party: "1", corpCount: 0, freeNpps: [] }, // fewest corps but no one free
        { party: "2", corpCount: 4, freeNpps: [npp("b")] },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "2", nppId: "b" });
  });

  it("treats independent as its own bucket and picks it when it has the fewest corps", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        { party: "1", corpCount: 2, freeNpps: [npp("a")] },
        { party: "independent", corpCount: 0, freeNpps: [npp("z")] },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "independent", nppId: "z" });
  });

  it("within the chosen affiliation, prefers highest influence then lowest seq", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        {
          party: "1",
          corpCount: 0,
          freeNpps: [npp("low", 3, 10), npp("hiA", 9, 50), npp("hiB", 9, 20)],
        },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "1", nppId: "hiB" });
  });

  it("breaks corp-count ties by lowest party id, with independent ordered last", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        { party: "independent", corpCount: 0, freeNpps: [npp("z")] },
        { party: "3", corpCount: 0, freeNpps: [npp("c")] },
        { party: "2", corpCount: 0, freeNpps: [npp("b")] },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "2", nppId: "b" });
  });

  it("falls back to a new independent NPP when no affiliation has a free NPP", () => {
    const choice = chooseNppCorpCeo({
      affiliations: [
        { party: "1", corpCount: 2, freeNpps: [] },
        { party: "2", corpCount: 1, freeNpps: [] },
      ],
    });
    expect(choice).toEqual({ kind: "new", party: "independent" });
  });

  it("falls back to a new independent NPP when there are no participating affiliations", () => {
    expect(chooseNppCorpCeo({ affiliations: [] })).toEqual({ kind: "new", party: "independent" });
  });
});

describe("chooseNppCorpCeo — forced party override", () => {
  it("reuses a free NPP in the forced party", () => {
    const choice = chooseNppCorpCeo({
      forcedParty: "3",
      affiliations: [
        { party: "1", corpCount: 0, freeNpps: [npp("a")] },
        { party: "3", corpCount: 9, freeNpps: [npp("c", 7, 4)] },
      ],
    });
    expect(choice).toEqual({ kind: "existing", party: "3", nppId: "c" });
  });

  it("creates a new NPP in the forced party when it has no free NPP", () => {
    const choice = chooseNppCorpCeo({
      forcedParty: "3",
      affiliations: [
        { party: "1", corpCount: 0, freeNpps: [npp("a")] },
        { party: "3", corpCount: 9, freeNpps: [] },
      ],
    });
    expect(choice).toEqual({ kind: "new", party: "3" });
  });

  it("creates a new NPP in the forced party even when that party is absent from the pool", () => {
    const choice = chooseNppCorpCeo({
      forcedParty: "7",
      affiliations: [{ party: "1", corpCount: 0, freeNpps: [npp("a")] }],
    });
    expect(choice).toEqual({ kind: "new", party: "7" });
  });
});
