import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export interface CabinetSetting {
  /** Composite key: "{countryId}_{positionId}" e.g., "UK_home_secretary" */
  _id: string;
  countryId: CountryId;
  positionId: string;
  /** Character who last updated these settings, or `null` when set by an NPP minister. */
  characterId: ObjectId | null;
  /** True when these settings were last set by an NPP minister. */
  isNPP?: boolean;
  /** The NPP minister's id, when `isNPP` is true. */
  nppId?: ObjectId;

  // ── Position-specific settings (each position uses relevant fields) ──
  /** 3-tier settings: "lenient"/"standard"/"strict", etc. */
  tierSetting?: string;
  /** Regional focus: policing priority, base investment, etc. */
  targetRegionId?: string;
  /** Foreign secretary envoy target country */
  targetCountryId?: string;
  /** Foreign secretary development aid focus */
  aidPriority?: string;
  /** Territorial secretaries: advocacy toggle */
  advocacyActive?: boolean;
  /** Chancellor/Health Sec: per-region percentage allocation */
  allocationPercents?: Record<string, number>;

  /** Turn when the policy tier last changed (24-turn cooldown, this lever only) */
  lastChangedTurn?: number;
  /** Turn when the regional target last changed (24-turn cooldown, this lever only) */
  lastRegionChangedTurn?: number;
  /** Turn when the foreign envoy target last changed (24-turn cooldown, this lever only) */
  lastTargetCountryChangedTurn?: number;
  /** Turn when the aid-priority setting last changed (24-turn cooldown, this lever only) */
  lastAidPriorityChangedTurn?: number;
  /** Turn when allocation percents last changed (once-per-turn cooldown) */
  lastAllocationChangedTurn?: number;
  updatedAt: Date;
}
