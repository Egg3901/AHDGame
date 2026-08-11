import { describe, expect, it } from "vitest";
import { characterNameSchema, createCharacterSchema } from "./settings";
import { createPartySchema } from "./parties";
import { foundCorporationSchema, setSectorDisplayNameSchema } from "./corporations";

describe("name moderation schemas", () => {
  it("allows clean names and mild words", () => {
    expect(characterNameSchema.safeParse({ name: "Alice" }).success).toBe(true);
    expect(characterNameSchema.safeParse({ name: "Dick" }).success).toBe(true);
    expect(
      createCharacterSchema.safeParse({
        name: "Ass",
        homeState: "CA",
        countryId: "US",
        policies: { economic: 0, social: 0 },
        demographics: {
          race: "other",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }).success
    ).toBe(true);
    expect(
      createPartySchema.safeParse({
        name: "Progressive Ass Party",
        abbreviation: "PAP",
        color: "#ff0000",
        economicPosition: 0,
        socialPosition: 0,
      }).success
    ).toBe(true);
    expect(
      foundCorporationSchema.safeParse({
        name: "Dick Industries",
        tickerSymbol: "DCK",
        type: "healthcare",
      }).success
    ).toBe(true);
    expect(setSectorDisplayNameSchema.safeParse({ displayName: "Main Office" }).success).toBe(true);
    expect(setSectorDisplayNameSchema.safeParse({ displayName: "" }).success).toBe(true);
    expect(setSectorDisplayNameSchema.safeParse({ displayName: null }).success).toBe(true);
  });

  it("rejects blocked language", () => {
    expect(characterNameSchema.safeParse({ name: "Fuck" }).success).toBe(false);
    expect(
      createCharacterSchema.safeParse({
        name: "Rape Squad",
        homeState: "CA",
        countryId: "US",
        policies: { economic: 0, social: 0 },
        demographics: {
          race: "other",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }).success
    ).toBe(false);
    expect(
      createPartySchema.safeParse({
        name: "Faggot Friends",
        abbreviation: "FFF",
        color: "#ff0000",
        economicPosition: 0,
        socialPosition: 0,
      }).success
    ).toBe(false);
    expect(
      foundCorporationSchema.safeParse({
        name: "Nigger Labs",
        tickerSymbol: "NLAB",
        type: "healthcare",
      }).success
    ).toBe(false);
    expect(setSectorDisplayNameSchema.safeParse({ displayName: "Fuck Zone" }).success).toBe(false);
  });
});
