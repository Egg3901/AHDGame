/**
 * Ticket #1189 — "no bill option to change from independent redistricting to
 * partisan redistricting".
 *
 * The three levers in caps.ts are only levers if a player can legislate them.
 * That needs four things to line up at once, across four files that no other
 * test reads together:
 *   1. the type survives the old-catalog exclusion sweep (pipelinePreset),
 *   2. it is state-scoped, so `scope=state` in /api/game/legislation-types
 *      returns it,
 *   3. its policyDomain maps to a category the state Propose Bill modal offers,
 *   4. the era catalog leaves it active.
 * Break any one and the law silently disappears from the picker with nothing
 * failing — which is exactly how it went missing.
 */
import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { isOldLegislationTypeExcluded } from "@/lib/politicalMetrics/pipelinePreset";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { CATEGORY_TO_POLICY_DOMAINS, STATE_BILL_CATEGORIES } from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import {
  REDISTRICT_AUTHORITY_LAW,
  REDISTRICT_COMPACTNESS_LAW,
  REDISTRICT_FAIRNESS_LAW,
} from "./caps";

const LEVERS = [REDISTRICT_AUTHORITY_LAW, REDISTRICT_COMPACTNESS_LAW, REDISTRICT_FAIRNESS_LAW];

describe.each(LEVERS)("%s is proposable as a US state bill", (lawId) => {
  const lt = legislationTypes.find((t) => t._id === lawId);

  it("exists in the reference catalog and survives the old-catalog exclusion sweep", () => {
    expect(lt).toBeDefined();
    expect(isOldLegislationTypeExcluded(lt!)).toBe(false);
  });

  it("is state-scoped for the US", () => {
    expect(lt!.countryScope).toBe("us");
    expect(lt!.allowedScope).toBe("state");
  });

  it("maps to a category the state Propose Bill modal offers", () => {
    const categories = (STATE_BILL_CATEGORIES as readonly string[]).filter((c) =>
      (CATEGORY_TO_POLICY_DOMAINS[c as BillCategory] ?? []).includes(lt!.policyDomain)
    );
    expect(categories.length).toBeGreaterThan(0);
  });

  it("is era-active across the playable presets", () => {
    for (const year of [1953, 1960, 1979, 1991, 2019]) {
      expect(isLegislationTypeActive(lawId, year), String(year)).toBe(true);
    }
  });
});

describe("the redistricting authority ladder", () => {
  it("offers a legislature-drawn option, so a state can leave commission control", () => {
    const lt = legislationTypes.find((t) => t._id === REDISTRICT_AUTHORITY_LAW)!;
    // caps.ts AUTHORITY_TABLE is indexed positionally: 0 independent (cannot
    // draw, auto-neutralizes), 1 bipartisan (cannot draw), 2 legislature (may
    // draw). The ladder must stay that length and that order or the enacted
    // option index means something else.
    expect(lt.policyOptions).toHaveLength(3);
    expect(lt.policyOptions![2].name).toMatch(/legislat/i);
  });
});
