/**
 * V1.5 — agenda-driven legislative sponsorship. These tests focus on the new
 * agenda bias: when a governing agenda is supplied, selectNppBill should favor
 * bills that advance high-priority agenda items and pick options in the agenda's
 * direction — while remaining identical to the prior behavior when no agenda is
 * supplied.
 */
import { describe, it, expect } from "vitest";
import type { LegislationType, LegislationPolicyOption, NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "../governingAgenda";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";

function option(over: Partial<LegislationPolicyOption> & { id: string }): LegislationPolicyOption {
  return {
    name: over.id,
    stance: "center",
    effectDirection: 1,
    economic: 0,
    social: 0,
    ...over,
  } as LegislationPolicyOption;
}

function legType(
  id: string,
  policyDomain: string,
  options: LegislationPolicyOption[]
): LegislationType {
  return {
    _id: id,
    name: `Bill ${id}`,
    description: "",
    policyDomain,
    subCategory: "",
    positions: [],
    policyOptions: options,
  } as unknown as LegislationType;
}

// Right-leaning NPP: aligns with economic +5 options, opposes economic -5.
const npp = { policies: { economic: 5, social: 0 } } as NPP;
const noUrgency: ConditionsSignal = { weakDomains: {} };

// A: healthcare bill whose only option is ideologically opposed (platform fit ~0).
// B: environment bill whose option is ideologically aligned (platform fit ~1).
const healthcareBill = legType("a", "healthcare", [
  option({ id: "a_raise", economic: -5, effectDirection: 1 }),
  option({ id: "a_lower", economic: -5, effectDirection: -1 }),
]);
const environmentBill = legType("b", "environment", [option({ id: "b1", economic: 5 })]);

describe("selectNppBill agenda bias (V1.5)", () => {
  it("without an agenda, picks on platform-fit + urgency (environment wins here)", () => {
    const sel = selectNppBill([healthcareBill, environmentBill], npp, noUrgency);
    expect(sel?.legType._id).toBe("b");
  });

  it("with an agenda raising healthcare, the agenda bias flips selection to the healthcare bill", () => {
    const agenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 65, direction: "raise", priority: 0.9 },
    ];
    const sel = selectNppBill([healthcareBill, environmentBill], npp, noUrgency, agenda);
    expect(sel?.legType._id).toBe("a");
    // And it picks the raise-directed option (effectDirection +1).
    expect(sel?.option.id).toBe("a_raise");
  });

  it("an empty agenda behaves exactly like no agenda", () => {
    const withEmpty = selectNppBill([healthcareBill, environmentBill], npp, noUrgency, []);
    const without = selectNppBill([healthcareBill, environmentBill], npp, noUrgency);
    expect(withEmpty?.legType._id).toBe(without?.legType._id);
    expect(withEmpty?.legType._id).toBe("b");
  });
});

describe("selectNppBill fiscal-posture bias (V1.6)", () => {
  // A fiscal/taxation bill with both a tighten (+1) and a loosen (-1) option.
  const taxBill = legType("tax", "taxation", [
    option({ id: "tighten", economic: 0, effectDirection: 1 }),
    option({ id: "loosen", economic: 0, effectDirection: -1 }),
  ]);
  const neutralNpp = { policies: { economic: 0, social: 0 } } as NPP;

  it("an austere stance prefers the tightening option on a fiscal bill", () => {
    const sel = selectNppBill([taxBill], neutralNpp, noUrgency, undefined, {
      direction: 1,
      intensity: 0.8,
    });
    expect(sel?.option.id).toBe("tighten");
  });

  it("an expansionary stance prefers the loosening option", () => {
    const sel = selectNppBill([taxBill], neutralNpp, noUrgency, undefined, {
      direction: -1,
      intensity: 0.8,
    });
    expect(sel?.option.id).toBe("loosen");
  });

  it("a non-fiscal bill is unaffected by the fiscal stance", () => {
    const sel = selectNppBill([environmentBill], npp, noUrgency, undefined, {
      direction: 1,
      intensity: 1,
    });
    // Environment bill still selected on platform-fit; score has no fiscal term.
    expect(sel?.legType._id).toBe("b");
  });
});
