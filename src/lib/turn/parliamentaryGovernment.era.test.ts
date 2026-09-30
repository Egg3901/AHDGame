import { describe, expect, it } from "vitest";
import { getParliamentaryCountryIds, tallySeatsByParty } from "./parliamentaryGovernment";
import { getHeadOfGovernmentOfficeKey } from "@/lib/constants/countries";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Db } from "mongodb";

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
