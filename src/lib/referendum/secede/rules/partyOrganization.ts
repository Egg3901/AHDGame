/** Regional reserves divide without changing percentage support. */
export function splitPartyOrgReserves(
  source: { treasury?: number; politicalStrength?: number; organizationUnits?: number },
  share: number
) {
  if (!Number.isFinite(share) || share < 0 || share > 1)
    throw new Error("Invalid party organization share");
  return {
    treasury: (source.treasury ?? 0) * share,
    politicalStrength: (source.politicalStrength ?? 0) * share,
    ...(source.organizationUnits !== undefined
      ? { organizationUnits: source.organizationUnits * share }
      : {}),
  };
}
