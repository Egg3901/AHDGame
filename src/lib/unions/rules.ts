/**
 * Union services are prepaid during settlement for the following turn.
 * fundedUnionServices prices the selected slate, while paidUnionServices
 * reads the entitlement that all service effects consume for one turn.
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

/** Paid services remain fixed throughout their turn, regardless of later treasury changes. */
export function paidUnionServices(
  union: {
    ownerId: string | null;
    suspended?: boolean;
    serviceReceipts?: readonly { turn: number; services: readonly string[] }[];
  },
  currentTurn: number
): UnionServiceId[] {
  if (!union.ownerId || union.suspended) return [];
  return normalizeServiceIds(
    union.serviceReceipts?.find((receipt) => receipt.turn === currentTurn)?.services
  );
}

/** Keep only this turn's purchase and the following turn's entitlement. */
export function purchaseUnionServices(
  receipts: readonly { turn: number; services: readonly string[] }[] | undefined,
  currentTurn: number,
  services: readonly UnionServiceId[]
): { turn: number; services: UnionServiceId[] }[] {
  const current = receipts?.find((receipt) => receipt.turn === currentTurn);
  return [
    ...(current ? [{ turn: currentTurn, services: normalizeServiceIds(current.services) }] : []),
    { turn: currentTurn + 1, services: [...services] },
  ];
}
