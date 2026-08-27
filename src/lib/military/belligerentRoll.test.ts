import { describe, expect, it } from "vitest";
import { belligerentRoll } from "./belligerentRoll";
import type { ConflictDoc } from "@/lib/db/types/conflict";

/** The live shape of the war for Germany: the US declared, the Pact brought Russia. */
const warForGermany = {
  hostCountry: "DD",
  sideA: { label: "United States", countries: ["US"], kind: "state" },
  sideB: { label: "East Germany", countries: ["DD", "RU"], kind: "coalition" },
  treatyEntries: [
    { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 415 },
  ],
} as unknown as ConflictDoc;

describe("belligerentRoll", () => {
  it("names the side off the host's soil as the attackers", () => {
    const roll = belligerentRoll(warForGermany);
    expect(roll.a.heading).toBe("ATTACKERS");
    expect(roll.b.heading).toBe("DEFENDERS");
  });

  it("says which alliance dragged an ally in", () => {
    const roll = belligerentRoll(warForGermany);
    const ru = roll.b.rows.find((r) => r.code === "RU");
    // The whole reason the panel exists: a code in a list could not distinguish
    // Russia from the country that started the war.
    expect(ru).toMatchObject({ name: "Russia", entry: "Warsaw Pact", viaTreaty: true });
  });

  it("separates the declarer, the declared-on and the ally", () => {
    const roll = belligerentRoll(warForGermany);
    expect(roll.a.rows.map((r) => [r.code, r.entry])).toEqual([["US", "declared"]]);
    expect(roll.b.rows.map((r) => [r.code, r.entry])).toEqual([
      ["DD", "home ground"],
      ["RU", "Warsaw Pact"],
    ]);
  });

  it("resolves names, not codes", () => {
    const roll = belligerentRoll(warForGermany);
    expect(roll.a.rows[0]!.name).toBe("United States");
    expect(roll.b.rows[0]!.name).toBe("East Germany");
  });

  it("flips the headings when the host is on side A", () => {
    const roll = belligerentRoll({
      hostCountry: "DD",
      sideA: { label: "East Germany", countries: ["DD"], kind: "state" },
      sideB: { label: "United States", countries: ["US"], kind: "state" },
    } as unknown as ConflictDoc);
    expect(roll.a.heading).toBe("DEFENDERS");
    expect(roll.b.heading).toBe("ATTACKERS");
  });

  it("names the faction each side backs in a war over somebody else's ground", () => {
    // Every proxy war. The document records no aggressor, and both rosters are
    // interveners — calling either one "the attackers" would be a claim the data
    // does not support. What the war IS about is which local faction each is
    // propping up, so that is what the heading says.
    const roll = belligerentRoll({
      hostCountry: "NVN",
      sideA: { label: "Free World", countries: ["US"], kind: "coalition", factionEntity: "SVN" },
      sideB: {
        label: "Socialist Bloc",
        countries: ["RU"],
        kind: "coalition",
        factionEntity: "NVN",
      },
    } as unknown as ConflictDoc);
    expect(roll.a.heading).toBe("BACKING SOUTH VIETNAM");
    expect(roll.b.heading).toBe("BACKING NORTH VIETNAM");
    expect(roll.a.rows[0]!.entry).toBe("belligerent");
  });

  it("falls back to INTERVENERS for a proxy side with no faction of its own", () => {
    const roll = belligerentRoll({
      hostCountry: "NVN",
      sideA: { label: "Free World", countries: ["US"], kind: "coalition" },
      sideB: { label: "Socialist Bloc", countries: ["RU"], kind: "coalition" },
    } as unknown as ConflictDoc);
    expect(roll.a.heading).toBe("INTERVENERS");
    expect(roll.b.heading).toBe("INTERVENERS");
  });

  it("dates a country that joined an existing war", () => {
    const roll = belligerentRoll({
      hostCountry: "DD",
      sideA: { label: "United States", countries: ["US", "UK"], kind: "coalition" },
      sideB: { label: "East Germany", countries: ["DD"], kind: "state" },
      joinTurns: [{ countryId: "UK", turn: 430, control: 50 }],
    } as unknown as ConflictDoc);
    expect(roll.a.rows.find((r) => r.code === "UK")?.entry).toBe("joined T430");
  });

  it("carries a faction for a side with an empty roster", () => {
    const roll = belligerentRoll({
      hostCountry: "NVN",
      sideA: { label: "South Vietnam", countries: [], kind: "generated", factionEntity: "SVN" },
      sideB: { label: "North Vietnam", countries: [], kind: "generated" },
    } as unknown as ConflictDoc);
    expect(roll.a.rows).toEqual([]);
    expect(roll.a.faction).toBe("South Vietnam");
  });

  it("survives a conflict document with no rosters at all", () => {
    // Read from documents this feature does not own, including seeded ones. A throw
    // here would take down the whole conflict record page.
    const roll = belligerentRoll({ hostCountry: "DD" } as unknown as ConflictDoc);
    expect(roll.a.rows).toEqual([]);
    expect(roll.b.rows).toEqual([]);
  });
});
