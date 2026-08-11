import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { summarizePlayerWhips } from "./playerWhipSummary";
import type { BillWhip } from "@/lib/db/types";

describe("summarizePlayerWhips", () => {
  const chairId = new ObjectId();
  const viceChairId = new ObjectId();
  const targetId = new ObjectId();
  const issuedAt = new Date("2026-04-25T12:34:56.000Z");

  function makeWhip(
    issuedByCharacterId?: ObjectId,
    issuedByRole?: BillWhip["issuedByRole"]
  ): BillWhip {
    return {
      _id: new ObjectId(),
      targetType: "bill",
      targetId,
      chamber: "house",
      direction: "for",
      issuedBy: "nationalParty",
      countryId: "US",
      partyId: "1",
      issuedByCharacterId,
      issuedByRole,
      audience: "character",
      attemptNumber: 1,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };
  }

  it("marks whips from the chair as chair-issued", () => {
    const [summary] = summarizePlayerWhips([makeWhip(chairId)], { chairId, viceChairId });

    expect(summary.issuerRole).toBe("chair");
    expect(summary.createdAt).toEqual(issuedAt);
  });

  it("marks whips from the vice chair as vice-chair-issued", () => {
    const [summary] = summarizePlayerWhips([makeWhip(viceChairId)], { chairId, viceChairId });

    expect(summary.issuerRole).toBe("viceChair");
  });

  it("falls back to admin for non-leadership issuers", () => {
    const [summary] = summarizePlayerWhips([makeWhip(new ObjectId())], { chairId, viceChairId });

    expect(summary.issuerRole).toBe("admin");
  });

  it("prefers the stored issuer role for historical whips", () => {
    const formerChairId = new ObjectId();
    const [summary] = summarizePlayerWhips([makeWhip(formerChairId, "chair")], {
      chairId,
      viceChairId,
    });

    expect(summary.issuerRole).toBe("chair");
  });
});
