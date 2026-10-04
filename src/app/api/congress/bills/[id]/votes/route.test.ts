import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

describe("individual votes in the Russian runtime legislature", () => {
  it.each([
    [{}, "unionCongress", "unionCongressDeputy"],
    [{ ruSovietSuccessionSinceTurn: 4 }, "congressOfPeoplesDeputies", "congressDeputy"],
    [{ ruFederalAssemblySinceTurn: 4 }, "stateDuma", "dumaDeputy"],
  ] as const)(
    "shows only current Russian mandates for %j",
    async (markers, chamber, officeType) => {
      const mem = createInMemoryDb();
      const active = new ObjectId(),
        obsolete = new ObjectId(),
        foreign = new ObjectId(),
        billId = new ObjectId();
      mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
      mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
      mem.seed(
        "npps",
        [active, obsolete, foreign].map((_id) => ({
          _id,
          name: _id.toString(),
          party: "independent",
        }))
      );
      mem.seed("electedOfficials", [
        { countryId: "RU", officeType, nppId: active, seatsHeld: 3 },
        { countryId: "RU", officeType: "obsoleteDeputy", nppId: obsolete, seatsHeld: 100 },
        { countryId: "CS", officeType, nppId: foreign, seatsHeld: 100 },
      ]);
      mem.seed("bills", [
        {
          _id: billId,
          countryId: "RU",
          status: "active",
          originChamber: chamber,
          currentChamber: chamber,
          votes: {
            [`npp_${active}`]: "for",
            [`npp_${obsolete}`]: "for",
            [`npp_${foreign}`]: "for",
          },
        },
      ]);
      vi.mocked(getDb).mockResolvedValue(mem as unknown as Db);
      const response = await GET(
        new Request(`http://localhost/api/congress/bills/${billId}/votes`),
        { params: Promise.resolve({ id: billId.toString() }) }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.voters).toHaveLength(1);
      expect(data.voters[0]).toMatchObject({ seatsHeld: 3, vote: "for", isNPP: true });
    }
  );
});

describe("concurrent appointed Council vote display", () => {
  it.each(["regionalHeads", "regionalDelegates"] as const)(
    "scopes the second tally to %s",
    async (mode) => {
      const mem = createInMemoryDb();
      const lower = new ObjectId(),
        upper = new ObjectId(),
        foreign = new ObjectId(),
        billId = new ObjectId();
      mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
      mem.seed("countryGameStates", [
        { _id: "RU", ruFederalAssemblySinceTurn: 145, ruCouncilComposition: { mode } },
      ]);
      mem.seed(
        "npps",
        [lower, upper, foreign].map((_id) => ({ _id, name: _id.toString(), party: "independent" }))
      );
      mem.seed("electedOfficials", [
        { countryId: "RU", officeType: "dumaDeputy", nppId: lower, seatsHeld: 1 },
        { countryId: "RU", officeType: "federationCouncilMember", nppId: upper, seatsHeld: 2 },
        { countryId: "CS", officeType: "federationCouncilMember", nppId: foreign, seatsHeld: 99 },
      ]);
      mem.seed("bills", [
        {
          _id: billId,
          countryId: "RU",
          status: "active_both",
          originChamber: "stateDuma",
          currentChamber: "stateDuma",
          votes: { [`npp_${lower}`]: "for" },
          otherChamberVotes: {
            [`npp_${lower}`]: "for",
            [`npp_${upper}`]: "against",
            [`npp_${foreign}`]: "for",
          },
        },
      ]);
      vi.mocked(getDb).mockResolvedValue(mem as unknown as Db);
      const response = await GET(
        new Request(`http://localhost/api/congress/bills/${billId}/votes?chamber=other`),
        {
          params: Promise.resolve({ id: billId.toString() }),
        }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.voters).toHaveLength(1);
      expect(data.voters[0]).toMatchObject({ seatsHeld: 2, vote: "against", isNPP: true });
    }
  );
});
