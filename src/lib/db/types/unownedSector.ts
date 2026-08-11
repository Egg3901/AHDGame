import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";

export interface RecentCorporateSectorRestore {
  sectorId: string;
  restoredAt: Date;
}

export interface UnownedSector {
  _id: ObjectId;
  stateId: string;
  countryId: CountryId;
  sectorType: CorporationType;
  /**
   * Current daily revenue, same units as CorporateSector.revenue. Unlike
   * CorporateSector.revenue (host-local currency, see sectorToHostCurrency
   * migration), this field is ₳-native — unowned sectors have no owning
   * corp/host-currency relationship, so there is nothing to re-denominate.
   */
  revenue: number;
  /**
   * Derived units-of-unmet-demand implied by `revenue`, converted through the
   * state's sector-type DEFAULT strategy commodity mix (see
   * computeUnownedHeadroomUnits in src/lib/market/unownedHeadroom.ts, which
   * mirrors impliedOutputUnits in src/lib/market/capital.ts so the unit basis
   * matches corp-side capacity units exactly).
   *
   * Telemetry/groundwork only as of this field's introduction — no system
   * reads it yet. A later phase reinterprets unowned sectors as demand-side
   * "market headroom" in units instead of ₳ revenue; this field is the
   * derived value that phase will read.
   */
  headroomUnits?: number;
  /**
   * Recent restore tokens for delete-after-restore retries. We keep only a
   * short rolling window so hot market docs do not grow forever while still
   * guarding duplicate submits and crash retries.
   */
  recentCorporateSectorRestores?: RecentCorporateSectorRestore[];
  createdAt: Date;
  updatedAt: Date;
}
