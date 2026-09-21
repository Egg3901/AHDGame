/**
 * Legislative administration metadata. This adapter gives every US, UK, and
 * Japan law an accountable portfolio, jurisdiction rule, and delivery class.
 */
import type {
  AppropriationClass,
  FundingSemantics,
  JurisdictionMode,
  LawImplementationMode,
  LawKind,
  LegislationAdministration,
  LegislationPolicyOption,
  LegislationType,
  PolicyOptionImplementation,
} from "@/lib/db/types/legislation";
import type { PortfolioId } from "./departmentCatalog";

const INITIAL_COUNTRY_SCOPES = new Set(["us", "uk", "jp"]);
const REGIONAL_MARKERS = ["_state_", "_regional_", "resident_tax", "fixed_asset_tax"];
const REGIONALLY_ELIGIBLE_DOMAINS = new Set([
  "agriculture",
  "economic",
  "economy",
  "education",
  "environment",
  "governance",
  "healthcare",
  "infrastructure",
  "law_justice",
  "mediaInformation",
  "publicSafety",
  "social",
  "technology",
]);

function isRegionalType(type: LegislationType): boolean {
  if (type.allowedScope === "state" || type.taxRateChange?.scope === "state") return true;
  return REGIONAL_MARKERS.some((marker) => type._id.includes(marker));
}

function hasProgramCost(option: LegislationPolicyOption): boolean {
  return (
    (option.annualCostPerCapita ?? 0) > 0 ||
    (option.gdpPerCapitaMultiplier ?? 0) > 0 ||
    (option.gdpCostFraction ?? 0) > 0 ||
    (option.incomeCostFraction ?? 0) > 0 ||
    (option.costModelV2?.gdpCostFraction ?? 0) > 0 ||
    (option.costModelV2?.incomeCostFraction ?? 0) > 0
  );
}

function isCostBearing(type: LegislationType): boolean {
  return type.policyOptions?.some(hasProgramCost) === true;
}

function text(type: LegislationType): string {
  return `${type._id} ${type.policyDomain} ${type.subCategory}`.toLowerCase();
}

export function resolvePrimaryPortfolio(type: LegislationType): PortfolioId {
  const value = text(type);
  if (type.policyDomain === "tax") return "finance";
  if (type.policyDomain === "defense") return "defense";
  if (type.policyDomain === "foreign_policy") return "foreign_affairs";
  if (type.policyDomain === "healthcare") return "health";
  if (type.policyDomain === "education" || type.policyDomain === "technology") {
    return "education_research";
  }
  if (type.policyDomain === "agriculture") return "agriculture_rural_affairs";
  if (type.policyDomain === "environment") return "environment_energy";
  if (type.policyDomain === "infrastructure") {
    return /energy|utilit|grid/.test(value) ? "environment_energy" : "transport_infrastructure";
  }
  if (type.policyDomain === "publicSafety" || type.policyDomain === "law_justice") {
    return "justice";
  }
  if (type.policyDomain === "immigration") return "interior_local_government";
  if (type.policyDomain === "mediaInformation") return "interior_local_government";
  if (type.policyDomain === "governance" || type.policyDomain === "government") {
    return /ethic|surveillance|voting|electoral|filibuster/.test(value)
      ? "justice"
      : "interior_local_government";
  }
  if (type.policyDomain === "social") {
    if (/housing|leasehold/.test(value)) return "housing";
    return "labor_social_protection";
  }
  if (type.policyDomain === "economic" || type.policyDomain === "economy") {
    if (/stimulus|fiscal|spending|allocation tax/.test(value)) return "finance";
    if (/labor|labour|workforce|wage|pension|entitlement/.test(value)) {
      return "labor_social_protection";
    }
    return "economy_industry";
  }
  return "interior_local_government";
}

function resolveJurisdictionModes(type: LegislationType): {
  allowed: JurisdictionMode[];
  defaultMode: JurisdictionMode;
} {
  if (isRegionalType(type)) {
    return { allowed: ["regional_discretion"], defaultMode: "regional_discretion" };
  }
  if (type.isGrant) {
    return {
      allowed: ["grant_supported_regional", "national_floor"],
      defaultMode: "grant_supported_regional",
    };
  }
  const allowed: JurisdictionMode[] = ["national_direct"];
  if (REGIONALLY_ELIGIBLE_DOMAINS.has(type.policyDomain)) {
    allowed.push("national_floor", "concurrent", "grant_supported_regional", "regional_discretion");
  }
  return { allowed, defaultMode: "national_direct" };
}

function resolveLawKind(type: LegislationType): LawKind {
  const value = text(type);
  if (type.policyDomain === "tax") return "revenue";
  if (/constitution|electoral|filibuster|devolution|autonomy/.test(value)) return "constitutional";
  if (/emergency|disaster/.test(value)) return "emergency";
  if (/infrastructure|transport|rail|grid|broadband|housing development/.test(value)) {
    return "capital_program";
  }
  if (/pension|benefit|social security|universal credit|food assistance|nutrition/.test(value)) {
    return "transfer_program";
  }
  if (isCostBearing(type)) return "service_program";
  if (/department|banking separation|resource extraction/.test(value)) return "structural";
  return "regulation";
}

function resolveImplementationMode(type: LegislationType, lawKind: LawKind): LawImplementationMode {
  if (type.isGrant) return "formula_grant";
  if (lawKind === "transfer_program") return "automatic_transfer";
  if (lawKind === "regulation" || lawKind === "revenue" || lawKind === "constitutional") {
    return "regulation";
  }
  return "direct";
}

function resolveAppropriationClass(
  type: LegislationType,
  lawKind: LawKind
): AppropriationClass | undefined {
  if (lawKind === "capital_program") return "capital";
  if (lawKind === "transfer_program") return "demand_led";
  if (lawKind === "service_program" || lawKind === "emergency") return "operating";
  if (isCostBearing(type)) return "operating";
  return undefined;
}

function resolveFundingSemantics(
  type: LegislationType,
  lawKind: LawKind
): FundingSemantics | undefined {
  if (!isCostBearing(type)) return undefined;
  if (lawKind === "transfer_program") return "standing_mandatory";
  return "appropriation_included";
}

export function resolveCapacityType(
  portfolioId: PortfolioId,
  lawKind: LawKind
): string | undefined {
  if (lawKind === "revenue" || lawKind === "constitutional" || lawKind === "structural") {
    return undefined;
  }
  const byPortfolio: Partial<Record<PortfolioId, string>> = {
    finance: "fiscal_administration",
    defense: "defense_operations",
    justice: "justice_administration",
    interior_local_government: "civil_administration",
    economy_industry: "economic_administration",
    labor_social_protection: "benefits_administration",
    health: "health_service_delivery",
    education_research: "education_and_research_delivery",
    transport_infrastructure: "capital_delivery",
    agriculture_rural_affairs: "agricultural_program_delivery",
    environment_energy: "environment_and_energy_delivery",
    housing: "housing_program_delivery",
    foreign_affairs: "diplomatic_operations",
    intelligence: "intelligence_operations",
  };
  return byPortfolio[portfolioId];
}

function primaryOutcome(type: LegislationType): PolicyOptionImplementation["outcome"] {
  const target = type.effectTargetsWeighted?.[0] ?? type.effectTargets?.[0] ?? type.effectTarget;
  return target ? { category: target.metricCategoryId, metricId: target.metricId } : undefined;
}

function programId(type: LegislationType, option: LegislationPolicyOption): string {
  return `${type._id}:${option.id}`;
}

function withProgramImplementation(
  type: LegislationType,
  administration: LegislationAdministration
): LegislationPolicyOption[] | undefined {
  const capacity = resolveCapacityType(
    administration.primaryPortfolioId as PortfolioId,
    administration.lawKind
  );
  return type.policyOptions?.map((option) => {
    if (option.implementation || !isCostBearing(type)) return option;
    const appropriationClass = administration.appropriationClass;
    const fundingSemantics = administration.fundingSemantics;
    if (!appropriationClass || !fundingSemantics) return option;
    return {
      ...option,
      implementation: {
        programId: programId(type, option),
        fundingSemantics,
        appropriationClass,
        // Content-neutral compatibility value. Mandatory treatment is derived
        // from fundingSemantics, not from a score assigned to the policy.
        obligationPriority: 5,
        ...(capacity ? { capacityType: capacity, capacityDemand: { [capacity]: 100 } } : {}),
        rampProfileId: administration.lawKind === "capital_program" ? "capital_build" : "standard",
        ...(primaryOutcome(type) ? { outcome: primaryOutcome(type) } : {}),
      },
    };
  });
}

export function buildLawAdministration(type: LegislationType): LegislationAdministration {
  if (type.administration) return type.administration;
  const primaryPortfolioId = resolvePrimaryPortfolio(type);
  const lawKind = resolveLawKind(type);
  const jurisdiction = resolveJurisdictionModes(type);
  const appropriationClass = resolveAppropriationClass(type, lawKind);
  const fundingSemantics = resolveFundingSemantics(type, lawKind);
  const capacity = resolveCapacityType(primaryPortfolioId, lawKind);
  return {
    primaryPortfolioId,
    lawKind,
    implementationMode: resolveImplementationMode(type, lawKind),
    allowedJurisdictionModes: jurisdiction.allowed,
    defaultJurisdictionMode: jurisdiction.defaultMode,
    ...(appropriationClass ? { appropriationClass } : {}),
    ...(fundingSemantics ? { fundingSemantics } : {}),
    ...(capacity ? { capacityDemand: { [capacity]: 100 } } : {}),
    rampProfileId: lawKind === "capital_program" ? "capital_build" : "standard",
    policyFamilyId: type._id,
  };
}

export function withLawAdministration(types: LegislationType[]): LegislationType[] {
  return types.map((type) => {
    if (!type.countryScope || !INITIAL_COUNTRY_SCOPES.has(type.countryScope)) return type;
    const administration = buildLawAdministration(type);
    return {
      ...type,
      allowedScope: type.allowedScope ?? (isRegionalType(type) ? "state" : "national"),
      administration,
      policyOptions: withProgramImplementation(type, administration),
    };
  });
}
