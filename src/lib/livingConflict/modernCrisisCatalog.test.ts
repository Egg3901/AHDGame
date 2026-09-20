import { describe, expect, it } from "vitest";
import { ARAB_UPRISINGS_DEF } from "./defs/arabUprisings";
import { GLOBAL_FINANCIAL_CRISIS_DEF } from "./defs/globalFinancialCrisis";
import { NORTHERN_IRELAND_DEF } from "./defs/northernIreland";
import { PANDEMIC_DEF } from "./defs/pandemic";
import { RUSSIA_UKRAINE_DEF } from "./defs/russiaUkraine";
import { TRANSNATIONAL_TERRORISM_DEF } from "./defs/transnationalTerrorism";
import { YUGOSLAVIA_DEF } from "./defs/yugoslavia";

const MODERN_CRISIS_DEFS = [
  NORTHERN_IRELAND_DEF,
  YUGOSLAVIA_DEF,
  TRANSNATIONAL_TERRORISM_DEF,
  GLOBAL_FINANCIAL_CRISIS_DEF,
  ARAB_UPRISINGS_DEF,
  PANDEMIC_DEF,
  RUSSIA_UKRAINE_DEF,
];

describe("modern crisis catalog contract", () => {
  it.each(MODERN_CRISIS_DEFS)("$key uses the negotiated-crisis authoring contract", (def) => {
    expect(Object.keys(def.tracks ?? {})).not.toHaveLength(0);
    expect(def.transitions).not.toHaveLength(0);
    expect(def.scheduledPressures).not.toHaveLength(0);
    expect(def.phases.every((phase) => phase.advancePressure >= 100)).toBe(true);
    expect(
      def.phases.some(
        (phase) =>
          Object.keys(phase.decisionTrees).length > 0 ||
          phase.events.some(
            (event) => event.response !== undefined || event.negotiation !== undefined
          )
      )
    ).toBe(true);
  });

  it.each(MODERN_CRISIS_DEFS.filter((def) => def.key !== "pandemic"))(
    "$key supplies alternate-world participant fallbacks",
    (def) => {
      expect(Object.keys(def.participantFallbacks ?? {})).not.toHaveLength(0);
    }
  );

  it("keeps opening windows ordered from reset day through the pandemic era", () => {
    expect(
      MODERN_CRISIS_DEFS.map((def) => def.fromYear).sort((a, b) => (a ?? 0) - (b ?? 0))
    ).toEqual([1991, 1991, 1998, 2007, 2010, 2013, 2018]);
  });
});
