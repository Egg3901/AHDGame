import {
  resolveTierTransition,
  UK_TIER_GRADUATION_REGION_FRACTION,
} from "../../src/lib/parties/partyTier";

const regionCount = 12;
const currentTurn = 100;
const maxEarnedRegionsToShow = 5;

console.log("earned_regions\tcurrent_uk\tproposed_uk\tother_country");
for (let earnedRegions = 0; earnedRegions <= maxEarnedRegionsToShow; earnedRegions++) {
  const orgByRegion = new Map(
    Array.from({ length: earnedRegions }, (_, i) => [`R${i}`, 20] as const)
  );
  const input = {
    currentTier: "minor" as const,
    orgByRegion,
    regionCount,
    warningStartedTurn: null,
    currentTurn,
  };
  const currentUk = resolveTierTransition(input);
  const proposedUk = resolveTierTransition({
    ...input,
    graduationRegionFraction: UK_TIER_GRADUATION_REGION_FRACTION,
  });
  const otherCountry = resolveTierTransition(input);

  console.log(`${earnedRegions}\t${currentUk.tier}\t${proposedUk.tier}\t${otherCountry.tier}`);
}

const atRiskOrg = new Map(Array.from({ length: 4 }, (_, i) => [`R${i}`, 15] as const));
const atRiskInput = {
  currentTier: "major" as const,
  orgByRegion: atRiskOrg,
  regionCount,
  warningStartedTurn: null,
  currentTurn,
};
const currentMajor = resolveTierTransition(atRiskInput);
const proposedMajor = resolveTierTransition({
  ...atRiskInput,
  graduationRegionFraction: UK_TIER_GRADUATION_REGION_FRACTION,
});
console.log(`major_at_risk\t${currentMajor.reason}\t${proposedMajor.reason}`);
