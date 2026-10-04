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
}

/** Manufacturing lines settle through modeled commodity outputs only. */
export const MANUFACTURING_PRODUCT_KINDS: readonly ManufacturingProductKind[] = [
  {
    id: "passenger_car",
    label: "Passenger car",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles"],
  },
  { id: "truck", label: "Truck", outputCommodity: "vehicles", sectorTypes: ["automobiles"] },
  {
    id: "commercial_vehicle",
    label: "Commercial vehicle",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles"],
  },
  {
    id: "consumer_electronics",
    label: "Consumer electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "industrial_electronics",
    label: "Industrial electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "electronic_components",
    label: "Electronic components",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "structural_steel",
    label: "Structural steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "sheet_steel",
    label: "Sheet steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "specialty_steel",
    label: "Specialty steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "cement",
    label: "Cement",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "prefabricated_components",
    label: "Prefabricated components",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
  },
  {
    id: "construction_materials",
    label: "Construction materials",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
  },
];

const PRODUCT_BY_ID = new Map(MANUFACTURING_PRODUCT_KINDS.map((kind) => [kind.id, kind]));

export function getManufacturingProductKind(id: string): ManufacturingProductKind | undefined {
  return PRODUCT_BY_ID.get(id);
}
