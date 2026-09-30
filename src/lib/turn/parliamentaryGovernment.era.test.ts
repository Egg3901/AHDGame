import { describe, expect, it, vi } from "vitest";
import {
  getParliamentaryCountryIds,
  tallySeatsByParty,
  processParliamentaryNPPAutoAye,
} from "./parliamentaryGovernment";
import { getHeadOfGovernmentOfficeKey } from "@/lib/constants/countries";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { ObjectId, type Db } from "mongodb";

describe("era-aware parliamentary government coverage", () => {
  it.each([
    [{}, "unionCongressDeputy"],
    [{ ruSovietSuccessionSinceTurn: 24 }, "congressDeputy"],
    [{ ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 150 }, "dumaDeputy"],
  ])("tallies only the active Russian chamber for %j", async (markers, activeOffice) => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
    mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
    mem.seed("electedOfficials", [
      {
        _id: "soviet",
        countryId: "RU",
        officeType: "unionCongressDeputy",
        party: "1",
        seatsHeld: 10,
      },
      { _id: "congress", countryId: "RU", officeType: "congressDeputy", party: "2", seatsHeld: 20 },
      { _id: "duma", countryId: "RU", officeType: "dumaDeputy", party: "3", seatsHeld: 30 },
      { _id: "other", countryId: "UK", officeType: activeOffice, party: "4", seatsHeld: 100 },
    ]);
    const expected =
      activeOffice === "unionCongressDeputy"
        ? { "1": 10 }
        : activeOffice === "congressDeputy"
          ? { "2": 20 }
          : { "3": 30 };
    expect(await tallySeatsByParty(mem as unknown as Db, "RU")).toEqual(expected);
  });

  it.each([
    [{}, "unionCongressDeputy", "dumaDeputy"],
    [{ ruSovietSuccessionSinceTurn: 24 }, "congressDeputy", "unionCongressDeputy"],
    [
      { ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 150 },
      "dumaDeputy",
      "congressDeputy",
    ],
  ])(
    "NPC appointment votes use only the effective chamber for %j",
    async (markers, activeOffice, obsoleteOffice) => {
      const mem = createInMemoryDb();
      const voteId = new ObjectId();
      const nppId = new ObjectId();
      const formerId = new ObjectId();
      mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
      mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
      mem.seed("pmAppointmentVotes", [
        {
          _id: voteId,
          countryId: "RU",
          status: "active",
          formationType: "majority",
          nomineePartyId: "1",
          votes: {},
          votesFor: 0,
          votesAgainst: 0,
        },
      ]);
      mem.seed("electedOfficials", [
        {
          _id: new ObjectId(),
          countryId: "RU",
          officeType: activeOffice,
          isNPP: true,
          nppId,
          party: "1",
          seatsHeld: 4,
        },
        {
          _id: new ObjectId(),
          countryId: "RU",
          officeType: obsoleteOffice,
          isNPP: true,
          nppId: formerId,
          party: "1",
          seatsHeld: 50,
        },
      ]);
      await processParliamentaryNPPAutoAye(mem as unknown as Db, "RU", new Date(0), 4);
      expect(mem.collection("pmAppointmentVotes").docs[0]).toMatchObject({
        votesFor: 4,
        votesAgainst: 0,
        votes: { [`npp_${nppId}`]: "aye" },
      });
      expect(mem.collection("pmAppointmentVotes").docs[0].votes).not.toHaveProperty(
        `npp_${formerId}`
      );
    }
  );

  it("reads one constitutional snapshot for 100 simultaneous appointment votes", async () => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
    mem.seed("countryGameStates", [{ _id: "RU", ruSovietSuccessionSinceTurn: 24 }]);
    mem.seed(
      "pmAppointmentVotes",
      Array.from({ length: 100 }, () => ({
        _id: new ObjectId(),
        countryId: "RU",
        status: "active",
        formationType: "majority",
        nomineePartyId: "1",
        votes: {},
      }))
    );
    const markers = vi.spyOn(mem.collection("countryGameStates"), "findOne");
    const preset = vi.spyOn(mem.collection("gameState"), "findOne");
    await processParliamentaryNPPAutoAye(mem as unknown as Db, "RU", new Date(0), 4);
    expect(markers).toHaveBeenCalledTimes(1);
    expect(preset).toHaveBeenCalledTimes(1);
  });

  it("includes Fourth Republic France in the 1953 government loop", () => {
    expect(getParliamentaryCountryIds("1953-default")).toContain("FR");
  });

  it("does not classify Fifth Republic France as parliamentary in 1979", () => {
    expect(getParliamentaryCountryIds("1979-default")).not.toContain("FR");
  });

  it("runs Romanian parliamentary PM formation without confusing the elected presidency", () => {
    expect(getParliamentaryCountryIds("2027-default")).toContain("RO");
    expect(getHeadOfGovernmentOfficeKey("RO", "2027-default")).toBe("primeMinister");
    expect(getParliamentaryCountryIds("2027-default")).not.toContain("RU");
    expect(getParliamentaryCountryIds("1979-default")).toContain("RO");
  });
});
