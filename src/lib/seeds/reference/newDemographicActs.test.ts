import { describe, expect, it } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { COUNTRY_POLICY_CONFIGS } from "./basePolicies";
import { COUNTRY_POLICY_CONFIGS_1991 } from "./basePolicies1991";

/**
 * §4.6 new-act gaps: US Paid Family Leave, UK Childcare, JP Pension. Each fills a
 * genuine demographic-legislation hole (verified absent before authoring) and
 * wires a live cohort-engine DRIVER (birthRate / laborParticipation), never a
 * derived readout. BR is deferred to P5 (no BR seeds exist yet).
 */
const byId = (id: string) => legislationTypes.find((lt) => lt._id === id);

const NEW_ACTS = [
  { id: "us_paid_family_leave", scope: "us", country: "us", primary: "birthRate" },
  { id: "uk_childcare", scope: "uk", country: "uk", primary: "birthRate" },
  { id: "jp_pension", scope: "jp", country: "jp", primary: "povertyRate" },
] as const;

describe("§4.6 new demographic acts", () => {
  for (const act of NEW_ACTS) {
    describe(act.id, () => {
      const lt = byId(act.id);

      it("exists with the right country scope", () => {
        expect(lt, `${act.id} missing from corpus`).toBeDefined();
        expect(lt!.countryScope).toBe(act.scope);
      });

      it("has a 7-option left→right spectrum (stance + score agree)", () => {
        const opts = lt!.policyOptions ?? [];
        expect(opts).toHaveLength(7);
        expect(opts[0].stance).toBe("left");
        expect(opts[3].stance).toBe("center");
        expect(opts[6].stance).toBe("right");
        // effectDirection: left +1, center 0, right -1
        expect(opts[0].effectDirection).toBe(1);
        expect(opts[3].effectDirection).toBe(0);
        expect(opts[6].effectDirection).toBe(-1);
      });

      it("targets the live driver as its primary effect, not a derived readout", () => {
        expect(lt!.effectTarget?.metricId).toBe(act.primary);
        // first weighted target is the primary at weight 1.0
        expect(lt!.effectTargetsWeighted?.[0]?.metricId).toBe(act.primary);
        const ids = (lt!.effectTargetsWeighted ?? []).map((w) => w.metricId);
        // never targets a pure-stock derived readout
        for (const banned of [
          "populationGrowth",
          "medianAge",
          "demographicDecline",
          "dependencyRatio",
        ]) {
          expect(ids).not.toContain(banned);
        }
      });

      it("is registered in both the live and 1991 base-policy configs", () => {
        expect(COUNTRY_POLICY_CONFIGS[act.country].defaults).toHaveProperty(act.id);
        expect(COUNTRY_POLICY_CONFIGS_1991[act.country].defaults).toHaveProperty(act.id);
      });
    });
  }

  it("the family/childcare acts wire laborParticipation POSITIVELY (childcare enables work)", () => {
    for (const id of ["us_paid_family_leave", "uk_childcare"]) {
      const lp = byId(id)!.effectTargetsWeighted!.find((w) => w.metricId === "laborParticipation");
      expect(lp, `${id} should wire laborParticipation`).toBeDefined();
      expect(lp!.weight).toBeGreaterThan(0); // childcare raises participation
    }
  });

  it("the JP pension act wires laborParticipation NEGATIVELY (expansion lowers participation)", () => {
    const lp = byId("jp_pension")!.effectTargetsWeighted!.find(
      (w) => w.metricId === "laborParticipation"
    );
    expect(lp, "jp_pension should wire laborParticipation").toBeDefined();
    expect(lp!.weight).toBeLessThan(0); // expanding pensions / lower age cuts participation
  });
});
