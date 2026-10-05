import type { Db } from "mongodb";
import type { EnactedLaw, FederalBudget, DepartmentProgramState } from "@/lib/db/types/budget";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";
import { clampRatio } from "./rules/implementation";
import { US_HEALTH_DEPARTMENT_ID, US_PUBLIC_HEALTH_PROGRAM_ID } from "./departments";

export const US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID = "us_public_health";
export const US_PUBLIC_HEALTH_POLICY_OPTION_INDEX = 1;
export const US_PUBLIC_HEALTH_POLICY_OPTION_ID = "public_health_opt_1";
export const US_PUBLIC_HEALTH_POLITICAL_LAW_ID = "us.health.prevention.primary";

export type DeliveryMultiplierReason =
  | "feature_disabled"
  | "option_not_migrated"
  | "current_settlement"
  | "missing_settlement"
  | "stale_settlement"
  | "invalid_settlement";

export interface DeliveryMultiplierResolution {
  multiplier: number;
  reason: DeliveryMultiplierReason;
  program?: DepartmentProgramState;
}

export interface DeliveryMultiplierInput {
  enabled: boolean;
  currentTurn: number;
  migratedOptionActive: boolean;
  program?: DepartmentProgramState;
}

/**
 * Resolve the public-health law's delivered share without ambient state.
 *
 * A world that has not selected the migrated option remains on the legacy
 * behavior. Once the option is active, or once its durable program record
 * exists, missing and stale settlements fail closed instead of silently
 * restoring the law's full outcome contribution.
 */
export function resolvePublicHealthDeliveryMultiplier(
  input: DeliveryMultiplierInput
): DeliveryMultiplierResolution {
  if (!input.enabled) return { multiplier: 1, reason: "feature_disabled" };

  const migratedProgram =
    input.program?.legislationTypeId === US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID &&
    input.program.policyOptionId === US_PUBLIC_HEALTH_POLICY_OPTION_ID
      ? input.program
      : undefined;
  if (!migratedProgram && !input.migratedOptionActive) {
    return { multiplier: 1, reason: "option_not_migrated" };
  }
  if (!migratedProgram) return { multiplier: 0, reason: "missing_settlement" };
  if (migratedProgram.lastSettledTurn !== input.currentTurn) {
    return { multiplier: 0, reason: "stale_settlement", program: migratedProgram };
  }
  if (!Number.isFinite(migratedProgram.implementationFactor)) {
    return { multiplier: 0, reason: "invalid_settlement", program: migratedProgram };
  }
  return {
    multiplier: clampRatio(migratedProgram.implementationFactor),
    reason: "current_settlement",
    program: migratedProgram,
  };
}

/** One bounded country-level load for the political-metrics pass and read model. */
export async function loadPublicHealthDeliveryMultiplier(
  db: Db,
  currentTurn: number,
  enabled: boolean
): Promise<DeliveryMultiplierResolution> {
  if (!enabled) {
    return resolvePublicHealthDeliveryMultiplier({
      enabled: false,
      currentTurn,
      migratedOptionActive: false,
    });
  }

  const [budget, activeLaw] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne(
      { countryId: "US" },
      {
        projection: {
          [`departmentAccounts.${US_HEALTH_DEPARTMENT_ID}.programs.${US_PUBLIC_HEALTH_PROGRAM_ID}`]: 1,
        },
      }
    ),
    db.collection<EnactedLaw>("enactedLaws").findOne(
      {
        scope: "national",
        ...nationalLawCountryQuery("US"),
        legislationTypeId: US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID,
        policyOptionIndex: US_PUBLIC_HEALTH_POLICY_OPTION_INDEX,
        repealedAt: { $exists: false },
      },
      { projection: { _id: 1 } }
    ),
  ]);

  return resolvePublicHealthDeliveryMultiplier({
    enabled,
    currentTurn,
    migratedOptionActive: activeLaw !== null,
    program:
      budget?.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID]?.programs[US_PUBLIC_HEALTH_PROGRAM_ID],
  });
}
