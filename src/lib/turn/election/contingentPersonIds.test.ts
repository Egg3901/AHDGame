import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  isNppContingentId,
  parseContingentPersonId,
  toCharacterObjectId,
  toNppObjectId,
} from "./contingentPersonIds";

describe("contingentPersonIds", () => {
  it("detects NPP ids", () => {
    expect(isNppContingentId("npp_abc")).toBe(true);
    expect(isNppContingentId("abc")).toBe(false);
  });

  it("parses character and NPP refs", () => {
    const charId = new ObjectId().toString();
    expect(parseContingentPersonId(charId)).toEqual({ kind: "character", characterId: charId });
    expect(parseContingentPersonId("npp_deadbeef")).toEqual({
      kind: "npp",
      nppId: "deadbeef",
    });
  });

  it("converts to ObjectIds", () => {
    const charId = new ObjectId();
    expect(toCharacterObjectId(charId.toString()).equals(charId)).toBe(true);

    const nppId = new ObjectId();
    expect(toNppObjectId(`npp_${nppId.toString()}`).equals(nppId)).toBe(true);
  });

  it("throws on wrong id kind", () => {
    expect(() => toNppObjectId(new ObjectId().toString())).toThrow(/Expected NPP/);
    expect(() => toCharacterObjectId("npp_abc")).toThrow(/Expected character/);
  });
});
