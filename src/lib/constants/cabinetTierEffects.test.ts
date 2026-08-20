import { describe, expect, it } from "vitest";
import { US_CABINET_MECHANICS } from "./usCabinetMechanics";
import { UK_CABINET_MECHANICS } from "./ukCabinetMechanics";
import { CN_CABINET_MECHANICS } from "./cnCabinetMechanics";
import { JP_CABINET_MECHANICS } from "./jpCabinetMechanics";
import { RU_CABINET_MECHANICS } from "./ruCabinetMechanics";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";
import { DE_CABINET_MECHANICS } from "./deCabinetMechanics";
import { NG_CABINET_MECHANICS } from "./ngCabinetMechanics";
import { IE_CABINET_MECHANICS } from "./ieCabinetMechanics";
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { metricCategories } from "@/lib/constants/metricDefinitions";

/**
 * Ticket #1140: the US Secretary of Defense's "Military Readiness" tier shipped with an
 * empty `effects` object on ALL THREE options, so a player could pay a 25% larger defence
 * bill for a setting that wrote to no metric at all. UK, CN and JP defence carried the same
 * hole. This suite is the standing guard: a tier whose every option is empty is a lever the
 * UI offers and the simulation ignores.
 */
const FAMILIES: Record<string, Record<string, CabinetPositionMechanics>> = {
  US: US_CABINET_MECHANICS,
  UK: UK_CABINET_MECHANICS,
  CN: CN_CABINET_MECHANICS,
  JP: JP_CABINET_MECHANICS,
  RU: RU_CABINET_MECHANICS,
  DD: DD_CABINET_MECHANICS,
  DE: DE_CABINET_MECHANICS,
  NG: NG_CABINET_MECHANICS,
  IE: IE_CABINET_MECHANICS,
};

/**
 * National monetary aggregates are routed into the inflation model by
 * processMinisterialOrders rather than into per-region StateMetrics, so they intentionally
 * do not resolve to a StateMetrics path. Same exemption `ruCabinetEffectPaths.test.ts` keeps.
 */
const NATIONAL_ECONOMY_METRICS = new Set(["inflationPressure", "interestRate"]);

/**
 * The UK cabinet keys several effects on `governmentApproval`, which is a derived
 * country-level value in the `governmentApprovals` collection and NOT a StateMetrics
 * field, so those effects write nowhere. Known and OWNER-GATED: repointing six seats at
 * real metrics is a balance decision, not a typo fix. Listed so the guard below stays
 * green while the gap stays visible.
 */
const KNOWN_UNROUTED = new Set(["governmentApproval"]);

const tiersOf = (mech: CabinetPositionMechanics) =>
  [mech.tierSetting, ...(mech.tierSettings ?? [])].filter((t) => t != null);

describe("cabinet tier settings are never inert", () => {
  it("no tier setting has an empty effects object on every option", () => {
    const dead: string[] = [];
    for (const [country, mechs] of Object.entries(FAMILIES)) {
      for (const mech of Object.values(mechs)) {
        for (const tier of tiersOf(mech)) {
          const live = tier.options.filter((o) => Object.keys(o.effects).length > 0);
          if (live.length === 0) {
            dead.push(`${country}/${mech.positionId}/${tier.key ?? "primary"} "${tier.name}"`);
          }
        }
      }
    }
    expect(dead, `tier settings that move no metric: ${dead.join(", ")}`).toEqual([]);
  });

  it("every tier setting keeps at least one neutral and one non-neutral option", () => {
    for (const [country, mechs] of Object.entries(FAMILIES)) {
      for (const mech of Object.values(mechs)) {
        for (const tier of tiersOf(mech)) {
          const label = `${country}/${mech.positionId}/${tier.key ?? "primary"}`;
          const neutral = tier.options.filter((o) => Object.keys(o.effects).length === 0);
          expect(neutral.length, `${label} has no neutral option`).toBeGreaterThanOrEqual(1);
          expect(tier.options.length - neutral.length, label).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("every tier effect key resolves to a real StateMetrics path", () => {
    const valid = new Set(metricCategories.flatMap((c) => c.metrics.map((m) => `${c.id}.${m.id}`)));
    for (const [country, mechs] of Object.entries(FAMILIES)) {
      for (const mech of Object.values(mechs)) {
        const positionMetrics = [...mech.nationalMetrics, ...mech.regionalMetrics];
        for (const tier of tiersOf(mech)) {
          for (const option of tier.options) {
            for (const key of Object.keys(option.effects)) {
              if (NATIONAL_ECONOMY_METRICS.has(key) || KNOWN_UNROUTED.has(key)) continue;
              const path = resolveMetricPath(key, positionMetrics);
              expect(valid.has(path), `${country}/${mech.positionId}/${option.id} → ${path}`).toBe(
                true
              );
            }
          }
        }
      }
    }
  });
});

describe("defence readiness tiers carry a real trade-off", () => {
  const SEATS: Array<[string, string, string]> = [
    ["US", "secretary_of_defense", "publicSafety.publicSafetyConfidence"],
    ["UK", "defence_secretary", "governance.publicTrust"],
    ["CN", "minister_of_defense", "publicSafety.publicSafetyConfidence"],
    ["JP", "defense_minister", "publicSafety.publicSafetyConfidence"],
  ];

  it.each(SEATS)("%s/%s moves %s in opposite directions across the tier", (country, seat, key) => {
    const tier = FAMILIES[country][seat].tierSetting;
    expect(tier).toBeDefined();
    const byId = Object.fromEntries(tier!.options.map((o) => [o.id, o.effects]));
    expect(byId.elevated[key]).toBeGreaterThan(0);
    expect(byId.reduced[key]).toBeLessThan(0);
    expect(byId.standard).toEqual({});
  });

  it("elevated readiness always costs something as well as buying something", () => {
    for (const [country, seat] of SEATS.map(([c, s]) => [c, s])) {
      const elevated = FAMILIES[country][seat].tierSetting!.options.find(
        (o) => o.id === "elevated"
      )!;
      const values = Object.values(elevated.effects);
      expect(
        values.some((v) => v > 0),
        `${country}/${seat}`
      ).toBe(true);
      expect(
        values.some((v) => v < 0),
        `${country}/${seat}`
      ).toBe(true);
    }
  });
});
