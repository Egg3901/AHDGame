import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import { BANKING_SEPARATION_TYPE_SUFFIX } from "@/lib/banking/separationBill";

type CountryScope = NonNullable<LegislationType["countryScope"]>;
type ChamberKey = LegislationType["positions"][number]["chamber"];

/**
 * Reusable Banking Separation Act for every seeded legislature country.
 * Command-economy nations still get a catalog entry (availability is
 * data-driven); private chartering is blocked at getLegalCharterTypes when
 * isCommandEconomy is true, so the law is inert there until the regime opens.
 *
 * Player copy is era-neutral and LARP-safe: no real-world statute names, no
 * year references.
 */
interface BankingSeparationSpec {
  /** Id prefix, e.g. "us" → "us_banking_separation". */
  prefix: string;
  scope: CountryScope;
  chamberKey: ChamberKey;
  committeeLabel: string;
}

function makeOptions(typeId: string): LegislationPolicyOption[] {
  return [
    {
      id: `${typeId}_separated`,
      name: "Banking Separation Act",
      explanation:
        "Require deposit-taking banks and investment banks to hold separate charters. A single institution may not combine both businesses under one universal charter.",
      stance: "left",
      effectDirection: 1,
      economic: -3,
      social: 0,
    },
    {
      id: `${typeId}_universal`,
      name: "Universal Banking Charter Act",
      explanation:
        "Permit a single charter that combines deposit-taking and investment banking. Separated retail and investment charters remain available.",
      stance: "right",
      effectDirection: -1,
      economic: 3,
      social: 0,
    },
  ];
}

function makeBankingSeparationType(spec: BankingSeparationSpec): LegislationType {
  const typeId = `${spec.prefix}${BANKING_SEPARATION_TYPE_SUFFIX}`;
  return {
    _id: typeId,
    countryScope: spec.scope,
    name: "Banking Separation Act",
    description:
      "Sets whether deposit-taking and investment banking must operate under separate charters, or may combine under a universal charter",
    explanation:
      "This act decides the charter structure of private banks. Under separation, a bank may take deposits or underwrite and trade securities, but not both under one charter. Under a universal rule, a single charter may combine those businesses. The choice applies only in this country.",
    policyDomain: "economic",
    subCategory: "Banking charters",
    nationalOnly: true,
    allowedScope: "national",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "economicFreedom",
      scope: "national",
    },
    // Signed relative to LEFT (+1): separation tightens the sector; universal
    // (right, effectDirection -1) improves economicFreedom (passes policySymmetry).
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "economicFreedom", weight: -0.8 },
      { metricCategoryId: "economic", metricId: "regulatoryBurden", weight: 0.4 },
    ],
    positions: [
      {
        positionId: `${spec.prefix}_banking_chair`,
        name: `Chair, Committee on ${spec.committeeLabel}`,
        chamber: spec.chamberKey,
      },
      {
        positionId: `${spec.prefix}_banking_ranking`,
        name: `Ranking Member, Committee on ${spec.committeeLabel}`,
        chamber: spec.chamberKey,
      },
    ],
    policyOptions: makeOptions(typeId),
  };
}

/** One entry per seeded legislature countryScope. */
const BANKING_SEPARATION_SPECS: BankingSeparationSpec[] = [
  { prefix: "us", scope: "us", chamberKey: "house", committeeLabel: "Financial Services" },
  { prefix: "uk", scope: "uk", chamberKey: "commons", committeeLabel: "Treasury" },
  { prefix: "jp", scope: "jp", chamberKey: "shugiin", committeeLabel: "Finance" },
  { prefix: "de", scope: "de", chamberKey: "bundestag", committeeLabel: "Finanzen" },
  { prefix: "ie", scope: "ie", chamberKey: "dail", committeeLabel: "Finance" },
  { prefix: "cn", scope: "cn", chamberKey: "npc", committeeLabel: "Finance and Economy" },
  { prefix: "ng", scope: "ng", chamberKey: "senate", committeeLabel: "Banking and Finance" },
  { prefix: "br", scope: "br", chamberKey: "chamber", committeeLabel: "Finance" },
  { prefix: "ru", scope: "ru", chamberKey: "sovietOfTheUnion", committeeLabel: "Finance" },
  {
    prefix: "fr",
    scope: "fr",
    chamberKey: "assembleeNationale",
    committeeLabel: "Finance",
  },
  {
    prefix: "it",
    scope: "it",
    chamberKey: "cameraDeputati",
    committeeLabel: "Finance",
  },
  {
    prefix: "es",
    scope: "es",
    chamberKey: "congresoDiputados",
    committeeLabel: "Economy and Finance",
  },
  { prefix: "se", scope: "se", chamberKey: "riksdag", committeeLabel: "Finance" },
  { prefix: "tr", scope: "tr", chamberKey: "milletMeclisi", committeeLabel: "Finance" },
  { prefix: "gr", scope: "gr", chamberKey: "vouli", committeeLabel: "Economy" },
  { prefix: "at", scope: "at", chamberKey: "nationalrat", committeeLabel: "Finance" },
  { prefix: "fi", scope: "fi", chamberKey: "eduskunta", committeeLabel: "Finance" },
  { prefix: "dd", scope: "dd", chamberKey: "volkskammer", committeeLabel: "Finance" },
  {
    prefix: "hu",
    scope: "hu",
    chamberKey: "nationalAssembly",
    committeeLabel: "Finance",
  },
  { prefix: "pl", scope: "pl", chamberKey: "sejm", committeeLabel: "Finance" },
  {
    prefix: "ro",
    scope: "ro",
    chamberKey: "grandNationalAssembly",
    committeeLabel: "Finance",
  },
  {
    prefix: "yu",
    scope: "yu",
    chamberKey: "federalAssembly",
    committeeLabel: "Finance",
  },
  {
    prefix: "bg",
    scope: "bg",
    chamberKey: "nationalAssembly",
    committeeLabel: "Finance",
  },
  {
    prefix: "ukr",
    scope: "ukr",
    chamberKey: "supremeSoviet",
    committeeLabel: "Finance",
  },
  {
    prefix: "blr",
    scope: "blr",
    chamberKey: "supremeSoviet",
    committeeLabel: "Finance",
  },
  {
    prefix: "cs",
    scope: "cs",
    chamberKey: "chamberOfThePeople",
    committeeLabel: "Finance",
  },
  {
    prefix: "bal",
    scope: "bal",
    chamberKey: "supremeSoviet",
    committeeLabel: "Finance",
  },
];

export const bankingSeparationLegislationTypes: LegislationType[] =
  BANKING_SEPARATION_SPECS.map(makeBankingSeparationType);

export const BANKING_SEPARATION_TYPE_IDS: readonly string[] = bankingSeparationLegislationTypes.map(
  (t) => t._id
);

/** Era-catalog entries: banking separation is available in every era. */
export const BANKING_SEPARATION_ERA_ENTRIES: Record<string, "always"> = Object.fromEntries(
  BANKING_SEPARATION_TYPE_IDS.map((id) => [id, "always" as const])
) as Record<string, "always">;
