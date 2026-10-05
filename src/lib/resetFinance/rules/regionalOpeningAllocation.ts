/** Audit allocation of pooled 1991 regional claims into actual regional envelopes. */
export interface RegionalEnvelope {
  regionId: string;
  annualSpending: number;
}

export interface RegionalOpeningClaim {
  sourceId: string;
  familyId: string;
  annualBooked: number;
}

export function allocateRegionalOpeningClaims(
  envelopes: readonly RegionalEnvelope[],
  claims: readonly RegionalOpeningClaim[]
) {
  const regionIds = new Set<string>();
  let totalSpending = 0;
  for (const region of envelopes) {
    if (!region.regionId || regionIds.has(region.regionId)) {
      throw new Error(`duplicate or empty opening region ${region.regionId}`);
    }
    if (!Number.isFinite(region.annualSpending) || region.annualSpending < 0) {
      throw new Error(`invalid spending for ${region.regionId}`);
    }
    regionIds.add(region.regionId);
    totalSpending += region.annualSpending;
  }
  if (totalSpending <= 0) throw new Error("regional opening spending must be positive");
  const sourceIds = new Set<string>();
  let pooledClaims = 0;
  for (const claim of claims) {
    if (!claim.sourceId || sourceIds.has(claim.sourceId) || !claim.familyId) {
      throw new Error(`duplicate or incomplete regional source ${claim.sourceId}`);
    }
    if (!Number.isFinite(claim.annualBooked) || claim.annualBooked < 0) {
      throw new Error(`invalid regional source cost ${claim.sourceId}`);
    }
    sourceIds.add(claim.sourceId);
    pooledClaims += claim.annualBooked;
  }
  if (pooledClaims > totalSpending + 0.01) {
    throw new Error("regional law claims exceed the pooled service envelope");
  }
  const regions = envelopes.map((region) => {
    const share = region.annualSpending / totalSpending;
    const allocatedClaims = claims.map((claim) => ({
      sourceId: claim.sourceId,
      familyId: claim.familyId,
      annualBooked: claim.annualBooked * share,
    }));
    const familyOwned = allocatedClaims.reduce((sum, claim) => sum + claim.annualBooked, 0);
    return {
      regionId: region.regionId,
      annualSpending: region.annualSpending,
      allocatedClaims,
      familyOwned,
      otherExistingServices: region.annualSpending - familyOwned,
    };
  });
  return {
    annualSpending: totalSpending,
    familyOwned: pooledClaims,
    otherExistingServices: totalSpending - pooledClaims,
    regions,
  };
}
