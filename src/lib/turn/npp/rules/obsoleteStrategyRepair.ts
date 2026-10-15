/** Only the parent-catalog selections produced by the retired NPP writer qualify. */
export function isObsoleteNppParentStrategy(
  ceoType: string | null | undefined,
  operatingType: string,
  strategyId: string
): boolean {
  if (ceoType !== "npp") return false;
  return (
    (operatingType === "media_entertainment" && strategyId === "legacy_broadcast") ||
    (operatingType === "manufacturing_vehicles" &&
      (strategyId === "heavy_metals" || strategyId === "electronics_manufacturing"))
  );
}
