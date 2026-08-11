import type { ObjectId } from "mongodb";
import type { CorporationType } from "../../constants/corporations";
import type { CountryId } from "../../constants/countries";

export type SubsidyScopeType = "sector" | "economy_wide";

export interface Subsidy {
  _id: ObjectId;
  /** Country this subsidy applies IN */
  countryId: CountryId;
  /** Whether this is a national (whole-country) or state-level subsidy */
  scope: "national" | "state";
  /** Set when scope = "state" */
  stateId?: string;
  scopeType: SubsidyScopeType;
  /** Set when scopeType = "sector" */
  targetSectorType?: CorporationType;
  /**
   * Optional strategy filter — only sectors using this strategy qualify.
   * Only valid when scopeType = "sector". Undefined = all strategies.
   */
  targetStrategyId?: string;
  /**
   * When true, only corps HQ'd in the subsidy's domestic jurisdiction qualify.
   * national scope → corps HQ'd in countryId; state scope → corps HQ'd in stateId.
   */
  domesticOnly: boolean;
  /** false = nullified by an end_subsidy bill; document kept for audit trail */
  active: boolean;
  /** Bill that last set this subsidy */
  sourceBillId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
