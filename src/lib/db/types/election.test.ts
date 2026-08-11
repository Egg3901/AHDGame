import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "./election";

describe("Election Type", () => {
  it("should require countryId field", () => {
    // Valid election with countryId
    const validElection: Election = {
      _id: new ObjectId(),
      countryId: "US",
      electionType: "house",
      state: "CA",
      cycle: 2026,
      status: "upcoming",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(validElection.countryId).toBe("US");
  });
});
