/**
 * A non-selectable calibration workbench. Existing 1991 claims are the fiscal
 * anchor for replacement options; GDP fractions apply only where no source
 * program exists. This does not approve legal supersession or delivery.
 */
export interface ProvisionalPriceProfile {
  baseCostFractionOfGdp: number;
  allocationFactors: readonly number[];
}

export interface ProvisionalPriceVector {
  anchor: "source-book" | "new-program-gdp-proxy";
  sourceAnnual: number;
  rawDesignCenterAnnual: number;
  fiveAnnualAllocations: number[];
}

export function provisionalPriceVector(input: {
  gdp: number;
  sourceAnnual: number;
  profile: ProvisionalPriceProfile;
}): ProvisionalPriceVector {
  const { gdp, sourceAnnual, profile } = input;
  if (
    !Number.isFinite(gdp) ||
    gdp < 0 ||
    !Number.isFinite(sourceAnnual) ||
    sourceAnnual < 0 ||
    !Number.isFinite(profile.baseCostFractionOfGdp) ||
    profile.baseCostFractionOfGdp < 0 ||
    profile.allocationFactors.length !== 5 ||
    profile.allocationFactors.some((factor) => !Number.isFinite(factor) || factor < 0)
  ) {
    throw new Error("Invalid provisional pricing inputs");
  }
  const centerFactor = profile.allocationFactors[2]!;
  if (centerFactor <= 0) throw new Error("Provisional center factor must be positive");
  const rawDesignCenterAnnual = Math.round(gdp * profile.baseCostFractionOfGdp * centerFactor);
  const anchor = sourceAnnual > 0 ? "source-book" : "new-program-gdp-proxy";
  const centerAnnual = sourceAnnual > 0 ? sourceAnnual : rawDesignCenterAnnual;
  return {
    anchor,
    sourceAnnual,
    rawDesignCenterAnnual,
    fiveAnnualAllocations: profile.allocationFactors.map((factor) =>
      Math.round((centerAnnual * factor) / centerFactor)
    ),
  };
}
