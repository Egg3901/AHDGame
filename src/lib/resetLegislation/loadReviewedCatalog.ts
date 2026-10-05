/** Database shell for the pure reviewed-option catalog. */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { resetLawFamilies } from "./catalog";
import { fundingSeatForLaw, type ResetCountry } from "./fundingOwner";
import type { ResetLawOpeningBoard } from "./rules/openingBoard";
import { regionalLawLevel } from "./regionalCatalog";
import profiles from "./provisionalBalanceProfiles.json";
import { buildReviewedOptionCatalog, type ReviewedOptionCatalogEntry } from "./rules/reviewCatalog";
import type { ResetLawProgramDocument } from "./program";
import {
  DEPARTMENT_DEFINITIONS,
  resolveDepartmentDefinitionName,
} from "@/lib/governmentFinance/departmentCatalog";

export interface ReviewedLawFamilyCatalog {
  familyId: string;
  title: string;
  domain: string;
  ownerCode: string;
  primaryMetricIds: readonly string[];
  currentLaw: string;
  currentLawDescription: string;
  currentChoice: ReviewedOptionCatalogEntry["currentChoice"];
  overseeingSeatId: string | null;
  overseeingAgencyId: string;
  overseeingAgencyName: string;
  options: ReviewedOptionCatalogEntry[];
}

export async function loadReviewedLawCatalog(input: {
  db: Db;
  worldId: string;
  country: ResetCountry;
  scope: "national" | "regional";
  year: number;
  regionId?: string;
}): Promise<ReviewedLawFamilyCatalog[]> {
  const { db, worldId, country, scope, year, regionId } = input;
  if ((scope === "regional") !== Boolean(regionId)) {
    throw new Error("Regional reviewed catalog needs exactly one region");
  }
  const boardId = scope === "national" ? `${country}:national` : `${country}:${regionId}`;
  const [board, accounts, federalBudget, region, currentPrograms] = await Promise.all([
    db.collection<ResetLawOpeningBoard>("resetLawOpeningBoards").findOne({ _id: boardId, worldId }),
    scope === "national"
      ? db
          .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
          .find(
            { worldId, countryId: country },
            {
              projection: {
                _id: 1,
                countryId: 1,
                departmentId: 1,
                controllingSeatId: 1,
                annualAuthority: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    scope === "national"
      ? db
          .collection<FederalBudget>("federalBudget")
          .findOne({ countryId: country }, { projection: { gdp: 1 } })
      : Promise.resolve(null),
    scope === "regional"
      ? db
          .collection<State>("states")
          .findOne({ _id: regionId!, countryId: country }, { projection: { gdp: 1 } })
      : Promise.resolve(null),
    db
      .collection<ResetLawProgramDocument>("resetLawPrograms")
      .find(
        {
          worldId,
          country,
          scope,
          ...(scope === "regional" ? { regionId } : {}),
        },
        {
          projection: {
            familyId: 1,
            country: 1,
            scope: 1,
            choice: 1,
            annualAgencyAllocation: 1,
            supersededSourceIds: 1,
            titleSnapshot: 1,
            descriptionSnapshot: 1,
          },
        }
      )
      .toArray(),
  ]);
  if (!board) throw new Error("The v2 current-law board is unavailable");
  const resolvedJurisdictionGdp =
    scope === "national" ? federalBudget?.gdp : Math.round((region?.gdp ?? 0) * 1_000_000);
  if (!Number.isSafeInteger(resolvedJurisdictionGdp) || (resolvedJurisdictionGdp ?? 0) <= 0) {
    throw new Error("The v2 jurisdiction GDP is unavailable");
  }
  const jurisdictionGdp = resolvedJurisdictionGdp as number;
  const profileByFamily = new Map(profiles.map((profile) => [profile.familyId, profile]));
  const currentByFamily = new Map(currentPrograms.map((program) => [program.familyId, program]));
  return resetLawFamilies
    .filter((family) => family.availability[scope].includes(country))
    .map((family): ReviewedLawFamilyCatalog => {
      const reference = board.references[family.id];
      const profile = profileByFamily.get(family.id);
      if (!reference || !profile) throw new Error(`Missing reviewed inputs for ${family.id}`);
      const seatId = scope === "national" ? fundingSeatForLaw(family, country) : null;
      const account = seatId
        ? accounts.find((candidate) => candidate.controllingSeatId === seatId)
        : null;
      if (scope === "national" && !account) {
        throw new Error(`Missing v2 funding account for ${country}:${family.id}`);
      }
      const departmentDefinition = account
        ? DEPARTMENT_DEFINITIONS.find(
            (definition) =>
              definition.countryId === country && definition.id === account.departmentId
          )
        : undefined;
      if (account && !departmentDefinition) {
        throw new Error(`Unknown v2 funding department ${country}:${account.departmentId}`);
      }
      const levelText =
        scope === "regional"
          ? Object.fromEntries(
              family.levels.map((level) => {
                const regional = regionalLawLevel(country, family.id, level.position);
                if (!regional) throw new Error(`Missing regional option ${country}:${family.id}`);
                return [level.position, regional];
              })
            )
          : undefined;
      const options = buildReviewedOptionCatalog({
        family,
        reference,
        profile,
        country,
        scope,
        year,
        jurisdictionGdp,
        fundingAccountId: account?._id ?? "regional_budget",
        legalAuthorityId: `${country}:${scope}:${family.id}`,
        serviceDelivererId: account?.departmentId ?? `${country}:${regionId}:regional_services`,
        current: currentByFamily.get(family.id) ?? null,
        ...(levelText ? { levelText } : {}),
      });
      return {
        familyId: family.id,
        title: family.title,
        domain: family.domain,
        ownerCode: family.ownerCode,
        primaryMetricIds: family.primaryMetricIds,
        currentLaw: currentByFamily.get(family.id)?.titleSnapshot ?? reference.currentLaw,
        currentLawDescription:
          currentByFamily.get(family.id)?.descriptionSnapshot ?? reference.legalNote,
        currentChoice: options[0]!.currentChoice,
        overseeingSeatId: seatId,
        overseeingAgencyId: account?.departmentId ?? "regional_budget",
        overseeingAgencyName: departmentDefinition
          ? resolveDepartmentDefinitionName(departmentDefinition, year)
          : "Regional government",
        options,
      };
    });
}
