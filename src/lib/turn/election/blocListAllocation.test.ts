import { describe, expect, it } from "vitest";
import { allocateBlocListSeats } from "./blocListAllocation";
import { BLOC_LIST_QUOTAS, blocListQuotaForGovernment } from "@/lib/constants/blocList";

const DD = BLOC_LIST_QUOTAS.DD!.shares;

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);

/** One candidate per DD party, with the vote shares the live 1953 world projected. */
const LIVE_1953_BEO = [
  { id: "ldpd", votes: 359, party: "3" },
  { id: "sed", votes: 191, party: "1" },
  { id: "dbd", votes: 190, party: "5" },
  { id: "cdu", votes: 178, party: "2" },
  { id: "ndpd", votes: 82, party: "4" },
];

describe("allocateBlocListSeats", () => {
  it("activates the historical quota only while the runtime government is one-party", () => {
    expect(blocListQuotaForGovernment("DD", "onePartyState")?.shares).toEqual(DD);
    expect(blocListQuotaForGovernment("DD", "parliamentaryRepublic")).toBeNull();
    expect(blocListQuotaForGovernment("DD", "presidential")).toBeNull();
  });

  it("gives the ruling party its quota even when it is beaten on votes", () => {
    // The whole point. On these votes the proportional path made the LDPD the
    // largest delegation and put the SED third.
    const seats = allocateBlocListSeats(400, DD, LIVE_1953_BEO);
    expect(seats.sed).toBe(220); // 55%
    expect(seats.ldpd).toBe(45); // 11.25%
    expect(seats.cdu).toBe(45);
    expect(seats.ndpd).toBe(45);
    expect(seats.dbd).toBe(45);
    expect(sum(seats)).toBe(400);
  });

  it("is completely unmoved by the vote split across parties", () => {
    const landslide = allocateBlocListSeats(
      400,
      DD,
      LIVE_1953_BEO.map((c) => ({ ...c, votes: c.party === "3" ? 100_000 : 1 }))
    );
    const wipeout = allocateBlocListSeats(
      400,
      DD,
      LIVE_1953_BEO.map((c) => ({ ...c, votes: c.party === "1" ? 100_000 : 1 }))
    );
    expect(landslide).toEqual(wipeout);
    expect(landslide.sed).toBe(220);
  });

  it("still lets the vote decide the split INSIDE a party's block", () => {
    const seats = allocateBlocListSeats(400, DD, [
      { id: "sed-a", votes: 750, party: "1" },
      { id: "sed-b", votes: 250, party: "1" },
      { id: "cdu", votes: 999, party: "2" },
      { id: "ldpd", votes: 1, party: "3" },
      { id: "ndpd", votes: 1, party: "4" },
      { id: "dbd", votes: 1, party: "5" },
    ]);
    // The SED block is still exactly 55% of 400...
    expect(seats["sed-a"] + seats["sed-b"]).toBe(220);
    // ...but it splits 3:1 inside the party, on votes.
    expect(seats["sed-a"]).toBe(165);
    expect(seats["sed-b"]).toBe(55);
    expect(sum(seats)).toBe(400);
  });

  it("conserves seats exactly across awkward totals", () => {
    for (const total of [1, 2, 3, 7, 13, 47, 89, 91, 100, 401, 500]) {
      const seats = allocateBlocListSeats(total, DD, LIVE_1953_BEO);
      expect(sum(seats)).toBe(total);
    }
  });

  it("redistributes the quota of a party that fielded nobody", () => {
    const onlyRuling = allocateBlocListSeats(100, DD, [{ id: "sed", votes: 10, party: "1" }]);
    expect(onlyRuling.sed).toBe(100);

    const noRuling = allocateBlocListSeats(100, DD, [
      { id: "cdu", votes: 10, party: "2" },
      { id: "ldpd", votes: 10, party: "3" },
    ]);
    // Two bloc parties on equal quotas split the chamber, rather than the
    // chamber being left 77.5% empty.
    expect(noRuling.cdu).toBe(50);
    expect(noRuling.ldpd).toBe(50);
    expect(sum(noRuling)).toBe(100);
  });

  it("seats nobody from an unsanctioned party", () => {
    const seats = allocateBlocListSeats(100, DD, [
      { id: "sed", votes: 1, party: "1" },
      { id: "rogue", votes: 10_000, party: "99" },
      { id: "indep", votes: 10_000 },
    ]);
    expect(seats.rogue).toBe(0);
    expect(seats.indep).toBe(0);
    expect(seats.sed).toBe(100);
  });

  it("returns an all-zero result when no sanctioned candidate stood", () => {
    const seats = allocateBlocListSeats(100, DD, [
      { id: "rogue", votes: 10_000, party: "99" },
      { id: "indep", votes: 10_000 },
    ]);
    expect(sum(seats)).toBe(0);
    // Every candidate is still present in the result.
    expect(Object.keys(seats).sort()).toEqual(["indep", "rogue"]);
  });

  it("is deterministic and tolerates degenerate input", () => {
    const a = allocateBlocListSeats(90, DD, LIVE_1953_BEO);
    const b = allocateBlocListSeats(90, DD, LIVE_1953_BEO);
    expect(a).toEqual(b);

    expect(sum(allocateBlocListSeats(0, DD, LIVE_1953_BEO))).toBe(0);
    expect(allocateBlocListSeats(-5, DD, LIVE_1953_BEO).sed).toBe(0);
    expect(sum(allocateBlocListSeats(50, DD, []))).toBe(0);

    // Zero-vote slate: the block still has to be filled, not dropped.
    const zeroVotes = allocateBlocListSeats(100, DD, [
      { id: "sed-a", votes: 0, party: "1" },
      { id: "sed-b", votes: 0, party: "1" },
    ]);
    expect(sum(zeroVotes)).toBe(100);
  });

  it("matches the historical 1954 bloc shares at Volkskammer scale", () => {
    const seats = allocateBlocListSeats(466, DD, LIVE_1953_BEO);
    // The real 1954 Volkskammer: SED 117 + 141 mass-organisation seats = 258,
    // and CDU/LDPD/NDPD/DBD on 52 apiece. 466 x 0.1125 = 52.425, so two bloc
    // parties take a remainder seat and land on 53. Within one seat of history
    // on every party, which is as close as a clean quota gets.
    expect(seats.sed).toBe(256);
    const bloc = ["cdu", "ldpd", "ndpd", "dbd"].map((id) => seats[id]).sort();
    expect(bloc).toEqual([52, 52, 53, 53]);
    expect(sum(seats)).toBe(466);
  });
});
