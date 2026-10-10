import { describe, expect, it } from "vitest";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { resetCabinetActions, resetActionsForSeat } from "./catalog";
import { actionSecondaryTarget, actionSecondaryTargets } from "./secondaryTargets";

describe("reset Cabinet action catalog", () => {
  it("has distinct, described order slots with no national concurrency gate", () => {
    expect(resetCabinetActions.length).toBeGreaterThan(172);
    expect(new Set(resetCabinetActions.map((action) => action.id)).size).toBe(
      resetCabinetActions.length
    );
    for (const action of resetCabinetActions) {
      expect(action.brief.trim()).not.toBe("");
      expect(action.description.trim()).not.toBe("");
      expect(action.description).not.toMatch(/[\u2013\u2014]/);
      expect(action.strength).toBeGreaterThan(0);
      expect(action.strength).toBeLessThanOrEqual(0.2);
      expect(action.slot).toBeGreaterThanOrEqual(1);
      expect(action.slot).toBeLessThanOrEqual(3);
    }
  });

  it("targets real primaries or explicit secondary drivers", () => {
    const derivedOnly = new Set(["08", "10", "20", "54", "55", "56"]);
    for (const action of resetCabinetActions) {
      const targets = action.target.split("+");
      expect(targets.length).toBeLessThanOrEqual(2);
      for (const target of targets) {
        if (target.startsWith("M")) {
          expect(primaryMetricById(target.slice(1)), action.id).toBeDefined();
          expect(derivedOnly.has(target.slice(1)), action.id).toBe(false);
        } else expect(actionSecondaryTarget(target), action.id).toBeDefined();
      }
    }
    for (const target of actionSecondaryTargets) {
      for (const id of target.potentialDownstreamPrimaries) {
        expect(primaryMetricById(id), target.id).toBeDefined();
      }
      expect(target.description).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("maps two orders to every 1991-active authored office", () => {
    for (const country of ["US", "UK", "JP", "IE", "SCO", "WAL"] as const) {
      const roster = getCabinetPositions(country);
      for (const action of resetCabinetActions.filter((row) => row.country === country)) {
        expect(
          roster.some((seat) => seat.id === action.seatId),
          action.id
        ).toBe(true);
      }
      for (const seat of roster.filter((position) => isSeatActive(position, 1991))) {
        const rows = resetActionsForSeat(country, seat.id);
        expect(rows.length, `${country}:${seat.id}`).toBeGreaterThanOrEqual(2);
        expect(
          rows.some((action) => action.costClass === "Staff"),
          `${country}:${seat.id}`
        ).toBe(true);
      }
    }
  });
});
