import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { districtedHouseResolution } from "./districtedHouseResolution";

function makeFakeDb(seed: Record<string, unknown[]>): { db: Db; store: Record<string, unknown[]> } {
  const store: Record<string, unknown[]> = { ...seed };
  const db = {
    collection(name: string) {
      store[name] = store[name] ?? [];
      const rows = store[name];
      return {
        find: () => ({ toArray: async () => rows }),
        async updateOne(filter: { _id: string }, update: { $set: Record<string, unknown> }) {
          const row = rows.find((r) => (r as { _id: string })._id === filter._id) as
            Record<string, unknown> | undefined;
          if (row) Object.assign(row, update.$set);
          return { acknowledged: true };
        },
      };
    },
  } as unknown as Db;
  return { db, store };
}

describe("districtedHouseResolution", () => {
  it("returns null when the state has no district docs (caller falls back)", async () => {
    const { db } = makeFakeDb({ congressionalDistricts: [], politicalParties: [] });
    const res = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: "CA",
      candidateVotes: { a: 100 },
      candidateParty: { a: "DEM" },
      candidateCharacterId: { a: "507f1f77bcf86cd799439011" },
      primaryShares: null,
      now: new Date("2026-01-01"),
    });
    expect(res).toBeNull();
  });

  it("resolves per-district winners and stamps holders", async () => {
    const { db, store } = makeFakeDb({
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", name: "Democrat", economicPosition: -2 },
        {
          _id: "p2",
          sequentialId: 2,
          abbreviation: "GOP",
          name: "Republican",
          economicPosition: 2,
        },
      ],
      congressionalDistricts: [
        {
          _id: "US_CA_1",
          countryId: "US",
          stateId: "CA",
          index: 1,
          netLean: -16,
          squares: { left: 16, right: 0, grey: 0 },
        },
        {
          _id: "US_CA_2",
          countryId: "US",
          stateId: "CA",
          index: 2,
          netLean: 16,
          squares: { left: 0, right: 16, grey: 0 },
        },
      ],
    });

    const res = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: "CA",
      // DEM leads statewide, but district 2 is fully R-packed.
      candidateVotes: { dca: 1000, gca: 400 },
      candidateParty: { dca: "DEM", gca: "GOP" },
      candidateCharacterId: { dca: "507f1f77bcf86cd799439011", gca: "507f1f77bcf86cd799439012" },
      primaryShares: null,
      now: new Date("2026-01-01"),
      persist: true,
    });

    expect(res).not.toBeNull();
    expect(res!.authoritativeSeats).toBe(2);
    expect(res!.seatsEstimate).toEqual({ dca: 1, gca: 1 }); // D wins d1, G wins d2
    const docs = store.congressionalDistricts as {
      index: number;
      holderParty: string;
      holderCharacterId: unknown;
    }[];
    expect(docs.find((d) => d.index === 1)!.holderParty).toBe("DEM");
    expect(docs.find((d) => d.index === 2)!.holderParty).toBe("GOP");
    expect(docs.find((d) => d.index === 1)!.holderCharacterId).not.toBeNull();
  });

  // `enrichElection` runs this same resolver to draw the live "Projected Seats"
  // panel on every House race page view. While persistence was unconditional,
  // opening a live race rewrote that state's sitting members from an
  // in-progress tally — and since the projection path has no NPP id map, it
  // wrote `npps` ids into `holderCharacterId`, so every NPP-held seat resolved
  // against `characters`, found nothing, and rendered unheld.
  it("does not touch the district docs unless persist is set", async () => {
    const { db, store } = makeFakeDb({
      politicalParties: PARTIES,
      congressionalDistricts: docsFor([
        { left: 16, right: 0, grey: 0 },
        { left: 0, right: 16, grey: 0 },
      ]),
    });

    const res = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: "TX",
      candidateVotes: { d: 1000, g: 400 },
      candidateParty: { d: "DEM", g: "GOP" },
      candidateCharacterId: { d: CHAR, g: CHAR },
      primaryShares: null,
      now: new Date("2026-01-01"),
    });

    // The projection is still returned in full.
    expect(res!.authoritativeSeats).toBe(2);
    expect(Object.values(res!.seatsEstimate).reduce((a, b) => a + b, 0)).toBe(2);
    // ...but nothing was written.
    for (const doc of store.congressionalDistricts as Record<string, unknown>[]) {
      expect(doc.holderCharacterId).toBeUndefined();
      expect(doc.holderNppId).toBeUndefined();
      expect(doc.holderParty).toBeUndefined();
      expect(doc.updatedAt).toBeUndefined();
    }
  });
});

/** Build district docs from square maps. */
function docsFor(squares: { left: number; right: number; grey: number }[]) {
  return squares.map((sq, i) => ({
    _id: `US_TX_${i + 1}`,
    countryId: "US",
    stateId: "TX",
    index: i + 1,
    netLean: sq.right - sq.left,
    squares: sq,
  }));
}

const PARTIES = [
  { _id: "p1", sequentialId: 1, abbreviation: "DEM", name: "Democrat", economicPosition: -2 },
  { _id: "p2", sequentialId: 2, abbreviation: "GOP", name: "Republican", economicPosition: 2 },
];

const CHAR = "507f1f77bcf86cd799439011";

async function resolve(
  squares: { left: number; right: number; grey: number }[],
  args?: Partial<Parameters<typeof districtedHouseResolution>[1]>
) {
  const { db, store } = makeFakeDb({
    politicalParties: PARTIES,
    congressionalDistricts: docsFor(squares),
  });
  const res = await districtedHouseResolution(db, {
    countryId: "US",
    stateId: "TX",
    candidateVotes: { d: 550, g: 450 },
    candidateParty: { d: "DEM", g: "GOP" },
    candidateCharacterId: { d: CHAR, g: CHAR },
    primaryShares: null,
    now: new Date("2026-01-01"),
    // These cases assert what the turn resolver writes, so they take the
    // persisting path. The read-only default is covered separately above.
    persist: true,
    ...args,
  });
  return { res, store };
}

describe("districtedHouseResolution — gerrymandering changes outcomes", () => {
  // Same statewide votes (DEM 55 / GOP 45) over 5 districts, budget L44/R36/G0.
  it("a fair map gives DEM the majority of seats", async () => {
    const fair = [
      { left: 11, right: 5, grey: 0 }, // -6
      { left: 10, right: 6, grey: 0 }, // -4
      { left: 9, right: 7, grey: 0 }, // -2
      { left: 8, right: 8, grey: 0 }, // 0 (statewide leader DEM)
      { left: 6, right: 10, grey: 0 }, // +4
    ];
    const { res } = await resolve(fair);
    const demSeats = res!.seatsEstimate.d ?? 0;
    expect(demSeats).toBeGreaterThanOrEqual(3);
    expect((res!.seatsEstimate.g ?? 0) + demSeats).toBe(5);
  });

  it("a packing gerrymander can NOT change seat totals — they stay proportional (ticket 926)", async () => {
    // Same statewide votes (DEM 55 / GOP 45). Under the old winner-take-all-per-
    // district model, packing DEM into safe sinks handed GOP a 3-2 majority
    // despite losing the popular vote. With proportional quotas the totals are
    // gerrymander-invariant: DEM keeps its proportional 3 seats. Gerrymandering
    // now only shifts WHICH districts each party holds, not HOW MANY.
    const gerrymander = [
      { left: 16, right: 0, grey: 0 }, // -16 packed DEM
      { left: 12, right: 4, grey: 0 }, // -8 second DEM sink
      { left: 6, right: 10, grey: 0 }, // +4
      { left: 5, right: 11, grey: 0 }, // +6
      { left: 5, right: 11, grey: 0 }, // +6
    ];
    const { res } = await resolve(gerrymander);
    expect(res!.seatsEstimate.d ?? 0).toBe(3); // proportional, not suppressed to 2
    expect(res!.seatsEstimate.g ?? 0).toBe(2);
  });

  it("a Campaign Here boost changes WHICH district a party holds, not the total", async () => {
    // Near-tied state (DEM 50.5 / GOP 49.5) over two even districts → 1 seat each
    // proportionally. A capped GOP boost in district 1 does not add a GOP seat;
    // it swaps which district GOP holds (d1 instead of d2). Totals stay 1-1.
    const map = [
      { left: 8, right: 8, grey: 0 }, // 0
      { left: 8, right: 8, grey: 0 }, // 0
    ];
    const votes = { candidateVotes: { d: 505, g: 495 } };

    const noBoost = await resolve(map, votes);
    expect(noBoost.res!.seatsEstimate).toEqual({ d: 1, g: 1 });
    const nbDocs = noBoost.store.congressionalDistricts as { index: number; holderParty: string }[];
    expect(nbDocs.find((d) => d.index === 1)!.holderParty).toBe("DEM");
    expect(nbDocs.find((d) => d.index === 2)!.holderParty).toBe("GOP");

    const boosted = await resolve(map, { ...votes, districtBoosts: { "1": { GOP: 7.5 } } });
    expect(boosted.res!.seatsEstimate).toEqual({ d: 1, g: 1 }); // total unchanged
    const bDocs = boosted.store.congressionalDistricts as { index: number; holderParty: string }[];
    expect(bDocs.find((d) => d.index === 1)!.holderParty).toBe("GOP"); // swapped into d1
    expect(bDocs.find((d) => d.index === 2)!.holderParty).toBe("DEM");
  });

  it("assigns the strongest primary nominee to the most competitive won districts", async () => {
    const map = [
      { left: 12, right: 4, grey: 0 }, // -8 safe
      { left: 9, right: 7, grey: 0 }, // -2 competitive
      { left: 4, right: 12, grey: 0 }, // +8 GOP
    ];
    const { res, store } = await resolve(map, {
      candidateVotes: { d1: 300, d2: 250, g: 450 },
      candidateParty: { d1: "DEM", d2: "DEM", g: "GOP" },
      candidateCharacterId: { d1: CHAR, d2: CHAR, g: CHAR },
      primaryShares: { d1: 55, d2: 45 },
    });
    // DEM wins districts 1 and 2; d1 (stronger) takes the competitive one (index 2).
    expect(res!.seatsEstimate).toEqual({ d1: 1, d2: 1, g: 1 });
    const docs = store.congressionalDistricts as { index: number; holderParty: string }[];
    expect(docs.filter((d) => d.holderParty === "DEM")).toHaveLength(2);
    expect(docs.find((d) => d.index === 3)!.holderParty).toBe("GOP");
  });

  it("stamps NPP winners into holderNppId, not holderCharacterId", async () => {
    // GOP nominee is an NPP (id passed via candidateNppId); DEM is a real player.
    const map = [
      { left: 12, right: 4, grey: 0 }, // -8 DEM
      { left: 4, right: 12, grey: 0 }, // +8 GOP (won by the NPP)
    ];
    const NPP = "607f1f77bcf86cd799439099";
    const { store } = await resolve(map, {
      candidateVotes: { d: 500, g: 500 },
      candidateParty: { d: "DEM", g: "GOP" },
      candidateCharacterId: { d: CHAR, g: null },
      candidateNppId: { d: null, g: NPP },
      primaryShares: null,
    });
    const docs = store.congressionalDistricts as {
      index: number;
      holderParty: string;
      holderCharacterId: unknown;
      holderNppId: unknown;
    }[];
    const gop = docs.find((d) => d.holderParty === "GOP")!;
    expect(String(gop.holderNppId)).toBe(NPP);
    expect(gop.holderCharacterId).toBeNull();
    const dem = docs.find((d) => d.holderParty === "DEM")!;
    expect(String(dem.holderCharacterId)).toBe(CHAR);
    expect(dem.holderNppId).toBeNull();
  });

  it("every district gets a holder and seats sum to the district count", async () => {
    const map = [
      { left: 10, right: 4, grey: 2 },
      { left: 8, right: 6, grey: 2 },
      { left: 6, right: 8, grey: 2 },
      { left: 4, right: 10, grey: 2 },
    ];
    const { res, store } = await resolve(map);
    const total = Object.values(res!.seatsEstimate).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
    const docs = store.congressionalDistricts as { holderParty?: string }[];
    for (const d of docs) expect(d.holderParty === "DEM" || d.holderParty === "GOP").toBe(true);
  });
});
