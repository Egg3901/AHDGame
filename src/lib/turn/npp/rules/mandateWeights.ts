/**
 * Native Assembly NPC profiles vote for every separately seated mandate.
 * aggregateNppMandateWeights sums bound individual rows within each vote field,
 * deduplicating physical identities and retaining legacy single-row weights.
 */
import type { BillVoteField } from "@/lib/congress/billVoteField";
export function russianAssemblyIndividualMandate(input: {
  id: string;
  countryId: string;
  officeType: string;
  seatId?: string;
}) {
  return input.countryId === "RU" &&
    ((input.officeType === "dumaDeputy" && input.seatId?.startsWith("RU-duma-")) ||
      (input.officeType === "federationCouncilMember" && input.seatId?.startsWith("RU-council-")))
    ? input.id
    : undefined;
}
export function aggregateNppMandateWeights(
  countryId: string,
  offices: readonly {
    ownerId: string;
    countryId: string;
    field: BillVoteField;
    seatsHeld: number;
    individualMandateId?: string;
  }[]
) {
  const groups = new Map<
    BillVoteField,
    Map<string, { legacy?: number; individuals: Map<string, number> }>
  >();
  for (const row of offices) {
    if (row.countryId !== countryId) continue;
    if (!row.ownerId || !Number.isSafeInteger(row.seatsHeld) || row.seatsHeld < 0)
      throw new Error("NPC mandate weights require safe seated identities");
    const field: Map<string, { legacy?: number; individuals: Map<string, number> }> =
      groups.get(row.field) ?? new Map();
    const owner = field.get(row.ownerId) ?? { individuals: new Map<string, number>() };
    if (row.individualMandateId) {
      const old = owner.individuals.get(row.individualMandateId);
      if (old != null && old !== row.seatsHeld)
        throw new Error("NPC individual mandate weight changed");
      owner.individuals.set(row.individualMandateId, row.seatsHeld);
    } else owner.legacy ??= row.seatsHeld;
    field.set(row.ownerId, owner);
    groups.set(row.field, field);
  }
  const weights = new Map<BillVoteField, Map<string, number>>();
  for (const [field, owners] of groups) {
    const totals = new Map<string, number>();
    for (const [id, owner] of owners) {
      const sum = owner.individuals.size
        ? [...owner.individuals.values()].reduce((total, count) => total + count, 0)
        : (owner.legacy ?? 0);
      if (!Number.isSafeInteger(sum)) throw new Error("NPC mandate weight exceeds precision");
      totals.set(id, sum);
    }
    weights.set(field, totals);
  }
  return weights;
}
