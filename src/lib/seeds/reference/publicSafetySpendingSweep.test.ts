import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 public-safety spending sweep guard (P3b). The whole publicSafety tier is
 * ENGINE-DERIVED (the publicSafety spending channel → policePerCapita capacity →
 * crimeRate → violent/incarceration/recidivism/confidence/UK specials —
 * registry/publicSafety.ts), so a publicSafety-budget FUNDING law that also
 * targets a tier readout directly double-counts — its booked spend already
 * drives the readout via the channel.
 *
 * KEEP-LIST = justice-STRUCTURE mechanisms the channel cannot express
 * (rehabilitation-vs-punishment prison regimes, sentencing philosophy) —
 * justified per entry.
 */
const ENGINE_READOUTS = new Set([
  "policePerCapita",
  "crimeRate",
  "violentCrimeRate",
  "incarcerationRate",
  "recidivismRate",
  "publicSafetyConfidence",
  "antiSocialBehaviourRate",
  "knifeCrimeRate",
]);

const PS_BUDGET_KEYS = new Set(["publicSafety"]);

/**
 * Per-law ALLOWED readouts — mechanisms the channel cannot express, with the
 * allowed metric set pinned so a future edit can't silently widen a keep.
 * Channel overlap on every kept law is acknowledged and NAMED for the balance
 * pass (the P3a transfer-incidence precedent).
 */
const MECHANISM_KEEP_LIST = new Map<string, Set<string>>([
  // #887: policing STANCE carries a direct crimeRate effect (enforcement lowers
  // crime, reform raises it short-term) so the bill visibly and directly moves
  // crime. The police→crime spending channel was trimmed 400→200 in
  // registry/publicSafety.ts to compensate, so there is no net double-count —
  // the stance tick now does the work the invisible funding channel used to.
  ["uk_policing_crime", new Set(["crimeRate"])],
  ["uk_regional_policing", new Set(["crimeRate"])],
  // Justice-STRUCTURE: the prison REGIME (rehabilitation vs punishment,
  // sentencing philosophy) chooses what incarceration DOES, not how much is
  // spent.
  ["uk_prison_rehabilitation", new Set(["incarcerationRate", "recidivismRate", "crimeRate"])],
  // Justice-STRUCTURE: death penalty / daiyo kangoku sentencing regime
  // (primary re-pointed crimeRate → incarcerationRate in the P3b sweep).
  ["jp_criminal_justice", new Set(["incarcerationRate"])],
  // Justice-STRUCTURE: 严打 (strike-hard) campaign scope and sentencing
  // severity — a doctrine, not a budget level.
  ["cn_criminal_justice", new Set(["incarcerationRate", "crimeRate", "violentCrimeRate"])],
  // SURVEILLANCE-MANDATE structure: 公安 framework direction (facial
  // recognition, social-credit integration); its own explanation notes
  // operational delivery is funded separately (cn_provincial_public_security).
  ["cn_public_security", new Set(["publicSafetyConfidence", "crimeRate"])],
  // SUB-ALLOCATION: youth offending teams / domestic-violence services /
  // community-safety partnerships — WHO the justice money serves; recidivism
  // is not a publicSafety-channel readout path (it runs off the social channel
  // + incarceration).
  [
    "uk_regional_justice",
    new Set(["recidivismRate", "antiSocialBehaviourRate", "publicSafetyConfidence"]),
  ],
  // SUB-ALLOCATION: fire/rescue/ambulance — non-police capacity the channel's
  // police-capacity path can't express (its crimeRate secondary was dropped).
  ["uk_regional_emergency_services", new Set(["publicSafetyConfidence"])],
]);

function tierHits(lt: LegislationType): string[] {
  const allowed = MECHANISM_KEEP_LIST.get(lt._id);
  const hits: string[] = [];
  const isViolation = (cat: string, id: string) =>
    cat === "publicSafety" && ENGINE_READOUTS.has(id) && !allowed?.has(id);
  if (lt.effectTarget && isViolation(lt.effectTarget.metricCategoryId, lt.effectTarget.metricId)) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (isViolation(w.metricCategoryId, w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (isViolation(e.category, e.metricId)) hits.push(`option tick ${e.metricId}`);
    }
  }
  return hits;
}

describe("§4.7 public safety spending sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no publicSafety-budget FUNDING law targets a tier readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (!lt.budgetCategory || !PS_BUDGET_KEYS.has(lt.budgetCategory)) continue;
      for (const hit of tierHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `tier double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
