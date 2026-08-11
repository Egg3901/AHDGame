import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { isImfBoardMember } from "../isImfBoardMember";

describe("isImfBoardMember", () => {
  it("returns true when characterId matches a shareholder's characterId", () => {
    const charId = new ObjectId();
    expect(
      isImfBoardMember({
        imfCorpShareholders: [{ characterId: charId, shares: 50 }],
        characterId: charId,
      })
    ).toBe(true);
  });

  it("returns false when no shareholder matches", () => {
    expect(
      isImfBoardMember({
        imfCorpShareholders: [{ characterId: new ObjectId(), shares: 50 }],
        characterId: new ObjectId(),
      })
    ).toBe(false);
  });

  it("returns false when shareholders list is empty", () => {
    expect(
      isImfBoardMember({
        imfCorpShareholders: [],
        characterId: new ObjectId(),
      })
    ).toBe(false);
  });

  it("ignores corporation shareholders (only character shareholders form the Board)", () => {
    const charId = new ObjectId();
    expect(
      isImfBoardMember({
        imfCorpShareholders: [{ corporationId: charId, shares: 100 }],
        characterId: charId,
      })
    ).toBe(false);
  });
});
