/** Strategic directions and the two supply systems have independent activation rules. */
export function groupCapabilities(input: {
  subsidiariesEnabled?: boolean;
  marketSystemMode?: string;
  groupSupplyCoordinationEnabled?: boolean;
}) {
  const supplyEngineEnabled =
    input.subsidiariesEnabled === true &&
    input.marketSystemMode === "plants" &&
    input.groupSupplyCoordinationEnabled === true;
  return {
    directionsEnabled: input.subsidiariesEnabled === true,
    supplyEngineEnabled,
    internalSupplyEnabled: input.marketSystemMode === "plants" && !supplyEngineEnabled,
  };
}
