import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadRuntimeCountryOffices } from "./runtimeOffices";

describe("world and constitution resolved parliamentary offices", () => {
  it.each([
    [{}, "unionCongressDeputy", "chairmanOfCabinet", "sovietPresident"],
    [
      { ruSovietSuccessionSinceTurn: 24 },
      "congressDeputy",
      "primeMinister",
      "chairmanOfSupremeSoviet",
    ],
    [
      { ruSovietSuccessionSinceTurn: 24, ruPresidencySinceTurn: 25 },
      "congressDeputy",
      "primeMinister",
      "president",
    ],
    [
      { ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 150 },
      "dumaDeputy",
      "primeMinister",
      "chairmanOfSupremeSoviet",
    ],
    [
      {
        ruSovietSuccessionSinceTurn: 24,
        ruPresidencySinceTurn: 25,
        ruFederalAssemblySinceTurn: 150,
      },
      "dumaDeputy",
      "primeMinister",
      "president",
    ],
  ])("resolves the active RU office layout from %j", async (markers, lower, pm, hos) => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
    mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
    const layout = await loadRuntimeCountryOffices(mem as unknown as Db, "RU");
    expect(layout.lowerOfficeType).toBe(lower);
    expect(layout.headOfGovernmentOfficeKey).toBe(pm);
    expect(layout.headOfStateOfficeType).toBe(hos);
  });

  it.each([
    [{ ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: 11 }, 11],
    [{ ruSovietSuccessionSinceTurn: 24 }, 1068],
    [
      {
        ruSovietSuccessionSinceTurn: 24,
        ruProvisionalCongressSeats: 11,
        ruFederalAssemblySinceTurn: 30,
      },
      450,
    ],
  ])(
    "uses the provisional capacity without changing legacy or elected assembly mandates %j",
    async (markers, seats) => {
      const mem = createInMemoryDb();
      mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
      const layout = await loadRuntimeCountryOffices(mem as unknown as Db, "RU", "1991-default");
      expect(layout.config.legislature.lowerChamber.seats).toBe(seats);
      expect(layout.config.coalitionThreshold).toBe(Math.floor(seats / 2) + 1);
    }
  );

  it.each([0, -1, 1.5, NaN])("rejects corrupt provisional capacity %s", async (seats) => {
    const mem = createInMemoryDb();
    mem.seed("countryGameStates", [
      { _id: "RU", ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: seats },
    ]);
    await expect(
      loadRuntimeCountryOffices(mem as unknown as Db, "RU", "1991-default")
    ).rejects.toThrow("positive integer");
  });

  it("does not read Russian markers for another country or world era", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    const read = vi.spyOn(db.collection("countryGameStates"), "findOne");
    expect((await loadRuntimeCountryOffices(db, "UK", "1991-default")).lowerOfficeType).toBe(
      "commons"
    );
    expect((await loadRuntimeCountryOffices(db, "RU", "1979-default")).lowerOfficeType).toBe(
      "supremeSovietDeputy"
    );
    expect(read).not.toHaveBeenCalled();
  });
});
