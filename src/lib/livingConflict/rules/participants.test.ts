import { describe, expect, it } from "vitest";
import { RUSSIA_UKRAINE_DEF } from "../defs/russiaUkraine";
import type { LivingConflictDef } from "../types";
import { hasRequiredBelligerents, resolveConflictParticipants } from "./participants";

const authored: Pick<LivingConflictDef, "participants" | "participantFallbacks"> = {
  participants: {
    belligerents: ["A", "B"],
    backerA: "C",
    backerB: "D",
    neighbors: ["N"],
    blocMembers: [],
    bystanders: [],
  },
  participantFallbacks: { A: ["C", "X"], B: ["X", "Y"], C: ["X", "Z"], D: ["Z"] },
};

describe("crisis participant identity", () => {
  it("preserves available authored participants", () => {
    expect(resolveConflictParticipants(authored, new Set(["A", "B", "C", "D", "N"]))).toEqual(
      authored.participants
    );
  });

  it("reserves real backers before choosing missing belligerents' fallbacks", () => {
    const participants = resolveConflictParticipants(authored, new Set(["B", "C", "D", "X"]));
    expect(participants.belligerents).toEqual(["X", "B"]);
    expect(participants.backerA).toBe("C");
    expect(participants.backerB).toBe("D");
  });

  it("does not let multiple missing actors consume the same fallback", () => {
    const participants = resolveConflictParticipants(authored, new Set(["X", "Y", "Z"]));
    expect(participants.belligerents).toEqual(["X", "Y"]);
    expect(participants.backerA).toBe("Z");
    expect(participants.backerB).toBeUndefined();
  });

  it("does not reassign Russia to Ukraine's belligerent role", () => {
    const participants = resolveConflictParticipants(
      RUSSIA_UKRAINE_DEF,
      new Set(["RU", "US", "UK", "DE"])
    );
    expect(participants.belligerents).toEqual([]);
    expect(participants.backerA).toBe("RU");
    expect(participants.backerB).toBe("US");
    expect(hasRequiredBelligerents(RUSSIA_UKRAINE_DEF, participants)).toBe(false);
  });

  it("keeps a safe authored fallback distinct from the neighbors it replaces", () => {
    const participants = resolveConflictParticipants(
      RUSSIA_UKRAINE_DEF,
      new Set(["RU", "US", "PL", "UK", "DE"])
    );
    expect(participants.belligerents).toEqual(["PL"]);
    expect(participants.neighbors).not.toContain("PL");
    expect(hasRequiredBelligerents(RUSSIA_UKRAINE_DEF, participants)).toBe(true);
  });

  it("retains intentional role overlap for the same authored identity", () => {
    const participants = resolveConflictParticipants(
      { ...authored, participants: { ...authored.participants, neighbors: ["A"] } },
      new Set(["X", "B", "C", "D"])
    );
    expect(participants.belligerents).toEqual(["X", "B"]);
    expect(participants.neighbors).toEqual(["X"]);
  });

  it("does not mutate definitions or available countries", () => {
    const before = structuredClone(authored);
    const countries = new Set(["X", "Y", "Z"]);
    resolveConflictParticipants(authored, countries);
    expect(authored).toEqual(before);
    expect([...countries]).toEqual(["X", "Y", "Z"]);
  });

  it("allows definitions that intentionally have no belligerents", () => {
    expect(
      hasRequiredBelligerents(
        { participants: { ...authored.participants, belligerents: [] } },
        { belligerents: [] }
      )
    ).toBe(true);
  });
});
