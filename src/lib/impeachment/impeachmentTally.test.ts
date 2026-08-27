import { describe, expect, it } from "vitest";
import {
  houseImpeachmentVotesNeeded,
  passesHouseImpeachment,
  passesSenateConviction,
  senateConvictionVotesNeeded,
} from "./impeachmentTally";

describe("passesHouseImpeachment", () => {
  it("does NOT impeach on a 2-0 vote in a full 435-seat chamber (ticket #1173 regression)", () => {
    // Prod doc 6a8a6054849ffcd37a89786b carried the House 2-0 under the old
    // votes-cast bar. Against all seats it must fail.
    expect(passesHouseImpeachment({ for: 2, against: 0, seats: 435 })).toBe(false);
  });

  it("needs a strict majority of all seats", () => {
    expect(passesHouseImpeachment({ for: 217, against: 0, seats: 435 })).toBe(false);
    expect(passesHouseImpeachment({ for: 218, against: 217, seats: 435 })).toBe(true);
    expect(passesHouseImpeachment({ for: 51, against: 0, seats: 100 })).toBe(true);
    expect(passesHouseImpeachment({ for: 50, against: 0, seats: 100 })).toBe(false);
  });

  it("fails when ayes are exactly half the chamber (for * 2 == seats)", () => {
    expect(passesHouseImpeachment({ for: 50, against: 20, seats: 100 })).toBe(false);
    expect(passesHouseImpeachment({ for: 218, against: 0, seats: 436 })).toBe(false);
  });

  it("counts abstentions and never-voted seats against passage", () => {
    // 218 aye of 435 with the rest abstaining or silent is still only 218/435.
    expect(passesHouseImpeachment({ for: 218, against: 0, seats: 435 })).toBe(true);
    expect(passesHouseImpeachment({ for: 217, against: 0, seats: 435 })).toBe(false);
  });

  it("fails an empty chamber", () => {
    expect(passesHouseImpeachment({ for: 0, against: 0, seats: 0 })).toBe(false);
  });
});

describe("passesSenateConviction", () => {
  it("does NOT convict on zero votes cast (ticket #1173 regression)", () => {
    // Prod doc 6a80c184f6e762f349e0718e was acquitted on a 0-0-0 Senate tally
    // under the old votes-cast bar; the new bar must also fail it, on purpose.
    expect(passesSenateConviction({ for: 0, against: 0, seats: 100 })).toBe(false);
    expect(passesSenateConviction({ for: 0, against: 3, seats: 100 })).toBe(false);
  });

  it("needs two-thirds of all seats", () => {
    expect(passesSenateConviction({ for: 66, against: 0, seats: 100 })).toBe(false);
    expect(passesSenateConviction({ for: 67, against: 33, seats: 100 })).toBe(true);
    expect(passesSenateConviction({ for: 289, against: 0, seats: 435 })).toBe(false);
    expect(passesSenateConviction({ for: 290, against: 100, seats: 435 })).toBe(true);
  });

  it("passes when ayes are exactly two-thirds of the chamber (for * 3 == 2 * seats)", () => {
    expect(passesSenateConviction({ for: 200, against: 0, seats: 300 })).toBe(true);
    expect(passesSenateConviction({ for: 2, against: 0, seats: 3 })).toBe(true);
  });

  it("fails an empty chamber", () => {
    expect(passesSenateConviction({ for: 0, against: 0, seats: 0 })).toBe(false);
  });
});

describe("votes-needed helpers", () => {
  it("mirror the bars", () => {
    expect(houseImpeachmentVotesNeeded(435)).toBe(218);
    expect(houseImpeachmentVotesNeeded(100)).toBe(51);
    expect(houseImpeachmentVotesNeeded(2)).toBe(2);
    expect(senateConvictionVotesNeeded(100)).toBe(67);
    expect(senateConvictionVotesNeeded(435)).toBe(290);
    expect(senateConvictionVotesNeeded(3)).toBe(2);
  });
});
