/**
 * Funded union services affect strikes and worker security. loadFundedUnionServices
 * batches represented workplaces and applies fundedUnionServices before these
 * effects reach the corporation turn or the political board.
 */
import type { Db } from "mongodb";
import type { CorporateSector, Union } from "@/lib/db/types";
import type { UnionMemberSector } from "./unionDues";
import type { UnionServiceId } from "./unionServices";
import { fundedUnionServices } from "./rules";

export const UNION_SERVICE_FUNDING_PROJECTION = {
  ownerId: 1,
  suspended: 1,
  treasury: 1,
  duesPerWorkerAnnual: 1,
  activeServices: 1,
} as const;

export async function loadFundedUnionServices(
  db: Db,
  unions: readonly Pick<
    Union,
    "_id" | "ownerId" | "suspended" | "treasury" | "duesPerWorkerAnnual" | "activeServices"
  >[]
): Promise<Map<string, UnionServiceId[]>> {
  const running = unions.filter(
    (union) => union.ownerId && !union.suspended && union.activeServices?.length
  );
  if (running.length === 0) return new Map();
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { representingUnionId: { $in: running.map((union) => union._id) } },
      { projection: { representingUnionId: 1, workers: 1, unionization: 1, wagePerWorker: 1 } }
    )
    .toArray();
  const sectorsByUnion = new Map<string, UnionMemberSector[]>();
  for (const sector of sectors) {
    const key = sector.representingUnionId!.toString();
    const locals = sectorsByUnion.get(key) ?? [];
    locals.push(sector);
    sectorsByUnion.set(key, locals);
  }
  return new Map(
    running.map((union) => [
      union._id.toString(),
      fundedUnionServices(
        { ...union, ownerId: union.ownerId?.toString() ?? null },
        sectorsByUnion.get(union._id.toString()) ?? []
      ),
    ])
  );
}
