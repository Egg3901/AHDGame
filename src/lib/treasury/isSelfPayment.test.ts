import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { isSelfPayment } from "./isSelfPayment";

describe("isSelfPayment", () => {
  it("is true when the recipient is the acting character", () => {
    const characterId = new ObjectId();
    expect(
      isSelfPayment(
        { _id: characterId, userId: new ObjectId() },
        { characterId, userId: new ObjectId().toString() }
      )
    ).toBe(true);
  });

  it("is true for a different character owned by the same account", () => {
    // No unique index stops one account holding a second character in the
    // same party, and a character-only check would miss the alt.
    const userId = new ObjectId();
    expect(
      isSelfPayment(
        { _id: new ObjectId(), userId },
        { characterId: new ObjectId(), userId: userId.toString() }
      )
    ).toBe(true);
  });

  it("is false for a genuinely different player", () => {
    expect(
      isSelfPayment(
        { _id: new ObjectId(), userId: new ObjectId() },
        { characterId: new ObjectId(), userId: new ObjectId().toString() }
      )
    ).toBe(false);
  });

  it("is false for an NPP recipient with no owning account", () => {
    // Must not match undefined against undefined and block every NPP payout.
    expect(
      isSelfPayment(
        { _id: new ObjectId(), userId: undefined as never },
        {
          characterId: new ObjectId(),
          userId: undefined,
        }
      )
    ).toBe(false);
  });

  it("is false when the actor has no account id", () => {
    expect(
      isSelfPayment(
        { _id: new ObjectId(), userId: new ObjectId() },
        {
          characterId: new ObjectId(),
          userId: null,
        }
      )
    ).toBe(false);
  });
});
