import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { canEnterTheatre } from "../rosterGate";

const coldWar = {
  type: "cold_war",
  sideA: { label: "RVN", countries: [], kind: "generated", backer: "west", factionEntity: "SVN" },
  sideB: { label: "DRV", countries: [], kind: "generated", backer: "east", factionEntity: "NVN" },
} as unknown as ConflictDoc;

const interstate = {
  type: "war",
  sideA: { label: "NATO", countries: ["UK"], kind: "coalition", backer: "west" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
} as unknown as ConflictDoc;

describe("cold_war theatre entry", () => {
  it("refuses a bloc member not on a roster", () => {
    // `sideOf` would place the US here by backer, but Part 1 — the bloc vote and the
    // domestic bill — is supposed to be the only way in.
    expect(canEnterTheatre("US", coldWar)).toBe(false);
  });

  it("allows a country already on a roster", () => {
    const joined = {
      ...coldWar,
      sideA: { ...coldWar.sideA, countries: ["US"] },
    } as unknown as ConflictDoc;
    expect(canEnterTheatre("US", joined)).toBe(true);
  });

  it("allows a country on the OTHER roster too", () => {
    const joined = {
      ...coldWar,
      sideB: { ...coldWar.sideB, countries: ["RU"] },
    } as unknown as ConflictDoc;
    expect(canEnterTheatre("RU", joined)).toBe(true);
  });

  it("does NOT narrow an interstate conflict", () => {
    // `sideOf`'s backer fallback is how an ally joins an ongoing war — shipped
    // behaviour with its own rationale. The narrowing must not catch it.
    expect(canEnterTheatre("US", interstate)).toBe(true);
  });
});
