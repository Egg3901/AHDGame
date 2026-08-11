import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * A (countryId, sectorType) the government has designated strategic. A corp
 * operating a sector of a designated type in that country becomes a candidate
 * for the strategic-sector nationalization trigger (spec §8). One doc per
 * (countryId, sectorType) — enforced by the strategicSectors helper's upsert.
 */
export interface StrategicSectorDesignation {
  _id: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType;
  designatedAtTurn: number;
  /** What created it (audit): a bill, an executive office action, or the seed defaults. */
  source: "legislation" | "executive" | "seed";
  /** Bill id / order id, for audit traceability. */
  sourceRef?: string;
  createdAt: Date;
}
