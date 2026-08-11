import { describe, it, expect } from "vitest";
import { categoryOf, CATEGORY_OF, PLAYER_FACING_CATEGORIES } from "./categories";
import { NOTIFICATION_TYPES } from "@/lib/db/types/notifications";

describe("categoryOf", () => {
  it("maps representative types to design categories", () => {
    expect(categoryOf("crisis")).toBe("crisis");
    expect(categoryOf("bill_vote_open")).toBe("legislation");
    expect(categoryOf("party_whip_issued")).toBe("legislation");
    expect(categoryOf("general_win")).toBe("election");
    expect(categoryOf("leadership_election_opened")).toBe("election");
    expect(categoryOf("coalition_invite_received")).toBe("party");
    expect(categoryOf("leadership_appointed")).toBe("standing");
    expect(categoryOf("wire_received")).toBe("treasury");
    expect(categoryOf("ceo_vote_offer")).toBe("treasury");
    expect(categoryOf("turn_advance")).toBe("system");
  });

  it("covers every notification type (total map, no undefined)", () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(CATEGORY_OF[t]).toBeDefined();
    }
  });

  it("does not expose system as a player-facing chip", () => {
    expect(PLAYER_FACING_CATEGORIES).toEqual([
      "crisis",
      "legislation",
      "election",
      "party",
      "standing",
      "treasury",
    ]);
  });
});
