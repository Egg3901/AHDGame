import { describe, expect, it } from "vitest";
import { resolveOfficeHolderGrants } from "./officeHolderRules";

const chars = [
  { characterId: "c1", userId: "u1" },
  { characterId: "c2", userId: "u2" },
  { characterId: "c3", userId: "u2" },
];

describe("resolveOfficeHolderGrants", () => {
  it("grants cabinet and chair achievements to holders regardless of profile visits", () => {
    const grants = resolveOfficeHolderGrants({
      cabinetCharacterIds: new Set(["c1"]),
      chairCharacterIds: new Set(["c2"]),
      characters: chars,
    });
    expect(grants).toEqual([
      { slug: "cabinet_seat", userId: "u1", characterId: "c1" },
      { slug: "central_banker", userId: "u2", characterId: "c2" },
    ]);
  });

  it("grants one award per account and slug", () => {
    const grants = resolveOfficeHolderGrants({
      cabinetCharacterIds: new Set(["c2", "c3"]),
      chairCharacterIds: new Set(),
      characters: chars,
    });
    expect(grants).toEqual([{ slug: "cabinet_seat", userId: "u2", characterId: "c2" }]);
  });

  it("grants nothing when nobody holds office", () => {
    expect(
      resolveOfficeHolderGrants({
        cabinetCharacterIds: new Set(),
        chairCharacterIds: new Set(),
        characters: chars,
      })
    ).toEqual([]);
  });
});
