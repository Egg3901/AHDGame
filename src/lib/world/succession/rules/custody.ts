import type { SuccessorTerritory } from "./territory";

/** Physical custody is distinct from the public-finance allocation. An
 * enterprise or unit may have a book value, but moving it never credits cash
 * or rewrites a creditor's contract. */
export interface SuccessionCustodyAsset {
  assetId: string;
  kind: "public-enterprise" | "conventional-force" | "strategic-force";
  homeRegionId: string;
  valueMinor: number;
}

export interface SuccessionCustodyAssignment {
  assetId: string;
  kind: SuccessionCustodyAsset["kind"];
  custodianEntityId: string;
  /** Background successors receive aggregate capacity, never domestic offices. */
  disposition: "retain-detailed" | "aggregate-background";
  valueMinor: number;
}

/**
 * Local enterprises and conventional forces follow territory. Strategic forces
 * require an explicit custodian in the approved terms. A background successor
 * receives aggregate custody rather than a playable corporation or unit.
 */
export function planSuccessionCustody(input: {
  sourceEntityId: string;
  territories: readonly SuccessorTerritory[];
  assets: readonly SuccessionCustodyAsset[];
  strategicCustodians?: Readonly<Record<string, string>>;
}): SuccessionCustodyAssignment[] {
  const regionOwner = new Map<string, string>();
  const successorIds = new Set(input.territories.map((territory) => territory.entityId));
  if (
    !input.sourceEntityId.trim() ||
    input.territories.length < 2 ||
    successorIds.size !== input.territories.length
  )
    throw new Error("Custody requires distinct successor territories");
  for (const territory of input.territories) {
    if (!territory.entityId.trim() || territory.regionIds.length === 0)
      throw new Error("Custody requires inhabited successor territories");
    for (const regionId of territory.regionIds) {
      if (!regionId.trim() || regionOwner.has(regionId))
        throw new Error("Custody territory repeats a source region");
      regionOwner.set(regionId, territory.entityId);
    }
  }
  const seenAssets = new Set<string>();
  const strategic = input.strategicCustodians ?? {};
  for (const assetId of Object.keys(strategic)) {
    if (
      !input.assets.some((asset) => asset.assetId === assetId && asset.kind === "strategic-force")
    )
      throw new Error("Strategic custody names an unknown or conventional asset");
  }
  return input.assets.map((asset) => {
    if (
      !asset.assetId.trim() ||
      seenAssets.has(asset.assetId) ||
      !regionOwner.has(asset.homeRegionId) ||
      !Number.isSafeInteger(asset.valueMinor) ||
      asset.valueMinor < 0
    )
      throw new Error("Custody asset is duplicated or outside source territory");
    seenAssets.add(asset.assetId);
    const localOwner = regionOwner.get(asset.homeRegionId)!;
    const custodianEntityId =
      asset.kind === "strategic-force" ? strategic[asset.assetId] : localOwner;
    if (!custodianEntityId || !successorIds.has(custodianEntityId))
      throw new Error("Strategic custody requires an approved successor custodian");
    return {
      assetId: asset.assetId,
      kind: asset.kind,
      custodianEntityId,
      disposition:
        custodianEntityId === input.sourceEntityId ? "retain-detailed" : "aggregate-background",
      valueMinor: asset.valueMinor,
    };
  });
}
