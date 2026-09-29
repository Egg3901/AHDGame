import type { SuccessorTerritory } from "./territory";

/** Physical custody is distinct from the public-finance allocation. An
 * enterprise or unit may have a known book value, but moving it never credits cash
 * or rewrites a creditor's contract. */
export interface SuccessionCustodyAsset {
  assetId: string;
  kind: "public-enterprise" | "conventional-force" | "strategic-force";
  homeRegionId: string | null;
  /** Optional book value in shared accounting units; absence never means zero. */
  valueMinor?: number;
}

export interface SuccessionCustodyAssignment {
  assetId: string;
  kind: SuccessionCustodyAsset["kind"];
  custodianEntityId: string;
  /** Background successors receive aggregate capacity, never domestic offices. */
  disposition: "retain-detailed" | "aggregate-background";
  valueMinor?: number;
}

/**
 * Local enterprises and conventional forces follow territory. Strategic forces
 * and assets without a fixed home require an explicit custodian in the approved
 * terms. A background successor receives aggregate custody rather than a
 * playable corporation or unit.
 */
export function planSuccessionCustody(input: {
  sourceEntityId: string;
  territories: readonly SuccessorTerritory[];
  assets: readonly SuccessionCustodyAsset[];
  negotiatedCustodians?: Readonly<Record<string, string>>;
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
  const negotiated = input.negotiatedCustodians ?? {};
  for (const assetId of Object.keys(negotiated)) {
    if (
      !input.assets.some(
        (asset) =>
          asset.assetId === assetId &&
          (asset.kind === "strategic-force" || asset.homeRegionId === null)
      )
    )
      throw new Error("Negotiated custody names an unknown or local asset");
  }
  return input.assets.map((asset) => {
    if (
      !asset.assetId.trim() ||
      seenAssets.has(asset.assetId) ||
      (asset.homeRegionId !== null && !regionOwner.has(asset.homeRegionId)) ||
      (asset.valueMinor !== undefined &&
        (!Number.isSafeInteger(asset.valueMinor) || asset.valueMinor < 0))
    )
      throw new Error("Custody asset is duplicated or outside source territory");
    seenAssets.add(asset.assetId);
    const localOwner =
      asset.homeRegionId === null ? undefined : regionOwner.get(asset.homeRegionId);
    const custodianEntityId =
      asset.kind === "strategic-force" || asset.homeRegionId === null
        ? negotiated[asset.assetId]
        : localOwner;
    if (!custodianEntityId || !successorIds.has(custodianEntityId))
      throw new Error("Shared or strategic custody requires an approved successor custodian");
    return {
      assetId: asset.assetId,
      kind: asset.kind,
      custodianEntityId,
      disposition:
        custodianEntityId === input.sourceEntityId ? "retain-detailed" : "aggregate-background",
      ...(asset.valueMinor !== undefined && { valueMinor: asset.valueMinor }),
    };
  });
}
