import type { Db } from "mongodb";
import { blockadeClosureByCountry } from "@/lib/navair/blockade";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { NavairUnit } from "@/lib/navair/types";

/**
 * Blockade closure per country for this turn.
 *
 * Returns an empty map when no war is running, so a peacetime world does two cheap
 * indexed reads and nothing else. Kept in the commodity turn (rather than the
 * navair turn pass) because commodity prices resolve earlier in the turn and
 * must not read stale dispositions.
 */
export async function loadBlockadeClosure(db: Db): Promise<Map<string, number>> {
  // Projection passed as a find option rather than via the cursor's .project(), which is
  // this codebase's house style and does not require a cursor implementation of it.
  const conflicts = (await getConflictsCollection(db)
    .find({ status: "active" }, { projection: { "sideA.countries": 1, "sideB.countries": 1 } })
    .toArray()) as unknown as Array<{
    sideA?: { countries?: string[] };
    sideB?: { countries?: string[] };
  }>;
  if (!conflicts.length) return new Map();

  const hostility = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!hostility.has(a)) hostility.set(a, new Set());
    hostility.get(a)!.add(b);
  };
  for (const c of conflicts) {
    for (const a of c.sideA?.countries ?? []) {
      for (const b of c.sideB?.countries ?? []) {
        link(a, b);
        link(b, a);
      }
    }
  }

  const navalUnits = (await getMilitaryUnitsCollection(db)
    .find({ domain: "naval" })
    .toArray()) as unknown as NavairUnit[];
  if (!navalUnits.length) return new Map();

  return blockadeClosureByCountry(navalUnits, hostility);
}
