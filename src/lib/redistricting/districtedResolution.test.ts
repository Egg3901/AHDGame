import { describe, it, expect } from "vitest";
import type { Pool } from "./pools";
import {
  computePartyBaselines,
  computePartySeatQuotas,
  assignPartiesToDistrictsByQuota,
  districtWinnerParty,
  assignDistrictsToNominees,
  LEAN_STRENGTH,
} from "./districtedResolution";

const HOUSE_MIN_SHARE = 0.2;

describe("computePartyBaselines", () => {
  it("sums candidate votes by party", () => {
    const votes = { a: 100, b: 50, c: 80 };
    const party = { a: "DEM", b: "DEM", c: "GOP" };
    expect(computePartyBaselines(votes, party)).toEqual({ DEM: 150, GOP: 80 });
  });
});

describe("districtWinnerParty", () => {
  const pool: Record<string, Pool> = { DEM: "left", GOP: "right" };

  it("a fully right-packed district (netLean +16) is safe GOP even if DEM leads statewide", () => {
    expect(districtWinnerParty({ DEM: 1000, GOP: 100 }, pool, 16)).toBe("GOP");
  });

  it("a fully left-packed district (netLean -16) is safe DEM", () => {
    expect(districtWinnerParty({ DEM: 100, GOP: 1000 }, pool, -16)).toBe("DEM");
  });

  it("an even district (netLean 0) goes to the statewide leader", () => {
    expect(districtWinnerParty({ DEM: 600, GOP: 400 }, pool, 0)).toBe("DEM");
    expect(districtWinnerParty({ DEM: 400, GOP: 600 }, pool, 0)).toBe("GOP");
  });

  it("returns null with no parties", () => {
    expect(districtWinnerParty({}, pool, 0)).toBeNull();
  });

  it("LEAN_STRENGTH default is 1.0", () => {
    expect(LEAN_STRENGTH).toBe(1.0);
  });

  it("a +7.5% campaign boost can flip an even district", () => {
    // even district, GOP trails 490 vs 510; +7.5% pushes GOP to 526.75 > 510
    expect(districtWinnerParty({ DEM: 510, GOP: 490 }, pool, 0)).toBe("DEM");
    expect(districtWinnerParty({ DEM: 510, GOP: 490 }, pool, 0, { GOP: 7.5 })).toBe("GOP");
  });
});

describe("computePartySeatQuotas — proportional, no sweep (ticket 926)", () => {
  it("splits TX proportionally: a 36.5% centrist plurality gets ~11 of 31, NOT all 31", () => {
    // Real prod tally (TX House 2010): AIP is a grey/centrist party that led the
    // statewide vote. The old per-district resolver handed AIP all 31 seats.
    const baselines = {
      AIP: 2164516, // 36.5%
      RFP: 1923861, // 32.4%
      DEM: 1012323, // 17.0%
      REP: 696833, // 11.7%
      DSA: 140109, // 2.4%
    };
    const q = computePartySeatQuotas(baselines, 31, HOUSE_MIN_SHARE);
    expect(q).toEqual({ AIP: 11, RFP: 10, DEM: 5, REP: 4, DSA: 1 });
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(31);
  });

  it("splits CA proportionally: a plurality-leading grey party is NOT frozen out", () => {
    // Real prod tally (CA House 2010): Reform led the field but got 0 seats; only
    // DEM/REP were seated. Party baselines are candidate votes summed by party.
    const baselines = {
      DEM: 1865659 + 1354643, // 32.1%
      REP: 1919608 + 1313085, // 32.2%
      RFP: 2198819, // 21.9% (led the field)
      COM: 1375553, // 13.7%
    };
    const q = computePartySeatQuotas(baselines, 55, HOUSE_MIN_SHARE);
    expect(q).toEqual({ REP: 18, DEM: 18, RFP: 12, COM: 7 });
    expect(q.RFP).toBeGreaterThan(0); // Reform is represented, not swept out
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(55);
  });

  it("keeps a small party via the min-pool fallback when few clear the floor", () => {
    // DEM 60 / REP 30 / MINOR 10 over 10 seats. Only DEM+REP clear 20%, but the
    // pool must hold min(seats, parties)=3, so MINOR is pulled back in and gets
    // its proportional seat (mirrors legacy allocateSeats — favors representation
    // in many-seat races rather than concentrating on the top two).
    const q = computePartySeatQuotas({ DEM: 60, REP: 30, MINOR: 10 }, 10, HOUSE_MIN_SHARE);
    expect(q).toEqual({ DEM: 6, REP: 3, MINOR: 1 });
  });

  it("excludes a sub-threshold party once the eligibles already fill the seats", () => {
    // DEM 50 / REP 45 / MINOR 5 over just 2 seats: min-pool is 2, DEM+REP both
    // clear 20% and fill it, so the 5% party is dropped.
    const q = computePartySeatQuotas({ DEM: 50, REP: 45, MINOR: 5 }, 2, HOUSE_MIN_SHARE);
    expect(q.MINOR).toBe(0);
    expect(q.DEM + q.REP).toBe(2);
  });
});

describe("assignPartiesToDistrictsByQuota — placement respects quotas", () => {
  const pool = { AIP: "grey", DEM: "left", REP: "right" } as Record<
    string,
    "left" | "right" | "grey"
  >;

  it("never assigns a party more districts than its quota (no sweep)", () => {
    const districts = Array.from({ length: 5 }, (_, i) => ({ index: i + 1, netLean: i - 2 }));
    const baselines = { AIP: 1000, DEM: 300, REP: 200 };
    const quotas = { AIP: 3, DEM: 1, REP: 1 };
    const winners = assignPartiesToDistrictsByQuota(districts, baselines, pool, quotas);
    const counts: Record<string, number> = {};
    for (const w of winners) counts[w.party] = (counts[w.party] ?? 0) + 1;
    expect(counts).toEqual({ AIP: 3, DEM: 1, REP: 1 });
    expect(winners.length).toBe(5); // every district assigned exactly once
    expect(new Set(winners.map((w) => w.index)).size).toBe(5);
  });

  it("places a party in its most-favorable districts by lean", () => {
    // REP quota 1 lands in the most right-leaning district; DEM in the most left.
    const districts = [
      { index: 1, netLean: -12 },
      { index: 2, netLean: 0 },
      { index: 3, netLean: 12 },
    ];
    const winners = assignPartiesToDistrictsByQuota(districts, { DEM: 500, REP: 500 }, pool, {
      DEM: 2,
      REP: 1,
    });
    const byIndex = new Map(winners.map((w) => [w.index, w.party]));
    expect(byIndex.get(3)).toBe("REP"); // REP's single seat → its safest district
    expect(byIndex.get(1)).toBe("DEM");
  });
});

describe("assignDistrictsToNominees", () => {
  it("splits a party's won districts by primary share, strongest to most competitive", () => {
    const districts = [
      { index: 1, party: "GOP", netLean: 14 }, // safe
      { index: 2, party: "GOP", netLean: 3 }, // most competitive
      { index: 3, party: "GOP", netLean: 10 }, // mid
    ];
    const nominees = {
      GOP: [
        { candidateId: "X", sharePct: 66.7 },
        { candidateId: "Y", sharePct: 33.3 },
      ],
    };
    const assignment = assignDistrictsToNominees(districts, nominees);
    expect(assignment.size).toBe(3);
    // X (strongest) takes the 2 most competitive (index 2 then 3); Y takes the safe (index 1)
    expect(assignment.get(2)).toBe("X");
    expect(assignment.get(3)).toBe("X");
    expect(assignment.get(1)).toBe("Y");
  });

  it("a single nominee holds all the party's won districts", () => {
    const districts = [
      { index: 1, party: "DEM", netLean: -8 },
      { index: 2, party: "DEM", netLean: -4 },
    ];
    const nominees = { DEM: [{ candidateId: "Z", sharePct: 100 }] };
    const assignment = assignDistrictsToNominees(districts, nominees);
    expect(assignment.get(1)).toBe("Z");
    expect(assignment.get(2)).toBe("Z");
  });
});
