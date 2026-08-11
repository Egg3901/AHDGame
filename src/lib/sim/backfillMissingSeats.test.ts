/**
 * Unit tests for the zero-state backfill weighting (1953 sim forensics fix):
 * a chamber that starts vacant is backfilled by SEEDED per-region strength
 * (statePartyOrg), not an even split across all parties — so SNP/PC/SF never
 * get synthetic "incumbents" in England.
 *
 * Also covers Defect 2's fix: `backfillChamber`/`backfillSubNationalChamber`
 * iterate the `states` collection directly (not the era-scoped `seats` slot
 * collection), so without the `isUsBackfillEligibleState` gate they apportion
 * federal seats by raw population across every US `states` row — fabricating
 * a DC Senate seat and DC/HI House `seatsHeld` from population alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/npp/seedHistorical", () => ({
  seedFromSeats: vi.fn(),
}));

import {
  computeZeroStateRegionWeights,
  allocateSeatsByWeights,
  isUsBackfillEligibleState,
  SUB_NATIONAL_CHAMBERS,
  backfillMissingSeats,
  type SeedStrengthRow,
} from "./backfillMissingSeats";
import { seedFromSeats } from "@/lib/npp/seedHistorical";
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import { HOUSE_SEATS, HOUSE_SEATS_1953 } from "@/lib/constants/states";

const row = (
  partyId: string,
  organization: number,
  extra: Partial<SeedStrengthRow> = {}
): SeedStrengthRow => ({ stateId: "LON", partyId, organization, ...extra });

describe("computeZeroStateRegionWeights", () => {
  it("weights by organization when no registration data is present", () => {
    const w = computeZeroStateRegionWeights([row("1", 60), row("2", 30)]);
    expect(w.get("1")).toBe(60);
    expect(w.get("2")).toBe(30);
  });

  it("a party with NO row in the region simply has no weight (regional parties stay home)", () => {
    // Only Con/Lab/Lib have rows in an English region — SNP/PC/SF do not.
    const w = computeZeroStateRegionWeights([row("con", 65), row("lab", 70), row("lib", 8)]);
    expect(w.has("snp")).toBe(false);
    expect(w.has("pc")).toBe(false);
    expect(w.size).toBe(3);
  });

  it("excludes hasPresence: false rows", () => {
    const w = computeZeroStateRegionWeights([row("1", 60), row("2", 30, { hasPresence: false })]);
    expect(w.has("2")).toBe(false);
    expect(w.get("1")).toBe(60);
  });

  it("scales by registration share when every present row carries one (UK 1951 shape)", () => {
    // 1951 LON: Lab 51% (org 70), Con 46% (org 65), Lib 2% (org 8).
    const w = computeZeroStateRegionWeights([
      row("lab", 70, { registrationShare: 51 }),
      row("con", 65, { registrationShare: 46 }),
      row("lib", 8, { registrationShare: 2 }),
    ]);
    expect(w.get("lab")).toBe(70 * 51);
    expect(w.get("con")).toBe(65 * 46);
    expect(w.get("lib")).toBe(8 * 2);
    // Liberal weight must be a sliver (<1%), not the org-only ~5.6%.
    const total = [...w.values()].reduce((a, b) => a + b, 0);
    expect(w.get("lib")! / total).toBeLessThan(0.01);
  });

  it("zero registration share zeroes a seeded-but-absent party (SNP in 1951 Scotland)", () => {
    const w = computeZeroStateRegionWeights([
      row("con", 68, { registrationShare: 48 }),
      row("lab", 68, { registrationShare: 48 }),
      row("snp", 5, { registrationShare: 0 }),
    ]);
    expect(w.has("snp")).toBe(false);
  });

  it("falls back to `registration` when `registrationShare` is absent", () => {
    const w = computeZeroStateRegionWeights([
      row("1", 40, { registration: 50 }),
      row("2", 20, { registration: 25 }),
    ]);
    expect(w.get("1")).toBe(40 * 50);
    expect(w.get("2")).toBe(20 * 25);
  });

  it("uses org-only weights when registration coverage is partial (no mixed scales)", () => {
    const w = computeZeroStateRegionWeights([
      row("1", 40, { registration: 50 }),
      row("2", 20), // no registration → whole region falls back to org
    ]);
    expect(w.get("1")).toBe(40);
    expect(w.get("2")).toBe(20);
  });

  it("returns an empty map when no rows exist (caller falls back to even split)", () => {
    expect(computeZeroStateRegionWeights([]).size).toBe(0);
  });
});

describe("SUB_NATIONAL_CHAMBERS (candidate-supply floor registry)", () => {
  it("covers RU's republic Supreme Soviets so #3386 elections resolve seated", () => {
    const ru = SUB_NATIONAL_CHAMBERS.RU;
    expect(ru?.officeType).toBe("republicSupremeSoviet");
    // Republic soviet size = the seed doc's authored stateSenateSeats (the same
    // single source ensureRURepublicSovietElections sizes its elections from).
    expect(ru?.seatsForState({ _id: "UKR", stateSenateSeats: 650 })).toBe(650);
    expect(ru?.seatsForState({ _id: "X", stateSenateSeats: null })).toBe(0);
  });

  it("still covers the CN People's Congress it was modeled on", () => {
    expect(SUB_NATIONAL_CHAMBERS.CN?.officeType).toBe("peoplesCongress");
  });
});

describe("allocateSeatsByWeights", () => {
  it("allocates exactly `seats` by largest remainder", () => {
    const out = allocateSeatsByWeights(
      75,
      new Map([
        ["lab", 70 * 51],
        ["con", 65 * 46],
        ["lib", 8 * 2],
      ])
    );
    const total = [...out.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(75);
    // Lab 54.5% / Con 45.3% / Lib 0.24% of weight → ≈41/34/0
    expect(out.get("lab")!).toBeGreaterThan(out.get("con")!);
    expect(out.get("lib") ?? 0).toBeLessThanOrEqual(1);
  });

  it("gives zero-weight parties nothing", () => {
    const out = allocateSeatsByWeights(
      10,
      new Map([
        ["a", 100],
        ["b", 0],
      ])
    );
    expect(out.get("a")).toBe(10);
    expect(out.has("b")).toBe(false);
  });

  it("handles seats ≤ 0 and empty weights", () => {
    expect(allocateSeatsByWeights(0, new Map([["a", 5]])).size).toBe(0);
    expect(allocateSeatsByWeights(5, new Map()).size).toBe(0);
  });

  it("is deterministic and preserves the total for awkward remainders", () => {
    const weights = new Map([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
    const out = allocateSeatsByWeights(7, weights);
    const total = [...out.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(7);
    expect(allocateSeatsByWeights(7, weights)).toEqual(out);
  });
});

describe("isUsBackfillEligibleState (Defect 2: phantom DC/HI federal seats)", () => {
  it("DC is never eligible, in any era — it has never elected a senator or a House member", () => {
    expect(isUsBackfillEligibleState("DC", HOUSE_SEATS)).toBe(false);
    expect(isUsBackfillEligibleState("DC", HOUSE_SEATS_1953)).toBe(false);
  });

  it("HI/AK are ineligible under the 1953 apportionment map (territories until 1959)", () => {
    expect(isUsBackfillEligibleState("HI", HOUSE_SEATS_1953)).toBe(false);
    expect(isUsBackfillEligibleState("AK", HOUSE_SEATS_1953)).toBe(false);
  });

  it("HI/AK are eligible once the active era's apportionment map lists them (post-1959)", () => {
    expect(isUsBackfillEligibleState("HI", HOUSE_SEATS)).toBe(true);
    expect(isUsBackfillEligibleState("AK", HOUSE_SEATS)).toBe(true);
  });

  it("an ordinary full-representation state is always eligible", () => {
    expect(isUsBackfillEligibleState("WY", HOUSE_SEATS)).toBe(true);
  });
});

describe("backfillMissingSeats — DC never receives population-proportional federal seats (Defect 2)", () => {
  let db: MockDb;
  let captured: HistoricalSeat[];

  beforeEach(() => {
    db = createMockDb();
    captured = [];
    vi.mocked(seedFromSeats).mockReset();
    vi.mocked(seedFromSeats).mockImplementation(async (_db: unknown, seats: HistoricalSeat[]) => {
      captured.push(...seats);
      return { nppsCreated: seats.length, officialsCreated: seats.length };
    });

    // `states` includes DC (real population, no House/Senate/stateSenate slots)
    // alongside one ordinary full-representation state. Before the fix,
    // `backfillChamber`/`backfillSubNationalChamber` apportioned seats across
    // this ENTIRE array by population — fabricating a DC Senate seat and DC
    // House seatsHeld purely because DC has people living in it.
    db.collectionMocks["states"] = {
      ...db.collection("states"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "DC", countryId: "US", population: 700_000, stateSenateSeats: null },
          { _id: "WY", countryId: "US", population: 580_000, stateSenateSeats: 30 },
        ]),
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ sequentialId: 1, name: "Test Party" }]),
        }),
        toArray: vi.fn().mockResolvedValue([{ sequentialId: 1, name: "Test Party" }]),
      }),
    } as MockDb["collectionMocks"][string];
  });

  it("apportions House/Senate/state-Senate backfill seats only to WY, never to DC", async () => {
    await backfillMissingSeats(db as unknown as Db, "US");

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((s) => s.state === "DC")).toBe(false);
    expect(captured.every((s) => s.state === "WY")).toBe(true);
  });
});
