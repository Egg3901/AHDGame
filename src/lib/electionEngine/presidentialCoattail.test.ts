import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  isHeadOfGovernmentRace,
  resolvePresidentApproval,
  buildPresidentialModifierByParty,
  presidentialModifierToPct,
} from "./presidentialCoattail";

describe("isHeadOfGovernmentRace", () => {
  it("is true for the US president race", () => {
    expect(isHeadOfGovernmentRace("president", "US")).toBe(true);
  });

  it("is false for a down-ballot US race", () => {
    expect(isHeadOfGovernmentRace("senate", "US")).toBe(false);
  });

  it("is false for countries with no presidential head-of-government", () => {
    expect(isHeadOfGovernmentRace("president", "UK")).toBe(false);
  });
});

describe("buildPresidentialModifierByParty (approval-based)", () => {
  const inRace = new Set(["2", "3"]);

  it("returns neutral (empty) when no president", () => {
    expect(buildPresidentialModifierByParty(null, inRace).size).toBe(0);
  });

  it("returns neutral when the president's party is not in the race", () => {
    expect(buildPresidentialModifierByParty({ partyId: "9", approval: 75 }, inRace).size).toBe(0);
  });

  it("50% approval → neutral 1.0x", () => {
    expect(
      buildPresidentialModifierByParty({ partyId: "2", approval: 50 }, inRace).get("2")
    ).toBeCloseTo(1.0);
  });

  it("75% approval → +9% ceiling", () => {
    expect(
      buildPresidentialModifierByParty({ partyId: "2", approval: 75 }, inRace).get("2")
    ).toBeCloseTo(1.09);
  });

  it("25% approval → -9% drag", () => {
    expect(
      buildPresidentialModifierByParty({ partyId: "2", approval: 25 }, inRace).get("2")
    ).toBeCloseTo(0.91);
  });
});

describe("presidentialModifierToPct", () => {
  it("converts the multiplier map to signed percentage tilts", () => {
    expect(presidentialModifierToPct(new Map([["2", 1.09]]))["2"]).toBeCloseTo(9, 5);
  });
});

describe("resolvePresidentApproval", () => {
  it("returns the president's party + stored national approval", async () => {
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      party: "2",
      officeType: "president",
      countryId: "US",
    } as never);
    db.collection("governmentApprovals").findOne.mockResolvedValue({
      _id: "US",
      approvalRating: 62,
    } as never);
    const res = await resolvePresidentApproval(db as unknown as Db, "US");
    expect(res).toEqual({ partyId: "2", approval: 62 });
  });

  it("defaults to BASE_APPROVAL (50) when no national approval doc exists", async () => {
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      party: "2",
      officeType: "president",
      countryId: "US",
    } as never);
    db.collection("governmentApprovals").findOne.mockResolvedValue(null as never);
    const res = await resolvePresidentApproval(db as unknown as Db, "US");
    expect(res).toEqual({ partyId: "2", approval: 50 });
  });

  it("returns null when the presidency is vacant", async () => {
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue(null as never);
    const res = await resolvePresidentApproval(db as unknown as Db, "US");
    expect(res).toBeNull();
  });

  it("returns null for a country with no presidential head-of-government", async () => {
    const db = createMockDb();
    const res = await resolvePresidentApproval(db as unknown as Db, "UK");
    expect(res).toBeNull();
  });
});
