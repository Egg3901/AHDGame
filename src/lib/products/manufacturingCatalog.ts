/**
 * The manufacturing product catalog contains named lines that settle through modeled outputs.
 * MANUFACTURING_PRODUCT_KINDS is the catalog consumed by eligibility and the product editor.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";

export interface ManufacturingProductKind {
  id: string;
  label: string;
  outputCommodity: CommodityType;
  sectorTypes: readonly CorporationType[];
  strategyIds: readonly string[];
}

/** Manufacturing lines settle through modeled commodity outputs only. */
export const MANUFACTURING_PRODUCT_KINDS: readonly ManufacturingProductKind[] = [
  {
    id: "passenger_car",
    label: "Passenger car",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles", "manufacturing"],
    strategyIds: ["standard", "ev", "autonomous_driving", "vehicle_assembly"],
  },
  {
    id: "truck",
    label: "Truck",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles", "manufacturing"],
    strategyIds: ["standard", "heavy_machinery", "vehicle_heavy_machinery"],
  },
  {
    id: "commercial_vehicle",
    label: "Commercial vehicle",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles", "manufacturing"],
    strategyIds: [
      "standard",
      "ev",
      "heavy_machinery",
      "vehicle_assembly",
      "vehicle_heavy_machinery",
    ],
  },
  {
    id: "consumer_electronics",
    label: "Consumer electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing"],
  },
  {
    id: "industrial_electronics",
    label: "Industrial electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing", "additive_manufacturing"],
  },
  {
    id: "electronic_components",
    label: "Electronic components",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing"],
  },
  {
    id: "structural_steel",
    label: "Structural steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "heavy_metals"],
  },
  {
    id: "sheet_steel",
    label: "Sheet steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "heavy_metals", "autonomous_factory"],
  },
  {
    id: "specialty_steel",
    label: "Specialty steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["heavy_metals", "additive_manufacturing", "autonomous_factory"],
  },
  {
    id: "cement",
    label: "Cement",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory"],
  },
  {
    id: "prefabricated_components",
    label: "Prefabricated components",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory", "additive_manufacturing"],
  },
  {
    id: "construction_materials",
    label: "Construction materials",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory", "additive_manufacturing"],
  },
];

const PRODUCT_BY_ID = new Map(MANUFACTURING_PRODUCT_KINDS.map((kind) => [kind.id, kind]));

export function getManufacturingProductKind(id: string): ManufacturingProductKind | undefined {
  return PRODUCT_BY_ID.get(id);
}
