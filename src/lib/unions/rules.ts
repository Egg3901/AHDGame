/**
 * Union services run while a leader can fund them for represented members.
 * fundedUnionServices includes current dues income and uses the same service
 * bill as the union turn to decide which selected programmes take effect.
 */
import {
  averageAnnualWage,
  duesIncomePerTurn,
  maxDuesForWage,
  servicesCostPerTurn,
  unionMembers,
  type UnionMemberSector,
} from "./unionDues";
import { normalizeServiceIds, type UnionServiceId } from "./unionServices";

export function fundedUnionServices(
  union: {
    ownerId: string | null;
    suspended?: boolean;
    treasury: number;
    duesPerWorkerAnnual?: number;
    activeServices?: readonly string[];
  },
  sectors: readonly UnionMemberSector[]
): UnionServiceId[] {
  if (!union.ownerId || union.suspended) return [];
  const services = normalizeServiceIds(union.activeServices);
  const members = unionMembers(sectors);
  const annualWage = averageAnnualWage(sectors);
  if (members <= 0 || annualWage <= 0) return [];
  const duesRate = Math.min(
    Math.max(0, union.duesPerWorkerAnnual ?? 0),
    maxDuesForWage(annualWage)
  );
  const available = union.treasury + duesIncomePerTurn(members, duesRate);
  return servicesCostPerTurn(members, annualWage, services) <= available ? services : [];
}
