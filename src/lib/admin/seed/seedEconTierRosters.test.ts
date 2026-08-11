import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, type MockCollection } from "@/lib/test-utils/mockDb";
import {
  ECON_TIER_ROSTER_COUNTRIES,
  buildEconTierStatePartyOrgRows,
  buildEconTierChamberSeats,
  seedEconTierRostersForCountry,
  type RosterParty,
} from "./seedEconTierRosters";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { sumSeatsHeld } from "@/lib/seeds/proportionalChamberSeats";

// Real region + party seeds for each econ-tier country — the pure builders are
// exercised against the ACTUAL seed data so the "seeds >0 NPPs/officials" claim
// is proven per country, not against a synthetic fixture.
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { frParties } from "@/lib/seeds/fr/frParties";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { itParties } from "@/lib/seeds/it/itParties";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { esParties } from "@/lib/seeds/es/esParties";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { seParties } from "@/lib/seeds/se/seParties";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { grParties } from "@/lib/seeds/gr/grParties";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { atParties } from "@/lib/seeds/at/atParties";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { fiParties } from "@/lib/seeds/fi/fiParties";
import { trParties } from "@/lib/seeds/tr/trParties";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import type { State } from "@/lib/db/types";

// seedFromSeats is DB-heavy (name-generation, sequential IDs, bulk inserts); the
// orchestration test only needs to prove it's HANDED >0 seats. Its own behavior
// is covered by seedHistorical.test.ts.
const seedFromSeatsMock = vi.fn().mockResolvedValue({ nppsCreated: 0, officialsCreated: 0 });
vi.mock("@/lib/npp/seedHistorical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/npp/seedHistorical")>();
  return { ...actual, seedFromSeats: (...args: unknown[]) => seedFromSeatsMock(...args) };
});

const COUNTRY_SEEDS: Record<CountryId, { regions: State[]; parties: PartySeed[] }> = {
  FR: { regions: frRegions, parties: frParties },
  IT: { regions: itRegions, parties: itParties },
  ES: { regions: esRegions, parties: esParties },
  SE: { regions: seRegions, parties: seParties },
  TR: { regions: trRegions, parties: trParties },
  GR: { regions: grRegions, parties: grParties },
  AT: { regions: atRegions, parties: atParties },
  FI: { regions: fiRegions, parties: fiParties },
} as Record<CountryId, { regions: State[]; parties: PartySeed[] }>;

/** PartySeed[] → the { sequentialId, name } projection the roster path reads. */
function toRosterParties(parties: PartySeed[]): RosterParty[] {
  return parties.map((p, i) => ({ sequentialId: i + 1, name: p.name }));
}

describe("econ-tier roster pure builders (per country)", () => {
  it.each(ECON_TIER_ROSTER_COUNTRIES)(
    "%s seeds >0 statePartyOrg presence rows and chamber seats summing to totalSeats",
    (countryId) => {
      const { regions, parties } = COUNTRY_SEEDS[countryId];
      const regionIds = regions.map((r) => String(r._id));
      const rosterParties = toRosterParties(parties);

      expect(regionIds.length).toBeGreaterThan(0);
      expect(rosterParties.length).toBeGreaterThan(0);

      // 1. statePartyOrg presence: one row per (region × party), all present.
      const orgRows = buildEconTierStatePartyOrgRows(countryId, regionIds, rosterParties);
      expect(orgRows.length).toBe(regionIds.length * rosterParties.length);
      expect(orgRows.every((r) => r.hasPresence === true)).toBe(true);
      expect(orgRows.every((r) => r.countryId === countryId)).toBe(true);
      // Unique _id per (state, party).
      expect(new Set(orgRows.map((r) => r._id)).size).toBe(orgRows.length);

      // 2. Proportional chamber seats: Σ seatsHeld === configured lowerChamber.seats.
      const config = getCountryConfig(countryId);
      const lowerRegions = regions.map((r) => ({
        id: String(r._id),
        seats: r.houseDistricts ?? 0,
      }));
      const partyWeights = rosterParties.map((p, i) => ({
        name: p.name,
        weight: i < 2 ? 45 : 28,
      }));
      const lowerTarget = config.legislature.lowerChamber.seats;
      const lowerSeats = buildEconTierChamberSeats(
        getLowerChamberOfficeType(countryId),
        lowerRegions,
        partyWeights,
        lowerTarget
      );
      expect(sumSeatsHeld(lowerSeats)).toBe(lowerTarget);

      if (
        config.legislature.bicameral &&
        config.legislature.upperChamber &&
        config.upperElectionSystem
      ) {
        const upper = getUpperChamberOfficeType(countryId);
        const upperTarget = config.legislature.upperChamber.seats;
        if (upper && upperTarget) {
          const upperRegions = regions.map((r) => ({
            id: String(r._id),
            seats: r.stateSenateSeats ?? 0,
          }));
          const upperSeats = buildEconTierChamberSeats(
            upper,
            upperRegions,
            partyWeights,
            upperTarget
          );
          expect(sumSeatsHeld(upperSeats)).toBe(upperTarget);
        }
      }
    }
  );

  it("majors get an org bonus over minor parties", () => {
    const rows = buildEconTierStatePartyOrgRows("FR", ["FR_IDF"], toRosterParties(frParties), 2);
    const byParty = new Map(rows.map((r) => [r.partyId, r.organization]));
    // Parties 1 and 2 (majors) outrank party 3+ (minors), if any minors exist.
    if (rows.length > 2) {
      expect(byParty.get("1")!).toBeGreaterThan(byParty.get("3")!);
      expect(byParty.get("2")!).toBeGreaterThan(byParty.get("3")!);
    }
  });
});

// ── Orchestration: seedEconTierRostersForCountry against a mock DB ────────────
function setFindDocs(col: MockCollection, docs: unknown[]) {
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  col.find = vi.fn().mockReturnValue(cursor);
}

describe("seedEconTierRostersForCountry (orchestration)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    seedFromSeatsMock.mockClear();
    seedFromSeatsMock.mockResolvedValue({ nppsCreated: 16, officialsCreated: 16 });
  });

  it("upserts presence rows and hands seedFromSeats a chamber-sized roster in winners mode", async () => {
    setFindDocs(db.collection("politicalParties") as MockCollection, [
      { sequentialId: 1, name: "Rassemblement pour la République" },
      { sequentialId: 2, name: "Parti socialiste" },
      { sequentialId: 3, name: "Parti communiste français" },
    ]);
    setFindDocs(db.collection("states") as MockCollection, [
      { _id: "FR_IDF", houseDistricts: 100, stateSenateSeats: 40 },
      { _id: "FR_NOR", houseDistricts: 50, stateSenateSeats: 20 },
    ]);

    const result = await seedEconTierRostersForCountry(db as unknown as Db, "FR", "winners");

    // statePartyOrg presence rows upserted (2 regions × 3 parties).
    const spo = db.collection("statePartyOrg") as MockCollection;
    expect(spo.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = (spo.bulkWrite as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as unknown[];
    expect(ops.length).toBe(6);
    expect(result.orgRows).toBe(6);

    // seedFromSeats called with seatsHeld summing to FR lower+upper targets.
    expect(seedFromSeatsMock).toHaveBeenCalledTimes(1);
    const [, seats, mode] = seedFromSeatsMock.mock.calls[0];
    const seatList = seats as { seatsHeld?: number; officeType: string }[];
    expect(seatList.length).toBeGreaterThan(0);
    expect(mode).toBe("winners");
    const lowerSum = seatList
      .filter((s) => s.officeType === "deputy")
      .reduce((n, s) => n + (s.seatsHeld ?? 1), 0);
    const upperSum = seatList
      .filter((s) => s.officeType === "senator")
      .reduce((n, s) => n + (s.seatsHeld ?? 1), 0);
    expect(lowerSum).toBe(getCountryConfig("FR").legislature.lowerChamber.seats);
    expect(upperSum).toBe(getCountryConfig("FR").legislature.upperChamber!.seats);
    expect(result.nppsCreated).toBe(16);
    expect(result.officialsCreated).toBe(16);
  });

  it("asks seedFromSeats to skip already-seated chambers so a re-run cannot double the legislature", async () => {
    // A reset that dies partway and is re-run is a realistic operator action.
    // Without this flag the second pass appends a whole second parallel chamber
    // instead of converging — the live FR 80→160 / UK 72→144 corruption. The
    // convergence itself is proven end-to-end against a stateful db in
    // src/lib/npp/seedFromSeatsIdempotency.test.ts; this pins the wiring.
    setFindDocs(db.collection("politicalParties") as MockCollection, [
      { sequentialId: 1, name: "Rassemblement pour la République" },
      { sequentialId: 2, name: "Parti socialiste" },
    ]);
    setFindDocs(db.collection("states") as MockCollection, [
      { _id: "FR_IDF", houseDistricts: 100, stateSenateSeats: 40 },
    ]);

    await seedEconTierRostersForCountry(db as unknown as Db, "FR", "winners");

    expect(seedFromSeatsMock).toHaveBeenCalledTimes(1);
    const [, , mode, options] = seedFromSeatsMock.mock.calls[0];
    expect(mode).toBe("winners");
    expect(options).toEqual(expect.objectContaining({ skipAlreadySeatedChambers: true }));
  });

  it("priors mode seeds presence only — no incumbent seats", async () => {
    setFindDocs(db.collection("politicalParties") as MockCollection, [
      { sequentialId: 1, name: "Rassemblement pour la République" },
      { sequentialId: 2, name: "Parti socialiste" },
    ]);
    setFindDocs(db.collection("states") as MockCollection, [{ _id: "FR_IDF" }]);

    const result = await seedEconTierRostersForCountry(db as unknown as Db, "FR", "priors");

    expect((db.collection("statePartyOrg") as MockCollection).bulkWrite).toHaveBeenCalledTimes(1);
    expect(seedFromSeatsMock).not.toHaveBeenCalled();
    expect(result.officialsCreated).toBe(0);
    expect(result.nppsCreated).toBe(0);
  });

  it("no default parties for the preset → full no-op (no fabricated roster)", async () => {
    setFindDocs(db.collection("politicalParties") as MockCollection, []);
    setFindDocs(db.collection("states") as MockCollection, [{ _id: "FR_IDF" }]);

    const result = await seedEconTierRostersForCountry(db as unknown as Db, "FR", "winners");

    expect((db.collection("statePartyOrg") as MockCollection).bulkWrite).not.toHaveBeenCalled();
    expect(seedFromSeatsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ countryId: "FR", orgRows: 0, nppsCreated: 0, officialsCreated: 0 });
  });
});
