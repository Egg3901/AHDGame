import { describe, it, expect } from "vitest";
import {
  warDamageByCountry,
  warRoadTargetPenalty,
  warRoadExtraDecay,
  WAR_ROAD_TARGET_PENALTY,
  WAR_ROAD_EXTRA_DECAY,
} from "./warDamage";
import type { ConflictDoc } from "@/lib/db/types/conflict";

const conflict = (o: Partial<ConflictDoc>) =>
  ({
    status: "active",
    hostCountry: "DD",
    control: 50,
    controlStart: 50,
    ...o,
  }) as unknown as ConflictDoc;

describe("warDamageByCountry", () => {
  it("damages the ground the war is fought over", () => {
    // Control from 50 to 75 is half the remaining track.
    const m = warDamageByCountry([conflict({ control: 75 })]);
    expect(m.get("DD")?.frontProgress).toBeCloseTo(0.5, 6);
  });

  it("damages every host of a widened war, not just the map anchor", () => {
    // The War for Germany carried both Germanies as hosts. Telling West Germany
    // nothing was happening on its soil was the original error in the banner too.
    const m = warDamageByCountry([
      conflict({ hostCountry: "DD", hostEntities: ["DD", "DE"], control: 100 }),
    ]);
    expect(m.get("DD")?.frontProgress).toBe(1);
    expect(m.get("DE")?.frontProgress).toBe(1);
  });

  it("does not damage an expeditionary belligerent", () => {
    // The US fought the war for Germany and its own roads were not the theatre.
    // Money and men are charged elsewhere: the appropriation and computeWarApproval.
    const m = warDamageByCountry([conflict({ hostCountry: "DD", control: 90 })]);
    expect(m.has("US")).toBe(false);
  });

  it("takes the worst front when two wars are fought on the same soil", () => {
    const m = warDamageByCountry([
      conflict({ hostCountry: "DD", control: 60 }),
      conflict({ hostCountry: "DD", control: 95 }),
    ]);
    expect(m.get("DD")?.frontProgress).toBeCloseTo(0.9, 6);
  });

  it("stops the moment the fighting does", () => {
    const m = warDamageByCountry([conflict({ status: "resolved", control: 100 })]);
    expect(m.size).toBe(0);
  });

  it("does no damage while the front has not moved", () => {
    // A war declared but not yet fought has not wrecked anything.
    expect(warDamageByCountry([conflict({ control: 50 })]).size).toBe(0);
  });

  it("survives a malformed conflict record rather than poisoning the metric", () => {
    // `control` is NaN on a repaired document, and NaN reaching a metric node
    // silently falsifies every comparison downstream. Same class of defect as the
    // startTurn NaN that reached `control` itself.
    const m = warDamageByCountry([
      conflict({ control: NaN }),
      conflict({ hostCountry: "PL", control: undefined as unknown as number }),
    ]);
    expect(m.size).toBe(0);
  });
});

describe("the road terms", () => {
  it("are exactly zero at peace, so a peaceful world is untouched", () => {
    expect(warRoadTargetPenalty(undefined)).toBe(0);
    expect(warRoadExtraDecay(undefined)).toBe(0);
    expect(warRoadTargetPenalty({ frontProgress: 0 })).toBe(0);
    expect(warRoadExtraDecay({ frontProgress: 0 })).toBe(0);
  });

  it("scale with how far the front has moved", () => {
    expect(warRoadTargetPenalty({ frontProgress: 0.5 })).toBeCloseTo(
      WAR_ROAD_TARGET_PENALTY / 2,
      6
    );
    expect(warRoadExtraDecay({ frontProgress: 0.5 })).toBeCloseTo(WAR_ROAD_EXTRA_DECAY / 2, 6);
  });

  it("cap at a fully mobile front", () => {
    expect(warRoadTargetPenalty({ frontProgress: 5 })).toBe(WAR_ROAD_TARGET_PENALTY);
    expect(warRoadExtraDecay({ frontProgress: 5 })).toBe(WAR_ROAD_EXTRA_DECAY);
  });

  it("destroys faster than neglect", () => {
    // The whole reason the decay term exists: maintenance decay is 0.06 a turn, so
    // lowering the floor alone would need ~400 turns to bite and a war runs ~130.
    expect(WAR_ROAD_EXTRA_DECAY).toBeGreaterThan(0.06);
  });
});
