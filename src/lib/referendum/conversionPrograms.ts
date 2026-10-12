/** Boundary changes preserve enacted regional law choices and each successor's funded national programs. */
import type { Db } from "mongodb";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import type { State } from "@/lib/db/types/state";
import { planConvertedLawPrograms } from "./rules/conversionPrograms";

export async function convertLawPrograms(
  db: Db,
  input: { regionId: string; countryId: ResetCountry; scale?: number; independent?: boolean }
) {
  const { regionId, countryId, scale = 1, independent = false } = input;
  const programs = await db
    .collection<ResetLawProgramDocument>("resetLawPrograms")
    .find({
      country: "UK",
      $or: [{ regionId }, ...(independent ? [{ scope: "national" as const }] : [])],
    })
    .toArray();
  if (!programs.length) return;
  const regions = await db
    .collection<State>("states")
    .find(independent ? { countryId } : { _id: regionId }, {
      projection: { _id: 1, population: 1, gdp: 1 },
    })
    .toArray();
  const rump = independent
    ? await db
        .collection<State>("states")
        .find({ countryId: "UK" }, { projection: { gdp: 1 } })
        .toArray()
    : [];
  const accounts = await db
    .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
    .find({ countryId })
    .toArray();
  const { updates, removals } = planConvertedLawPrograms({
    programs,
    accounts,
    regions,
    rump,
    countryId,
    independent,
    scale,
  });
  if (updates.length)
    await db.collection<ResetLawProgramDocument>("resetLawPrograms").bulkWrite(updates);
  if (removals.length)
    await db
      .collection<ResetLawProgramDocument>("resetLawPrograms")
      .deleteMany({ _id: { $in: removals } });
}
