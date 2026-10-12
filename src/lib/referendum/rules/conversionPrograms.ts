/** Portable law-program allocation for a boundary conversion. */
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import { largestRemainderAllocate } from "../secede/apportion";
export function planConvertedLawPrograms(input: {
  programs: ResetLawProgramDocument[];
  accounts: ResetDepartmentAccountSnapshot[];
  regions: Array<{ _id: string; gdp: number; population: number }>;
  rump: Array<{ gdp: number }>;
  countryId: ResetCountry;
  independent: boolean;
  scale: number;
}) {
  const { programs, accounts, regions, rump, countryId, independent, scale } = input;
  if (!Number.isFinite(scale) || scale <= 0 || !regions.length)
    throw new Error("Invalid law program conversion");
  const gdp = regions.reduce((sum, region) => sum + region.gdp, 0);
  const weight = independent ? gdp / (gdp + rump.reduce((sum, region) => sum + region.gdp, 0)) : 1;
  const pop = regions.reduce((sum, region) => sum + region.population, 0);
  const weights = Object.fromEntries(
    regions.map((region) => [region._id, region.population / pop])
  );
  if (!(weight > 0 && weight <= 1) || !Number.isFinite(pop) || pop <= 0)
    throw new Error("Invalid program allocation weights");
  const updates: Array<{
    replaceOne: { filter: { _id: string }; replacement: ResetLawProgramDocument; upsert: true };
  }> = [];
  const removals: string[] = [];
  for (const program of programs) {
    if (program.scope === "national") {
      const moved = Math.floor(program.annualAgencyAllocation * weight);
      const account = accounts.find((row) =>
        Object.hasOwn(row.familyAnnualDemand, program.familyId)
      );
      if (!account) throw new Error(`No successor account for law ${program.familyId}`);
      updates.push({
        replaceOne: {
          filter: { _id: program._id },
          replacement: {
            ...program,
            annualAgencyAllocation: program.annualAgencyAllocation - moved,
          },
          upsert: true,
        },
      });
      const next = {
        ...program,
        _id: `${program.worldId}:${countryId}:national:${program.familyId}`,
        country: countryId,
        annualAgencyAllocation: moved,
        fundingAccountId: account._id,
        legalAuthorityId: `${countryId}:national:${program.familyId}`,
        serviceDelivererId: account.departmentId,
      };
      updates.push({ replaceOne: { filter: { _id: next._id }, replacement: next, upsert: true } });
    } else {
      const allocated = largestRemainderAllocate(
        Math.round(program.annualAgencyAllocation * scale),
        weights
      );
      for (const region of regions) {
        const next = {
          ...program,
          _id: `${program.worldId}:${countryId}:${region._id}:${program.familyId}`,
          country: countryId,
          regionId: region._id,
          annualAgencyAllocation: allocated[region._id],
          fundingAccountId: "regional_budget",
          legalAuthorityId: `${countryId}:regional:${program.familyId}`,
          serviceDelivererId: `${countryId}:${region._id}:regional_services`,
        };
        updates.push({
          replaceOne: { filter: { _id: next._id }, replacement: next, upsert: true },
        });
      }
      removals.push(program._id);
    }
  }
  return { updates, removals };
}
