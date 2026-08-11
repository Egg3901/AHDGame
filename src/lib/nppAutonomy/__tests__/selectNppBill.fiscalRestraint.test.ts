/**
 * Fiscal-restraint guardrails (2026-08-06 release-candidate audit):
 *
 *  1. Enacted-rung ceiling: "restraint" may only ever move DOWN the cost
 *     ladder. Without it, a barely-austere government already on its cheapest
 *     rung got a bill proposed that RAISED spending back toward the middle
 *     rung (round(centerIdx * (1 - intensity)) picks an absolute rung and
 *     never looked at the enacted one).
 *  2. Hold suppresses the agenda fallback: when the enacted rung is already
 *     at/below the desired one, the ladder is skipped entirely. Falling
 *     through to the agenda would let its "raise" pull re-ratchet the exact
 *     spending the stance exists to pull back.
 *  3. Crisis standdown: an active crisis on the domain outranks debt distress
 *     (governingAgenda's contract), so restraint yields to the crisis item.
 *  4. Per-ladder cost units: ranking uses ONE cost field for the whole
 *     ladder, so a 0.02 gdpCostFraction never sorts against a 500
 *     annualCostPerCapita.
 */
import { describe, expect, it } from "vitest";
import type { LegislationPolicyOption, LegislationType, NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "../governingAgenda";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";

const noUrgency: ConditionsSignal = { weakDomains: {} };
const npp = { policies: { economic: 0, social: 0 } } as NPP;
const austere = (intensity: number) => ({ direction: 1 as const, intensity });

function costedLadder(
  costs: Array<Partial<LegislationPolicyOption>>,
  id = "sim_health"
): LegislationType {
  const options: LegislationPolicyOption[] = costs.map((extra, i) => ({
    id: `r${i}`,
    name: `Rung ${i}`,
    stance: i < 2 ? "right" : i === 2 ? "center" : "left",
    effectDirection: i < 2 ? -1 : i === 2 ? 0 : 1,
    economic: 2 - i,
    social: 0,
    ...extra,
  }));
  return {
    _id: id,
    name: "Ladder",
    description: "",
    policyDomain: "healthcare",
    subCategory: "",
    positions: [],
    policyOptions: options,
  } as unknown as LegislationType;
}

const fiveRungs = () =>
  costedLadder([
    { gdpCostFraction: 0.01 },
    { gdpCostFraction: 0.02 },
    { gdpCostFraction: 0.03 },
    { gdpCostFraction: 0.04 },
    { gdpCostFraction: 0.05 },
  ]);

describe("fiscal restraint enacted-rung ceiling", () => {
  it("keeps the interpolated pick when it is cheaper than the enacted rung", () => {
    const enacted = new Map([["sim_health", "r3"]]);
    const selection = selectNppBill([fiveRungs()], npp, noUrgency, [], austere(0.5), enacted);
    expect(selection).not.toBeNull();
    // centerIdx 2, intensity 0.5 => rung index 1, below the enacted r3.
    expect(selection!.option.id).toBe("r1");
  });

  it("never proposes a rung above the enacted one (barely-austere on the cheapest rung)", () => {
    // Old behavior: intensity 0.3 => round(2 * 0.7) = rung r1, a spending
    // RAISE from the enacted cheapest rung r0. Must now produce no bill.
    const enacted = new Map([["sim_health", "r0"]]);
    const selection = selectNppBill([fiveRungs()], npp, noUrgency, [], austere(0.3), enacted);
    expect(selection).toBeNull();
  });

  it("holds rather than letting the agenda re-raise the ladder", () => {
    const enacted = new Map([["sim_health", "r0"]]);
    const raiseAgenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 70, direction: "raise", priority: 1 },
    ];
    const selection = selectNppBill(
      [fiveRungs()],
      npp,
      noUrgency,
      raiseAgenda,
      austere(0.3),
      enacted
    );
    expect(selection).toBeNull();
  });

  it("falls back to the plain interpolated pick when the enacted rung is unknown", () => {
    const selection = selectNppBill([fiveRungs()], npp, noUrgency, [], austere(1), new Map());
    expect(selection).not.toBeNull();
    expect(selection!.option.id).toBe("r0");
  });
});

describe("fiscal restraint crisis standdown", () => {
  it("yields to a crisis agenda item instead of starving the crisis domain", () => {
    const enacted = new Map([["sim_health", "r2"]]);
    const crisisAgenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 70, direction: "raise", priority: 1, crisis: true },
    ];
    const selection = selectNppBill(
      [fiveRungs()],
      npp,
      noUrgency,
      crisisAgenda,
      austere(1),
      enacted
    );
    // The agenda's raise item directs the pick; restraint would have chosen r0.
    expect(selection).not.toBeNull();
    expect(selection!.option.effectDirection).toBe(1);
  });
});

describe("fiscal restraint cost-unit consistency", () => {
  it("ranks the whole ladder on one cost field even when options mix fields", () => {
    // gdpCostFraction is the ladder's chosen field (first preference with any
    // author); the annualCostPerCapita: 500 on r1 must NOT rank it priciest.
    const mixed = costedLadder([
      { gdpCostFraction: 0.05 },
      { annualCostPerCapita: 500 },
      { gdpCostFraction: 0.02 },
      { gdpCostFraction: 0.03 },
      { gdpCostFraction: 0.04 },
    ]);
    const selection = selectNppBill([mixed], npp, noUrgency, [], austere(1), new Map());
    expect(selection).not.toBeNull();
    // On the gdpCostFraction scale r1 reads 0, the ladder's cheapest rung.
    expect(selection!.option.id).toBe("r1");
  });
});
