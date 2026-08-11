import type { CommodityType } from "@/lib/constants/commodities";
import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { applyMacroContributionsToGlobal } from "@/lib/world/macro/contributions";
import type { MacroMarketContribution } from "@/lib/world/macro/types";
import { DEFAULT_SPHERE_BOUNDS } from "./bounds";
import { computeSphereFlows } from "./flows";
import { recordSphereFlowLedger } from "./ledger";
import { loadSphereMembership } from "./membershipStore";
import { routeMacroContributionThroughSpheres } from "./marketRouting";
import { explainSphereEffects } from "./readModel";
import { assertValidSphereMembership } from "./relationships";
import type {
  SphereBounds,
  SphereEffectExplanation,
  SphereFlowLedgerEntry,
  SphereRoutedContribution,
} from "./types";

export interface TaggedMacroContribution {
  entityId: string;
  presetId: string;
  contribution: MacroMarketContribution;
}

export interface SphereMacroApplyResult {
  entitiesRouted: number;
  routed: SphereRoutedContribution[];
  explanations: SphereEffectExplanation[];
  ledgerEntries: SphereFlowLedgerEntry[];
}

/**
 * Load held macro contributions tagged with entity + preset so sphere routing
 * can attribute benefits without a parallel fake contribution path.
 */
export async function loadTaggedMacroContributions(db: Db): Promise<TaggedMacroContribution[]> {
  const docs = await (
    await getMacroCountriesCollection(db)
  )
    .find({}, { projection: { entityId: 1, presetId: 1, contribution: 1 } })
    .toArray();
  return docs
    .filter((doc) => doc.contribution && doc.entityId && doc.presetId)
    .map((doc) => ({
      entityId: doc.entityId,
      presetId: doc.presetId,
      contribution: doc.contribution,
    }));
}

/**
 * Route each held macro contribution through primary-sphere rules, apply the
 * resulting (non-duplicated) units to the shared global market, compute bounded
 * aid/tribute/support, and write the auditable ledger + admin explanations.
 *
 * Membership prefers live sponsor-managed state (#3718) over the manifest seed.
 */
export async function applySphereRoutedMacroContributions(
  db: Db,
  global: Map<CommodityType, { supply: number; demand: number }>,
  turn: number,
  bounds: SphereBounds = DEFAULT_SPHERE_BOUNDS
): Promise<SphereMacroApplyResult> {
  const tagged = await loadTaggedMacroContributions(db);
  const routed: SphereRoutedContribution[] = [];
  const explanations: SphereEffectExplanation[] = [];
  const allFlows: SphereRoutedContribution["flows"] = [];

  for (const item of tagged) {
    const membership = await loadSphereMembership(db, item.presetId, item.entityId);
    assertValidSphereMembership(membership);

    const marketRouted = routeMacroContributionThroughSpheres(
      item.contribution,
      membership,
      bounds,
      turn
    );
    const flows = computeSphereFlows(membership, bounds);
    const full: SphereRoutedContribution = { ...marketRouted, flows };
    routed.push(full);
    allFlows.push(...flows);
    explanations.push(...explainSphereEffects(membership, full, bounds));
  }

  applyMacroContributionsToGlobal(
    global,
    routed.map((r) => r.marketContribution)
  );

  const ledgerEntries = await recordSphereFlowLedger(
    db,
    turn,
    allFlows,
    "world/spheres/apply.ts:applySphereRoutedMacroContributions"
  );

  return {
    entitiesRouted: routed.length,
    routed,
    explanations,
    ledgerEntries,
  };
}
