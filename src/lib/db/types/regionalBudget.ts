import type { CountryId } from "@/lib/constants/countries";

export interface RegionalBudget {
  _id: string; // regionId (e.g., "LON", "SCO", "HOK")
  countryId: CountryId;
  turn: number;

  // Revenue sources — UK (zeroed for JP regions; kept required for UK consumer compatibility)
  councilTaxRevenue: number;
  businessRatesRevenue: number;
  westminsterGrant: number;
  totalBudget: number;

  // Revenue sources — JP (optional, only set for JP regions)
  /** JP Prefectural Resident Tax revenue (from jp_resident_tax rate × median income) */
  residentTaxRevenue?: number;
  /** JP Fixed Asset Tax revenue (from jp_fixed_asset_tax rate × property value base) */
  fixedAssetTaxRevenue?: number;
  /** JP national grant from Local Allocation Tax (from jp_local_allocation_tax) */
  nationalGrant?: number;

  // Revenue sources — DE (optional, only set for DE Länder)
  /** DE Länder income tax share (42.5% of federal income tax, collected in-territory) */
  incomeTaxShare?: number;
  /** DE Länder VAT share (46.5% of VAT revenue, distributed by population) */
  vatShare?: number;
  /** DE federal equalization grant (Länderfinanzausgleich + BEZ, Finance Minister allocation) */
  federalEqualizationGrant?: number;
  /**
   * DE Gewerbesteuer revenue at the Land level. Computed from the per-Land
   * Hebesatz policy (`de_trade_tax`) × Steuermesszahl (0.035) × Land
   * domestic-corporate-profit base. Added 2026-05-26 with the DE legislation
   * overhaul (PR1 deferred-item fix).
   */
  tradeTaxRevenue?: number;

  // Revenue sources — CN (optional, only set for CN regions)
  /** CN Enterprise Income Tax local share (40% of EIT collected in-region, from cn_enterprise_income_tax) */
  eitShare?: number;
  /** CN central transfer grant from national government (Finance Minister allocation or equal split) */
  centralTransferGrant?: number;
  /**
   * CN Provincial Resource Tax revenue at the region level. Computed from the
   * per-region `cn_provincial_resource_tax` policy rate × regional GDP ×
   * resource-extraction proxy (3% of GDP). Added 2026-05-27 with the CN
   * legislation overhaul (PR5 deferred-item fix).
   */
  resourceTaxRevenue?: number;
  /**
   * CN standing Business Tax (营业税) revenue — the dominant 1991 Chinese local
   * tax. Computed from regional GDP × consumption ratio × rate. Always
   * collected (not enactment-gated). Added 2026-06-08 with the CN fiscal rescale.
   */
  businessTaxRevenue?: number;

  // Revenue sources — RU (optional, only set for RU regions)
  /**
   * RU population-proportional share of the union's stateGrants pool
   * (command-economy funding — no local taxation). Added with the
   * political-legislation rebuild's RU regional-budget phase (spec §5.2).
   */
  unionGrant?: number;

  // Spending
  enactedBillCosts: number;
  subsidyCosts?: number;
  surplus: number; // totalBudget - enactedBillCosts (negative = deficit)

  // Budget state
  isOverBudget: boolean;
  turnsOverBudget: number;

  // Dynamic value bases (Section C6 of spec). Zeroed for RU regions
  // (grants-pool funded — no property/commercial tax bases to drift).
  propertyValuePerCapita: number;
  commercialValuePerCapita: number;
  propertyValueBaseline: number; // Starting value for guardrail calculations
  commercialValueBaseline: number;

  // Chancellor/Minister allocation (null = even split)
  chancellorAllocation: number | null;

  updatedAt: Date;
}
