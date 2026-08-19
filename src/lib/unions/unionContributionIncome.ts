/**
 * Projected per-turn political-contribution income for one organizer.
 *
 * Same math the unions turn uses: remaining budget × the union's rate,
 * split by banked strength. Used by the profile and status-bar income
 * breakdown so the number a player sees is the number that will credit.
 */

import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { CorporateSector, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import {
  averageAnnualWage,
  duesIncomePerTurn,
  maxDuesForWage,
  servicesCostPerTurn,
  unionMembers,
} from "./unionDues";
import { normalizeServiceIds } from "./unionServices";
import {
  clampPoliticalContributionPct,
  distributePoliticalContributions,
  freeCashFlowPerTurn,
  politicalContributionPerTurn,
} from "./unionPoliticalContributions";

export async function unionContributionIncomePerTurn(
  db: Db,
  characterId: ObjectId
): Promise<number> {
  const mine = await db
    .collection<UnionOrganizer>("unionOrganizers")
    .find({ characterId, strength: { $gt: 0 } }, { projection: { unionId: 1, strength: 1 } })
    .toArray();
  if (mine.length === 0) return 0;

  const unionIds = mine.map((row) => row.unionId);
  const unions = await db
    .collection<Union>("unions")
    .find(
      {
        _id: { $in: unionIds },
        suspended: { $ne: true },
        politicalContributionPct: { $gt: 0 },
      },
      {
        projection: {
          treasury: 1,
          duesPerWorkerAnnual: 1,
          activeServices: 1,
          politicalContributionPct: 1,
        },
      }
    )
    .toArray();
  if (unions.length === 0) return 0;

  const payingUnionIds = unions.map((u) => u._id);
  const [organizers, sectors] = await Promise.all([
    db
      .collection<UnionOrganizer>("unionOrganizers")
      .find(
        { unionId: { $in: payingUnionIds }, strength: { $gt: 0 } },
        { projection: { unionId: 1, characterId: 1, strength: 1 } }
      )
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { representingUnionId: { $in: payingUnionIds } },
        { projection: { representingUnionId: 1, workers: 1, unionization: 1, wagePerWorker: 1 } }
      )
      .toArray(),
  ]);

  const organizersByUnion = new Map<string, UnionOrganizer[]>();
  for (const organizer of organizers) {
    const key = organizer.unionId.toString();
    const list = organizersByUnion.get(key);
    if (list) list.push(organizer);
    else organizersByUnion.set(key, [organizer]);
  }
  const sectorsByUnion = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const key = sector.representingUnionId!.toString();
    const list = sectorsByUnion.get(key);
    if (list) list.push(sector);
    else sectorsByUnion.set(key, [sector]);
  }

  const me = characterId.toString();
  let total = 0;
  for (const union of unions) {
    const unionSectors = sectorsByUnion.get(union._id.toString()) ?? [];
    const members = unionMembers(unionSectors);
    const annualWage = averageAnnualWage(unionSectors);
    const duesRate = Math.min(
      Math.max(0, union.duesPerWorkerAnnual ?? 0),
      maxDuesForWage(annualWage)
    );
    const activeServices = normalizeServiceIds(union.activeServices);
    const duesIncome = duesIncomePerTurn(members, duesRate);
    const fullServicesCost = servicesCostPerTurn(members, annualWage, activeServices);
    const servicesLapsed = fullServicesCost > (union.treasury ?? 0) + duesIncome;
    const servicesCost = servicesLapsed ? 0 : fullServicesCost;
    const requested = politicalContributionPerTurn(
      freeCashFlowPerTurn(duesIncome, servicesCost),
      clampPoliticalContributionPct(union.politicalContributionPct)
    );
    const payouts = distributePoliticalContributions(
      requested,
      (organizersByUnion.get(union._id.toString()) ?? []).map((organizer) => ({
        characterId: organizer.characterId.toString(),
        strength: organizer.strength ?? 0,
      }))
    );
    total += payouts.find((payout) => payout.characterId === me)?.amount ?? 0;
  }
  return total;
}
