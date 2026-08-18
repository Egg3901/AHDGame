/**
 * v3 tech-tree content: slots 10–15 per lane per decade.
 *
 * Per decade each lane gets SIX new specs, positionally mapped by the builder
 * in ../nodes.ts:
 *  - index 0–2 → slots 10–12: three MUTUALLY EXCLUSIVE specialization entries.
 *    Prereq: either completed branch (slot 8 or 9). Picking one locks the
 *    other two for the decade (abandon to switch).
 *  - index 3–5 → slots 13–15: the capstone for each entry (13 caps 10, 14 caps
 *    11, 15 caps 12).
 *
 * Costs are derived (entries 2×, capstones 3× the decade cost) — specs carry
 * only name, description and effects.
 */
import type { CorporationType } from "../../corporations";
import type { V3LaneContent } from "./types";
import { CORPORATE_V3 } from "./corporate";
import { AGRICULTURE_V3 } from "./agriculture";
import { AUTOMOBILES_V3 } from "./automobiles";
import { CHEMICAL_INDUSTRIES_V3 } from "./chemical_industries";
import { CONSTRUCTION_V3 } from "./construction";
import { DEFENSE_V3 } from "./defense";
import { ENERGY_V3 } from "./energy";
import { ENTERTAINMENT_V3 } from "./entertainment";
import { EXTRACTION_V3 } from "./extraction";
import { FINANCIAL_V3 } from "./financial";
import { HEALTHCARE_V3 } from "./healthcare";
import { LOGISTICS_V3 } from "./logistics";
import { MANUFACTURING_V3 } from "./manufacturing";
import { MEDIA_V3 } from "./media";
import { REAL_ESTATE_V3 } from "./real_estate";
import { RETAIL_V3 } from "./retail";
import { TECHNOLOGY_V3 } from "./technology";
import { TELECOMMUNICATIONS_V3 } from "./telecommunications";

export type { V3LaneContent } from "./types";

export { CORPORATE_V3 };

export const SECTOR_V3: Partial<Record<CorporationType, V3LaneContent>> = {
  agriculture: AGRICULTURE_V3,
  automobiles: AUTOMOBILES_V3,
  chemical_industries: CHEMICAL_INDUSTRIES_V3,
  construction: CONSTRUCTION_V3,
  defense: DEFENSE_V3,
  energy: ENERGY_V3,
  entertainment: ENTERTAINMENT_V3,
  extraction: EXTRACTION_V3,
  financial: FINANCIAL_V3,
  healthcare: HEALTHCARE_V3,
  logistics: LOGISTICS_V3,
  manufacturing: MANUFACTURING_V3,
  media: MEDIA_V3,
  real_estate: REAL_ESTATE_V3,
  retail: RETAIL_V3,
  technology: TECHNOLOGY_V3,
  telecommunications: TELECOMMUNICATIONS_V3,
};
