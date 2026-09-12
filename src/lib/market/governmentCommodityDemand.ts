/**
 * Government commodity demand. GOVERNMENT_COMMODITY_DEMAND maps budget lines
 * to buyers and marks which buyers also affect regional market books.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import {
  GOVT_DEFENSE_ORDNANCE_DEMAND_RATE,
  GOVT_HEALTHCARE_DEMAND_RATE,
  STATE_MEDIA_DEMAND_RATE,
} from "@/lib/constants/commodities";

export const GOVERNMENT_COMMODITY_DEMAND: ReadonlyArray<{
  category: string;
  commodity: CommodityType;
  rate: number;
  plannedOnly?: boolean;
  regional?: boolean;
}> = [
  {
    category: "healthcare",
    commodity: "healthcare_services",
    rate: GOVT_HEALTHCARE_DEMAND_RATE,
    regional: true,
  },
  {
    category: "defense",
    commodity: "ordnance",
    rate: GOVT_DEFENSE_ORDNANCE_DEMAND_RATE,
    regional: true,
  },
  {
    category: "education",
    commodity: "entertainment_services",
    rate: STATE_MEDIA_DEMAND_RATE,
    plannedOnly: true,
  },
];
