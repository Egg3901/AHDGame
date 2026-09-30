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
