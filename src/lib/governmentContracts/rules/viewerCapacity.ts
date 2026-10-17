import { resolveFillEligibility } from "@/lib/military/defenceFillEligibility";
import {
  defaultFactoryAllocation,
  awardFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import { hasTenderOpportunity } from "./opportunities";
type Opportunity = Parameters<typeof hasTenderOpportunity>[0];
/** Discovery only: current output and uncommitted lines, never an award guarantee. */
export function hasCurrentTenderCapacity(
  input: Omit<Opportunity, "sectors"> & {
    sectors: (Opportunity["sectors"][number] & { id: string })[];
    commitments: ReadonlyMap<string, readonly { assignedFactories?: number }[]>;
  }
): boolean {
  if (input.terms.type === "extraction") return hasTenderOpportunity(input);
  return input.sectors.some((sector) => {
    if (!hasTenderOpportunity({ ...input, sectors: [sector] })) return false;
    const fill = resolveFillEligibility({
      corp: input.corporation,
      sector,
      countryId: input.countryId,
      currentYear: input.year,
      component: input.terms.type === "defence" ? input.terms.component : undefined,
    });
    const fallback = defaultFactoryAllocation(
      fill.components.length,
      DEFENCE_FACTORY_SLOTS_PER_PLANT
    );
    const used = (input.commitments.get(sector.id) ?? []).reduce(
      (sum, c) => sum + Math.max(0, c.assignedFactories ?? fallback),
      0
    );
    const slots = awardFactoryAllocation({
      componentCount: fill.components.length,
      freeSlots: Math.max(0, DEFENCE_FACTORY_SLOTS_PER_PLANT - used),
      stateOwned: input.stateOwned,
    });
    return (
      slots > 0 &&
      resolveFillEligibility({
        corp: input.corporation,
        sector,
        countryId: input.countryId,
        currentYear: input.year,
        component: input.terms.type === "defence" ? input.terms.component : undefined,
        assignedFactories: slots,
      }).projectedLotsPerTurn > 0
    );
  });
}
