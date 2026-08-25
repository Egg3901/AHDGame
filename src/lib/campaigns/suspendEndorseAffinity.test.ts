import { describe, expect, it } from "vitest";
import { computeCandidateAffinity, computeSuspendTransferFraction } from "./suspendEndorseAffinity";

describe("suspendEndorseAffinity", () => {
  const left = { charEP: -5, charSP: -5, party: "democrat" };
  const right = { charEP: 5, charSP: 5, party: "republican" };
  const centre = { charEP: 0, charSP: 0, party: "democrat" };

  describe("computeCandidateAffinity", () => {
    it("identical candidates score ~1", () => {
      expect(computeCandidateAffinity({ a: left, b: { ...left } })).toBeCloseTo(1, 6);
    });

    it("opposite corners score ~0", () => {
      expect(computeCandidateAffinity({ a: left, b: right })).toBeCloseTo(0, 6);
    });

    it("a centrist is partway between the poles", () => {
      const aff = computeCandidateAffinity({ a: centre, b: left });
      expect(aff).toBeGreaterThan(0);
      expect(aff).toBeLessThan(1);
    });

    it("blends coalition overlap when the bucket substrate carries signal", () => {
      // Two parties with perfectly aligned bucket vectors -> coalition = 1.
      const aligned = new Map<string, number>([
        ["democrat:g1", 10],
        ["democrat:g2", 4],
        ["green:g1", 5],
        ["green:g2", 2],
      ]);
      const a = { charEP: -5, charSP: -5, party: "democrat" };
      const b = { charEP: 5, charSP: 5, party: "green" };
      // Ideological component is 0 (opposite corners); a positive result proves
      // the coalition overlap was blended in.
      const aff = computeCandidateAffinity({ a, b, partyGroupFavorabilityByKey: aligned });
      expect(aff).toBeGreaterThan(0);
    });

    it("opposed bucket vectors drag coalition overlap toward 0", () => {
      const opposed = new Map<string, number>([
        ["democrat:g1", 10],
        ["republican:g1", -10],
      ]);
      const a = { charEP: 0, charSP: 0, party: "democrat" };
      const b = { charEP: 0, charSP: 0, party: "republican" };
      // Identical positions (ideo = 1) but fully opposed coalitions (overlap 0).
      const aff = computeCandidateAffinity({ a, b, partyGroupFavorabilityByKey: opposed });
      expect(aff).toBeLessThan(1);
    });
  });

  describe("computeSuspendTransferFraction", () => {
    it("flat mode returns exactly the ceiling, ignoring alignment", () => {
      expect(
        computeSuspendTransferFraction({
          suspender: left,
          endorsed: right,
          mode: "flat",
          maxFraction: 0.25,
        })
      ).toBe(0.25);
      expect(
        computeSuspendTransferFraction({
          suspender: left,
          endorsed: { ...left },
          mode: "flat",
          maxFraction: 0.25,
        })
      ).toBe(0.25);
    });

    it("affinity mode gives an aligned pair the full ceiling", () => {
      expect(
        computeSuspendTransferFraction({
          suspender: left,
          endorsed: { ...left },
          mode: "affinity",
          maxFraction: 0.25,
        })
      ).toBeCloseTo(0.25, 6);
    });

    it("affinity mode shrinks the transfer for a misaligned pair", () => {
      expect(
        computeSuspendTransferFraction({
          suspender: left,
          endorsed: right,
          mode: "affinity",
          maxFraction: 0.25,
        })
      ).toBeCloseTo(0, 6);
    });
  });
});
