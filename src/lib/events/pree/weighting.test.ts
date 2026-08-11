import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { EventDefinition } from "@/lib/db/types/events";
import type { CharacterEventContext } from "./eligibility";
import { filterEligibleTemplates } from "./weighting";

function ctx(overrides: Partial<CharacterEventContext> = {}): CharacterEventContext {
  return {
    characterId: new ObjectId(),
    countryId: "US",
    isPolitician: false,
    isCeo: false,
    isInElection: false,
    ...overrides,
  };
}

function def(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "pree.test.event",
    status: "approved",
    version: 1,
    title: "Test",
    headline: "Test",
    body: "Test",
    eligibility: ["all"],
    baseWeight: 10,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    options: [{ id: "nothing", label: "Nothing", description: "Nothing.", isDefault: true }],
    defaultOptionId: "nothing",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("filterEligibleTemplates era gating", () => {
  it("filters out a definition before its minYear", () => {
    const defs = [def({ kind: "pree.modern", minYear: 2005 })];
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 1953)).toHaveLength(0);
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 2005)).toHaveLength(1);
  });

  it("filters out a definition after its maxYear", () => {
    const defs = [def({ kind: "pree.fifties", minYear: 1950, maxYear: 1959 })];
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 1955)).toHaveLength(1);
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 1960)).toHaveLength(0);
  });

  it("keeps era-agnostic definitions in any year", () => {
    const defs = [def({ kind: "pree.timeless" })];
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 1953)).toHaveLength(1);
    expect(filterEligibleTemplates(defs, ctx(), null, 100, 2019)).toHaveLength(1);
  });

  it("does not enforce year bounds when currentYear is omitted (back-compat)", () => {
    const defs = [def({ kind: "pree.modern", minYear: 2005 })];
    expect(filterEligibleTemplates(defs, ctx(), null, 100)).toHaveLength(1);
  });
});
