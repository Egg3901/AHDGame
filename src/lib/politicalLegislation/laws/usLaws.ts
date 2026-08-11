/**
 * US political-legislation catalog — TRANSCRIBED from the reviewed catalog document
 * docs/superpowers/specs/2026-07-17-legislation-catalog-us.md (the content SSOT;
 * local-only). Do not hand-edit content here: fix the document, then re-transcribe.
 * Derived display figures (absolute currency amounts) are intentionally not carried.
 */

import type { PoliticalLaw } from "../types";

export const US_LAWS: PoliticalLaw[] = [
  {
    id: "us.tax.incomeTax",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 35,
      waypoints: [
        {
          rate: 0,
          label: "No Federal Levy",
        },
        {
          rate: 12,
          label: "Minimal Schedule",
        },
        {
          rate: 25,
          label: "Standard Schedule",
        },
        {
          rate: 35,
          label: "Graduated Schedule",
        },
        {
          rate: 48,
          label: "Elevated Schedule",
        },
        {
          rate: 58,
          label: "Wartime Schedule",
        },
      ],
    },
    title: "Federal Income Tax Structure",
    description:
      "The federal levy on personal incomes, from repeal to steeply graduated wartime schedules.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.tax.domesticCorporateTax",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "domesticCorporateTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 40,
      waypoints: [
        {
          rate: 0,
          label: "No Corporate Levy",
        },
        {
          rate: 15,
          label: "Light Assessment",
        },
        {
          rate: 28,
          label: "Standard Assessment",
        },
        {
          rate: 40,
          label: "Expanded Assessment",
        },
        {
          rate: 52,
          label: "Excess-Profits Regime",
        },
      ],
    },
    title: "Corporate Income Tax Act",
    description: "Taxation of corporate profits, up to and including excess-profits provisions.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.tax.foreignCorporateTax",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "foreignCorporateTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 32,
      waypoints: [
        {
          rate: 0,
          label: "Exempt Foreign Enterprise",
        },
        {
          rate: 16,
          label: "Light Assessment",
        },
        {
          rate: 32,
          label: "Parity Assessment",
        },
        {
          rate: 45,
          label: "Elevated Assessment",
        },
        {
          rate: 55,
          label: "Punitive Assessment",
        },
      ],
    },
    title: "Foreign Corporation Tax Act",
    description: "The levy on foreign-owned enterprise operating within the United States.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.tax.payrollTax",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "payrollTax",
      minRate: 0,
      maxRate: 12,
      step: 0.5,
      baselineRate: 3,
      waypoints: [
        {
          rate: 0,
          label: "No Contribution",
        },
        {
          rate: 1.5,
          label: "Foundation Contribution",
        },
        {
          rate: 3,
          label: "Standard Contribution",
        },
        {
          rate: 6,
          label: "Expanded Contribution",
        },
        {
          rate: 10,
          label: "Comprehensive Contribution",
        },
      ],
    },
    title: "Payroll Insurance Contributions Act",
    description: "Wage-based contributions funding old-age and survivors insurance.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.tax.salesTax",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "salesTax",
      minRate: 0,
      maxRate: 10,
      step: 0.5,
      baselineRate: 0,
      waypoints: [
        {
          rate: 0,
          label: "Existing Excises Only",
        },
        {
          rate: 2,
          label: "Broadened Excises",
        },
        {
          rate: 4,
          label: "Expanded Excises",
        },
        {
          rate: 7,
          label: "General Sales Levy",
        },
        {
          rate: 10,
          label: "Heavy Consumption Levy",
        },
      ],
    },
    title: "Federal Excise and Sales Levies Act",
    description:
      "New consumption levies layered ON TOP of the standing excise base (which the treasury already collects); the slider's zero keeps the status quo.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.tax.tariffs",
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "tariffs",
      minRate: 0,
      maxRate: 15,
      step: 0.5,
      baselineRate: 0,
      waypoints: [
        {
          rate: 0,
          label: "Standing Schedule",
        },
        {
          rate: 3,
          label: "Revenue Tariff",
        },
        {
          rate: 6,
          label: "Moderate Protection",
        },
        {
          rate: 10,
          label: "High Protection",
        },
        {
          rate: 15,
          label: "Protective Wall",
        },
      ],
    },
    title: "Tariff and Customs Act",
    description:
      "Additional duties beyond the standing customs schedule (already in the treasury's receipts); zero keeps trade policy as it stands.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "us.economy.workerSecurity.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.workerSecurity",
        weight: 1,
      },
    ],
    title: "Fair Labor Standards and Employment Security Act",
    description:
      "Federal wage floors, hours rules, and the machinery that enforces workplace protections.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Standards",
        description:
          "No federal standards govern employment; terms are whatever the contract says and the market bears.",
      },
      {
        name: "Basic Standards",
        description:
          "A federal minimum wage and hours rules, enforced by a wage-and-hour division with subpoenas.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "National Standards",
        description:
          "National standards broaden coverage and add dismissal protections beyond the union shops.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Strong Protections",
        description:
          "Bargaining rights are actively enforced: the labor board polices unfair practices with teeth.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Comprehensive Guarantees",
        description:
          "Comprehensive guarantees: universal coverage, a job-security board, and federal standards over every workplace.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "us.economy.mobility.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.mobility",
        weight: 1,
      },
    ],
    title: "Economic Opportunity and Rural Assistance Act",
    description: "Farm parity payments, depressed-area assistance, and ladders out of poverty.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Assistance Programs",
        description:
          "No federal poverty programs exist; hardship is a matter for the county and the church basement.",
      },
      {
        name: "Targeted Relief",
        description:
          "Narrow relief and farm aid reach the worst-off counties and the disaster years.",
        incomeCostFraction: 0.002,
      },
      {
        name: "Parity and Opportunity",
        description:
          "Farm parity payments plus depressed-area assistance steady the bottom of the rural economy.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Broad Mobility Programs",
        description:
          "Broad mobility programs: training grants, relocation allowances, and regional development boards.",
        incomeCostFraction: 0.013,
      },
      {
        name: "Full Opportunity Guarantee",
        description:
          "A full opportunity guarantee: comprehensive federal anti-poverty machinery from the hollow to the tenement.",
        incomeCostFraction: 0.02,
      },
    ],
  },
  {
    id: "us.economy.householdIncome.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.householdIncome",
        weight: 1,
      },
    ],
    title: "Wage Support and Household Standards Act",
    description:
      "Federal attention to household purchasing power, from monitoring to income floors.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Support",
        description: "Household incomes stand unsupported; the paycheck is the whole policy.",
      },
      {
        name: "Cost-of-Living Review",
        description:
          "Wage boards review cost-of-living data and publish what the numbers say about the squeeze.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Income Supplements",
        description: "Targeted supplements reach households the boom left behind.",
        incomeCostFraction: 0.002,
      },
      {
        name: "Broad Wage Support",
        description:
          "Broad wage support: wage insurance and supplements cushioning the working household against the cycle.",
        incomeCostFraction: 0.0042,
      },
      {
        name: "Guaranteed Standards",
        description:
          "Guaranteed standards: a universal household income floor, federally underwritten.",
        incomeCostFraction: 0.0078,
      },
    ],
  },
  {
    id: "us.economy.stability.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.stability",
        weight: 1,
      },
    ],
    title: "Economic Stabilization and Reserve Act",
    description: "The counter-cyclical apparatus: reserves, credit coordination, standby controls.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Stabilization Authority",
        description:
          "No counter-cyclical tools exist; the business cycle arrives unannounced and leaves uninvited.",
      },
      {
        name: "Monitoring Authority",
        description:
          "Statistics and early-warning machinery — the government at least sees the recession coming.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Reserve Coordination",
        description:
          "Credit and reserve coordination gives the Treasury and the Federal Reserve a common playbook.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Active Stabilization",
        description:
          "Active stabilization: standby controls and intervention funds ready before the panic starts.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Full Command Toolkit",
        description:
          "The full command toolkit: price-wage boards and deep reserves, the wartime apparatus kept warm in peacetime.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "us.economy.productivity.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.productivity",
        weight: 1,
      },
    ],
    title: "Industrial Investment and Enterprise Act",
    description: "Credit, incentives, and modernization programs behind private capital formation.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Investment Programs",
        description:
          "No federal investment support exists; capital formation is the market's business alone.",
      },
      {
        name: "Enterprise Credit",
        description: "Small-business credit windows lend where the banks will not.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Investment Incentives",
        description:
          "Investment incentives: accelerated amortization and development loans steering private capital.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Industrial Modernization",
        description:
          "Industrial modernization: retooling grants and productivity centers pushing plants to the frontier.",
        gdpCostFraction: 0.002,
      },
      {
        name: "National Investment Drive",
        description:
          "A national investment drive: broad capital mobilization with Washington underwriting the expansion.",
        gdpCostFraction: 0.0033,
      },
    ],
  },
  {
    id: "us.economy.fiscal.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.fiscal",
        weight: 1,
      },
    ],
    title: "Debt Management and Fiscal Responsibility Act",
    description: "How the public debt is managed and how binding the fiscal rules are.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Fiscal Framework",
        description:
          "No fiscal framework binds anyone; the debt is managed ad hoc and the budget is a hope.",
      },
      {
        name: "Debt Administration",
        description:
          "Orderly issuance and refunding put the public debt on a professional footing.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Fiscal Discipline Rules",
        description:
          "Fiscal discipline rules: debt ceilings, sinking funds, and audits with consequences.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Balanced-Budget Machinery",
        description:
          "Balanced-budget machinery: binding targets, enforced by procedures Congress cannot quietly waive.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Hard Fiscal Constitution",
        description:
          "A hard fiscal constitution: constitutional-grade constraints on what any Congress may borrow or spend.",
        gdpCostFraction: 0.0006,
      },
    ],
  },
  {
    id: "us.economy.competition.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 1,
      },
    ],
    title: "Antitrust and Fair Commerce Act",
    description: "The antitrust apparatus keeping markets open — fines flow back at higher levels.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Antitrust Enforcement",
        description: "Combinations go unrestrained; the trusts write their own rules of trade.",
      },
      {
        name: "Case-by-Case Review",
        description: "Selective prosecution: the worst cartels are taken to court, occasionally.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Active Enforcement",
        description:
          "Active enforcement: merger review before the fact and cartel prosecution after it.",
        gdpCostFraction: 0.0002,
        gdpRevenueFraction: 0.0001,
      },
      {
        name: "Structural Enforcement",
        description:
          "Structural enforcement: breakups ordered and entry mandated where concentration hardens.",
        gdpCostFraction: 0.00035,
        gdpRevenueFraction: 0.00015,
      },
      {
        name: "Open Markets Charter",
        description:
          "An open markets charter: sweeping deconcentration, with no firm too established to divide.",
        gdpCostFraction: 0.0005,
        gdpRevenueFraction: 0.0002,
      },
    ],
  },
  {
    id: "us.education.universalSchooling.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.universalSchooling",
        weight: 1,
      },
    ],
    title: "Public School Assistance Act",
    description: "The federal contribution to universal public schooling and its fairness.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Role",
        description:
          "Schooling is wholly state and local; the federal government neither pays nor asks.",
      },
      {
        name: "Impacted-Area Aid",
        description:
          "Impacted-area aid pays where federal installations crowd the local schoolhouse.",
        incomeCostFraction: 0.00126,
      },
      {
        name: "General School Aid",
        description: "General school aid: per-pupil federal support flowing to every district.",
        incomeCostFraction: 0.0032,
      },
      {
        name: "Equalization Program",
        description:
          "An equalization program tilts the funding toward the districts with the least to tax.",
        incomeCostFraction: 0.0061,
      },
      {
        name: "Universal Guarantee",
        description:
          "The universal guarantee: a full federal-state partnership behind every public classroom.",
        incomeCostFraction: 0.0097,
      },
    ],
  },
  {
    id: "us.education.teacherCorps.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.teacherCorps",
        weight: 1,
      },
    ],
    title: "Teacher Corps and School Facilities Act",
    description: "Federal investment in the people and buildings of public education.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description:
          "Staffing and buildings are local burdens; the teacher shortage is answered district by district.",
      },
      {
        name: "Facilities Grants",
        description:
          "Construction grants raise new schoolhouses where enrollment has outrun the walls.",
        incomeCostFraction: 0.00054,
      },
      {
        name: "Teacher Pipeline",
        description:
          "The teacher pipeline: training colleges funded and pay supplements where the shortage bites.",
        incomeCostFraction: 0.0014,
      },
      {
        name: "National Teacher Corps",
        description:
          "A national teacher corps recruits, trains, and places teachers where districts cannot.",
        incomeCostFraction: 0.0027,
      },
      {
        name: "Full Staffing Guarantee",
        description: "The full staffing guarantee: ratios and facilities underwritten nationwide.",
        incomeCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "us.education.adultSkills.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.adultSkills",
        weight: 1,
      },
    ],
    title: "Vocational and Veterans Training Act",
    description: "The adult-training ladder, from trade grants to universal reskilling.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Training Programs",
        description:
          "No federal adult training exists; a trade is learned on the job or not at all.",
      },
      {
        name: "Vocational Grants",
        description: "Vocational grants support the trade schools and their evening classes.",
        incomeCostFraction: 0.0009,
      },
      {
        name: "Veterans and Trades Program",
        description:
          "Veterans training joined to the trades program — the readjustment benefits as a national skills engine.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "National Retraining System",
        description:
          "A national retraining system: an open entitlement to learn a new trade at federal expense.",
        incomeCostFraction: 0.0034,
      },
      {
        name: "Universal Skills Guarantee",
        description:
          "The universal skills guarantee: lifetime reskilling rights for every worker the economy reshuffles.",
        incomeCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "us.education.attainment.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.attainment",
        weight: 1,
      },
    ],
    title: "National Attainment and Literacy Act",
    description: "Campaigns and completion machinery lifting what the population actually attains.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "Attainment goes untracked; who finishes school is nobody's statistic.",
      },
      {
        name: "Literacy Campaigns",
        description: "Adult literacy drives take the alphabet to the mill towns and the hollows.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Completion Programs",
        description:
          "Completion programs: dropout prevention and night schools catching the early leavers.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Attainment Standards",
        description:
          "Attainment standards: completion targets with the counselors and stipends to meet them.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Universal Attainment Drive",
        description:
          "A universal attainment drive: a national completion guarantee from first grade to diploma.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "us.education.research.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.research",
        weight: 1,
      },
    ],
    title: "National Science and Research Act",
    description:
      "The federal scientific establishment, from a grants foundation to full mobilization.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Science",
        description:
          "The federal government funds no research; science lives on tuition and patronage.",
      },
      {
        name: "Science Foundation",
        description: "A science foundation makes basic-research grants on peer review.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Research Establishment",
        description: "The research establishment: national laboratories and fellowship pipelines.",
        gdpCostFraction: 0.00063,
      },
      {
        name: "National Research Drive",
        description:
          "A national research drive: mission programs and big facilities aimed at named problems.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Scientific Mobilization",
        description:
          "Scientific mobilization: the apex national effort, with no discipline left unfunded.",
        gdpCostFraction: 0.0023,
      },
    ],
  },
  {
    id: "us.education.standards.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.standards",
        weight: 1,
      },
    ],
    title: "Academic Standards Commission Act",
    description: "How rigorous and how national the academic standards regime is.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No National Standards",
        description: "Standards are wholly local; a diploma means what its county says it means.",
      },
      {
        name: "Advisory Standards",
        description:
          "Advisory standards: model curricula and voluntary examinations for districts that want them.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Accreditation System",
        description:
          "An accreditation system inspects and certifies schools against published criteria.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "National Examinations",
        description:
          "National examinations with stakes: common tests that colleges and employers actually read.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Rigorous National Regime",
        description:
          "A rigorous national regime: binding standards, honors tracks, and no district exempt.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "us.education.choice.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "education.choice",
        weight: 1,
      },
    ],
    title: "Educational Choice and Charter Act",
    description: "Alternatives to assigned schooling, from transfer rights to portable funding.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 0,
    levels: [
      {
        name: "Assigned Schooling",
        description:
          "Assignment is destiny: the district line decides the school, and no federal program says otherwise.",
      },
      {
        name: "Transfer Rights",
        description: "Transfer rights protect open enrollment across district lines.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Scholarship Programs",
        description: "Means-tested scholarships open private doors to public-school families.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Charter Framework",
        description:
          "A charter framework funds alternatives operating outside the district monopoly.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Full Choice System",
        description:
          "The full choice system: portable funding and an open sector, the dollar following the child.",
        gdpCostFraction: 0.0014,
      },
    ],
  },
  {
    id: "us.health.universalCare.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.universalCare",
        weight: 1,
      },
    ],
    title: "Public Health Coverage Act",
    description:
      "The reach of publicly guaranteed care, from charity clinics to national insurance.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Public Coverage",
        description:
          "Access to care is wholly private; the uninsured negotiate with the hospital at the door.",
      },
      {
        name: "Safety-Net Clinics",
        description: "Safety-net clinics serve the indigent in the public wards.",
        incomeCostFraction: 0.00215,
      },
      {
        name: "Coverage for the Aged",
        description:
          "Public insurance covers the aged — the actuarially untouchable, taken onto the public books.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Broad Public Coverage",
        description:
          "Broad public coverage: elders, the poor, and children under one federal umbrella.",
        incomeCostFraction: 0.0144,
      },
      {
        name: "Universal Coverage",
        description:
          "Universal coverage: national health insurance for every resident, cradle to grave.",
        incomeCostFraction: 0.0247,
      },
    ],
  },
  {
    id: "us.health.socialInsurance.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 1,
      },
    ],
    title: "Old-Age and Survivors Insurance Act",
    description: "The contributory pension system and how much of life's risks it insures.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Insurance",
        description:
          "No federal insurance exists; old age is a family matter and a poorhouse fallback.",
      },
      {
        name: "Foundation Pensions",
        description: "Foundation pensions cover the industrial workforce, narrowly.",
        incomeCostFraction: 0.0054,
      },
      {
        name: "Expanded Insurance",
        description:
          "Survivors' benefits and broader coverage bring the widow and the farmhand into the system.",
        incomeCostFraction: 0.0097,
      },
      {
        name: "Comprehensive Insurance",
        description:
          "Comprehensive insurance: disability added and benefits raised toward adequacy.",
        incomeCostFraction: 0.0158,
      },
      {
        name: "Full Social Insurance",
        description:
          "Full social insurance: universal coverage at an adequacy standard a retiree can live on.",
        incomeCostFraction: 0.0233,
      },
    ],
    budgetKeyOverride: "socialSecurity",
  },
  {
    id: "us.health.prevention.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.prevention",
        weight: 1,
      },
    ],
    title: "Public Health and Vaccination Act",
    description: "The public-health service: vaccination, screening, and epidemic readiness.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Program",
        description:
          "Prevention is a local option; the epidemic meets whatever the county health officer can muster.",
      },
      {
        name: "Disease Control Service",
        description:
          "A disease-control service stands ready — the epidemic response corps with its field kits.",
        incomeCostFraction: 0.0005,
      },
      {
        name: "Vaccination Campaigns",
        description:
          "Mass vaccination campaigns carry immunization to the schoolhouse and the county fair.",
        incomeCostFraction: 0.00126,
      },
      {
        name: "Preventive Network",
        description:
          "The preventive network: screening programs and maternal services across the states.",
        incomeCostFraction: 0.0025,
      },
      {
        name: "Total Prevention System",
        description:
          "A total prevention system: universal preventive care, from the well-baby visit to the water supply.",
        incomeCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "us.health.outcomes.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.outcomes",
        weight: 1,
      },
    ],
    title: "Hospitals and Medical Research Act",
    description: "Hospital capacity and the research institutes attacking the big killers.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Investment",
        description:
          "Outcomes are the market's business; the federal government builds no wards and studies no diseases.",
      },
      {
        name: "Hospital Grants",
        description: "Hospital construction grants raise capacity where the map shows none.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Hospitals and Institutes",
        description:
          "Construction plus research institutes: beds for today and laboratories for the big killers.",
        gdpCostFraction: 0.001,
      },
      {
        name: "National Health Campaign",
        description:
          "A national health campaign: disease-mission programs with budgets to match the mortality tables.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Outcomes Guarantee",
        description:
          "The outcomes guarantee: national mortality targets, and the funding accountable to them.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "us.health.responsibility.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.responsibility",
        weight: 1,
      },
    ],
    title: "Benefit Integrity and Work Test Act",
    description: "How conditional public benefits are — verification, targeting, work tests.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Conditions",
        description: "Benefits flow unconditionally; the check asks no questions.",
      },
      {
        name: "Basic Verification",
        description: "Basic verification: eligibility checked before the first payment.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Targeting Regime",
        description: "A targeting regime: means tests and fraud units guarding the rolls.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Work Requirements",
        description:
          "Work requirements with enforcement — the benefit is conditioned on the job search that must accompany it.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Strict Conditionality",
        description:
          "Strict conditionality: a comprehensive conditions regime on every dollar of public assistance.",
        gdpCostFraction: 0.00055,
      },
    ],
  },
  {
    id: "us.health.providerChoice.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.providerChoice",
        weight: 1,
      },
    ],
    title: "Private Coverage and Provider Choice Act",
    description: "The rules that let private coverage and provider choice flourish.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Framework",
        description:
          "Private coverage grows unstructured; the group plan is a handshake between employer and insurer.",
      },
      {
        name: "Group-Plan Framework",
        description:
          "The group-plan framework settles tax treatment, and the employer plan becomes an institution.",
        gdpCostFraction: 0.00008,
      },
      {
        name: "Choice Protections",
        description:
          "Choice protections: portability and any-provider rules written into the policies.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Competitive Markets",
        description:
          "Competitive markets: interstate plans and posted prices, insurers competing in the open.",
        gdpCostFraction: 0.00033,
      },
      {
        name: "Full Market Charter",
        description:
          "A full market charter: an open national insurance market, regulated lightly and priced plainly.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.health.systemEfficiency.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "health.systemEfficiency",
        weight: 1,
      },
    ],
    title: "Health Administration Efficiency Act",
    description: "The apparatus squeezing more care out of every health dollar.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Efficiency Program",
        description:
          "Administration goes unexamined; the health dollar is spent and nobody asks where.",
      },
      {
        name: "Audit and Standards",
        description: "Cost-reporting standards make the ledgers legible for the first time.",
        gdpCostFraction: 0.00008,
      },
      {
        name: "Efficiency Commission",
        description:
          "An efficiency commission reforms throughput and procurement across the public programs.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Performance Funding",
        description: "Performance funding ties payment to outcomes rather than paperwork.",
        gdpCostFraction: 0.00033,
      },
      {
        name: "Lean System Mandate",
        description:
          "The lean-system mandate: binding efficiency targets across every publicly funded bed and clinic.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.infrastructure.publicHousing.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 1,
      },
    ],
    title: "Public Housing and Rent Act",
    description: "Publicly built housing and the protections around tenants.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Public Housing",
        description:
          "Housing is wholly private; the tenement answers to the landlord and no one else.",
      },
      {
        name: "Slum Clearance Units",
        description:
          "Slum-clearance units replace the condemned blocks, a few thousand doors at a time.",
        incomeCostFraction: 0.0009,
      },
      {
        name: "Public Housing Program",
        description: "The public housing program: authority-built units with statutory rent rules.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "Expanded Construction",
        description:
          "Expanded construction: mass unit targets, cranes over every big-city skyline.",
        incomeCostFraction: 0.0034,
      },
      {
        name: "Universal Housing Duty",
        description:
          "The universal housing duty: guaranteed low-rent access wherever the waiting list forms.",
        incomeCostFraction: 0.0056,
      },
    ],
  },
  {
    id: "us.infrastructure.transit.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.transit",
        weight: 1,
      },
    ],
    title: "Urban and Interstate Transit Act",
    description: "Federal support for railways and urban public transport.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Transit Programs",
        description: "Transit goes unaided; the streetcar company fails on its own schedule.",
      },
      {
        name: "Commuter Assistance",
        description:
          "Targeted operating aid keeps the commuter lines running through the lean years.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Transit Investment",
        description: "Transit investment: federal grants for rolling stock and track.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Metropolitan Systems",
        description:
          "Metropolitan systems co-funded — new subways and commuter networks breaking ground.",
        gdpCostFraction: 0.0017,
      },
      {
        name: "National Transit Network",
        description: "A national transit network: intercity buildout binding the regions by rail.",
        gdpCostFraction: 0.0028,
      },
    ],
  },
  {
    id: "us.infrastructure.utilities.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.utilities",
        weight: 1,
      },
    ],
    title: "Rural Utilities and Communications Act",
    description: "Getting power, water, and telephone lines to every household.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programs",
        description:
          "Connection is left to markets, and the market stops where the line stops paying.",
      },
      {
        name: "Rural Credit Windows",
        description:
          "Rural credit windows lend for electrification where investor-owned utilities will not string wire.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Electrification Program",
        description:
          "The electrification program: co-op loans plus telephone exchanges down the county roads.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Universal Service Drive",
        description: "A universal service drive: power and telephone pushed to every farmstead.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Total Connection Mandate",
        description:
          "The total connection mandate: every household wired, no exceptions in the service maps.",
        gdpCostFraction: 0.0023,
      },
    ],
  },
  {
    id: "us.infrastructure.condition.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.condition",
        weight: 1,
      },
    ],
    title: "Public Works Maintenance Act",
    description: "The unglamorous renewal cycles that keep bridges, dams, and grids sound.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Deferred Maintenance",
        description: "Maintenance is deferred by habit; the bridge is inspected when it falls.",
      },
      {
        name: "Critical Repairs",
        description: "A worst-first repair fund triages the critical spans and dams.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Maintenance Program",
        description: "A maintenance program puts renewal on scheduled cycles with dedicated funds.",
        gdpCostFraction: 0.00126,
      },
      {
        name: "Resilience Standard",
        description:
          "The resilience standard: redundancy and hardening engineered into the lifeline systems.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Gold-Standard Upkeep",
        description:
          "Gold-standard upkeep: condition guaranteed nationwide, inspection to replacement on a fixed clock.",
        gdpCostFraction: 0.0037,
      },
    ],
  },
  {
    id: "us.infrastructure.highways.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.highways",
        weight: 1,
      },
    ],
    title: "Federal Highways Act",
    description: "The federal road-building program, from matching aid to a continental network.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Roads Program",
        description: "Roads are wholly state-funded; the pavement ends at the state line's budget.",
      },
      {
        name: "Federal-Aid Roads",
        description: "Federal-aid matching grants improve the trunk roads the states nominate.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Primary System Program",
        description: "The primary system expands: numbered routes built to common standards.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "National Expressways",
        description:
          "National expressways: the first limited-access network linking the major cities.",
        gdpCostFraction: 0.0031,
      },
      {
        name: "Continental Superhighways",
        description:
          "Continental superhighways: the full interstate buildout, coast to coast on federal concrete.",
        gdpCostFraction: 0.0053,
      },
    ],
  },
  {
    id: "us.infrastructure.ownership.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.ownership",
        weight: 1,
      },
    ],
    title: "Home Loan Guarantee Act",
    description: "Mortgage insurance and guarantees that put ownership in reach.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Guarantee Programs",
        description:
          "Mortgages go unaided; ownership belongs to those who can persuade a banker unassisted.",
      },
      {
        name: "Insurance Fund",
        description: "A mortgage insurance fund takes the default risk the lenders would not.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Guarantee Program",
        description:
          "Broad insurance plus veterans' loans — the guarantee behind the subdivision boom.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Ownership Drive",
        description:
          "An ownership drive: low-down-payment national programs opening the door wide.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Universal Ownership Push",
        description:
          "The universal ownership push: maximal subsidy to owning, the renter converted by policy.",
        gdpCostFraction: 0.0022,
      },
    ],
  },
  {
    id: "us.infrastructure.development.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.development",
        weight: 1,
      },
    ],
    title: "Land Development and Permitting Act",
    description: "How fast ground breaks — permitting speed, with fees flowing back.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Framework",
        description: "Land use is wholly local; the permit queue is the town's own affair.",
      },
      {
        name: "Model Codes",
        description: "Model codes offer voluntary ordinances the towns may copy.",
        gdpCostFraction: 0.00013,
        gdpRevenueFraction: 0.0002,
      },
      {
        name: "Streamlined Permits",
        description: "Streamlined permits put deadlines on federal reviews.",
        gdpCostFraction: 0.0002,
        gdpRevenueFraction: 0.00025,
      },
      {
        name: "Development Zones",
        description:
          "Development zones: pre-approved growth districts where ground breaks on schedule.",
        gdpCostFraction: 0.0003,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Open Building Charter",
        description: "An open building charter: by-right development as the national standard.",
        gdpCostFraction: 0.0004,
        gdpRevenueFraction: 0.0004,
      },
    ],
  },
  {
    id: "us.order.dueProcess.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.dueProcess",
        weight: 1,
      },
    ],
    title: "Due Process and Detention Standards Act",
    description: "Procedural fairness and humane detention as enforced federal standards.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Standards",
        description:
          "Detention and process go federally unregulated; the county jail answers to the county.",
      },
      {
        name: "Basic Protections",
        description: "Basic protections enforced: counsel and habeas made real in federal review.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Detention Standards",
        description:
          "Detention standards: inspected jails and review boards behind every cell door.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Strong Process Rights",
        description:
          "Strong process rights: exclusionary rules and oversight that make shortcuts expensive.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Full Rights Charter",
        description:
          "The full rights charter: comprehensive procedural guarantees, federally enforced everywhere.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "us.order.legalAid.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.legalAid",
        weight: 1,
      },
    ],
    title: "Legal Services Access Act",
    description: "Whether ordinary citizens can obtain counsel and redress.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 0,
    levels: [
      {
        name: "No Legal Aid",
        description: "Counsel belongs to those who pay for it; the courtroom door has a fee.",
      },
      {
        name: "Defender Offices",
        description: "Defender offices take the indigent's criminal cases.",
        incomeCostFraction: 0.0004,
      },
      {
        name: "Legal Aid Program",
        description:
          "Legal aid extends to civil matters — the eviction and the wage claim get a lawyer too.",
        incomeCostFraction: 0.0009,
      },
      {
        name: "Access Guarantee",
        description: "An access guarantee: counsel broadly guaranteed at public expense.",
        incomeCostFraction: 0.0016,
      },
      {
        name: "Universal Legal Service",
        description:
          "The universal legal service: full public representation in any forum, free at the point of need.",
        incomeCostFraction: 0.0025,
      },
    ],
  },
  {
    id: "us.order.communityTrust.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.communityTrust",
        weight: 1,
      },
    ],
    title: "Police Standards and Oversight Act",
    description: "The training and oversight that make policing trusted.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Oversight",
        description:
          "Police conduct goes unexamined; the department investigates itself, when it investigates.",
      },
      {
        name: "Training Standards",
        description: "Professional training grants raise the standard of the academy.",
        gdpCostFraction: 0.00008,
      },
      {
        name: "Complaint Machinery",
        description: "Complaint machinery: civilian boards with dockets and published findings.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Accountability Regime",
        description: "An accountability regime: independent investigations with real consequences.",
        gdpCostFraction: 0.00033,
      },
      {
        name: "Full Consent Model",
        description:
          "The full consent model: community-governed policing, trusted because it answers.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.order.safety.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.safety",
        weight: 1,
      },
    ],
    title: "Public Safety Grants Act",
    description: "Federal money aimed directly at everyday safety.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Support",
        description: "Safety is wholly local; the federal government neither funds nor asks.",
      },
      {
        name: "Targeted Grants",
        description: "Targeted grants reach the high-crime precincts and the overwhelmed sheriffs.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Safety Program",
        description: "A safety program pairs prevention funding with juvenile diversion.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "National Safety Drive",
        description:
          "A national safety drive: comprehensive crime programming across prevention, policing, and parole.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Safety Guarantee",
        description:
          "The total safety guarantee: maximal prevention investment down to the streetlight.",
        gdpCostFraction: 0.0017,
      },
    ],
  },
  {
    id: "us.order.courts.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.courts",
        weight: 1,
      },
    ],
    title: "Judiciary Capacity Act",
    description: "Judges, clerks, and courtrooms enough to clear the docket.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Starved Courts",
        description: "The dockets grow untended; a civil trial date is measured in years.",
      },
      {
        name: "Judgeship Expansion",
        description: "Judgeship expansion adds seats and clerks where the backlog is worst.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Court Modernization",
        description: "Court modernization: procedure reform and facilities fit for the caseload.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Speedy Docket Standard",
        description:
          "The speedy-docket standard: time-to-trial targets, funded rather than merely announced.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Full Capacity Guarantee",
        description: "The full capacity guarantee: justice without queues in every district.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "us.order.policeStrength.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.policeStrength",
        weight: 1,
      },
    ],
    title: "Federal Law Enforcement Act",
    description: "The strength and reach of federal law enforcement.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Minimal Federal Force",
        description: "Federal enforcement is token; the bureau is a directory entry.",
      },
      {
        name: "Bureau Foundations",
        description: "Bureau foundations: the investigative service funded and staffed.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Bureau Expansion",
        description: "Bureau expansion: laboratories, agents, and coordination with the states.",
        gdpCostFraction: 0.00063,
      },
      {
        name: "National Enforcement Web",
        description:
          "A national enforcement web: joint task forces knitting federal and local power.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Maximum Enforcement",
        description:
          "Maximum enforcement: saturation federal capacity, no jurisdiction beyond reach.",
        gdpCostFraction: 0.0017,
      },
    ],
  },
  {
    id: "us.order.deterrence.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "order.deterrence",
        weight: 1,
      },
    ],
    title: "Sentencing and Corrections Act",
    description: "How severe and how certain punishment is.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Policy",
        description: "Sentencing is wholly judicial; punishment varies by courtroom and mood.",
      },
      {
        name: "Corrections Standards",
        description: "Corrections standards fund prison capacity and basic rules.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Firm Sentencing",
        description: "Firm sentencing: guidelines plus the cells to make them real.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Severe Regime",
        description: "A severe regime: mandatory minimums enforced without judicial discount.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Maximum Deterrence",
        description:
          "Maximum deterrence: the certainty-and-severity doctrine applied without apology.",
        gdpCostFraction: 0.0023,
      },
    ],
  },
  {
    id: "us.environment.conservation.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.conservation",
        weight: 1,
      },
    ],
    title: "Pollution Control Act",
    description: "Limits on what industry may put into air, water, and soil.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Controls",
        description:
          "Discharge is unrestrained; the river carries whatever the outfall pipe delivers.",
      },
      {
        name: "Nuisance Abatement",
        description: "Nuisance abatement takes the worst single sources to court.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Discharge Permits",
        description: "A discharge-permit regime: outflows licensed, measured, and capped.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Strict Limits",
        description:
          "Strict limits: binding emission ceilings with penalties that outrun the savings of cheating.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Total Stewardship",
        description:
          "Total stewardship: a sweeping conservation regime over air, water, and soil alike.",
        gdpCostFraction: 0.0022,
      },
    ],
  },
  {
    id: "us.environment.stewardship.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.stewardship",
        weight: 1,
      },
    ],
    title: "Public Lands and Reclamation Act",
    description: "Managing the public estate — parks, forests, rivers, and reclaimed land.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Lands Unmanaged",
        description: "The public estate goes unmanaged; the parks weather and the rangelands blow.",
      },
      {
        name: "Parks and Forests",
        description:
          "Parks and forests get a basic management corps — rangers, fire crews, and trail gangs.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Reclamation Program",
        description:
          "The reclamation program: dams, irrigation districts, and a park service with a budget.",
        gdpCostFraction: 0.00176,
      },
      {
        name: "Watershed Stewardship",
        description:
          "Watershed stewardship: soil conservation and river-basin programs working whole valleys.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Continental Stewardship",
        description:
          "Continental stewardship: maximal land-and-water programs across the public estate.",
        gdpCostFraction: 0.0047,
      },
    ],
  },
  {
    id: "us.environment.urbanAir.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.urbanAir",
        weight: 1,
      },
    ],
    title: "Urban Air and Sanitation Act",
    description: "The fight against smoke, smog, and filth in the cities.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 0,
    levels: [
      {
        name: "No Program",
        description: "City air is unregulated; the smoke is the smell of payroll.",
      },
      {
        name: "Smoke Ordinances",
        description: "Smoke-abatement assistance funds the first city ordinances.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Clean-Air Districts",
        description: "Clean-air districts: smokeless zones and modern refuse systems.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Urban Air Standards",
        description: "Urban air standards: binding city limits with monitors and fines.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Healthy Cities Charter",
        description:
          "A healthy-cities charter: the comprehensive urban environment, air to alleys.",
        gdpCostFraction: 0.0014,
      },
    ],
  },
  {
    id: "us.environment.energySecurity.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.energySecurity",
        weight: 1,
      },
    ],
    title: "Power Generation and Grid Act",
    description: "Keeping the lights on: reserves, federal power, and grid strength.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Federal Power Role",
        description:
          "Generation is wholly private; reserve margins are a shareholder's judgment call.",
      },
      {
        name: "Strategic Reserves",
        description: "Strategic fuel stockpiles cushion the first shock.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Public Power Program",
        description: "The public power program: federal dams generating beside the stockpiles.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Grid Modernization",
        description: "Grid modernization: interconnection and capacity built ahead of demand.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Energy Independence Drive",
        description:
          "The energy independence drive: maximal supply security, whatever the ratepayer must carry.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "us.environment.resourceDev.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.resourceDev",
        weight: 1,
      },
    ],
    title: "Domestic Resources Development Act",
    description: "Developing domestic energy and minerals — royalties return at higher levels.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Development Program",
        description: "Resources sit undeveloped; the survey maps end where the funding did.",
      },
      {
        name: "Survey and Mapping",
        description: "The geological survey maps the domestic endowment.",
        gdpCostFraction: 0.0003,
        gdpRevenueFraction: 0.0001,
      },
      {
        name: "Development Program",
        description:
          "A development program: exploration incentives pulling capital into the ground.",
        gdpCostFraction: 0.00076,
        gdpRevenueFraction: 0.0004,
      },
      {
        name: "Production Drive",
        description: "A production drive: output targets and credit for the mines and fields.",
        gdpCostFraction: 0.0013,
        gdpRevenueFraction: 0.0006,
      },
      {
        name: "Maximum Extraction Push",
        description:
          "The maximum extraction push: all-out domestic production, royalties flowing back to the treasury.",
        gdpCostFraction: 0.002,
        gdpRevenueFraction: 0.0008,
      },
    ],
  },
  {
    id: "us.environment.affordability.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.affordability",
        weight: 1,
      },
    ],
    title: "Energy Price Stability Act",
    description: "Keeping household and industrial energy affordable.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Price Programs",
        description: "Fuel prices go unmanaged; the household heats at the market's pleasure.",
      },
      {
        name: "Monitoring and Relief",
        description: "A price watch plus hardship relief for the coldest winters.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Stability Mechanisms",
        description: "Stability mechanisms: buffer stocks and tariff review smoothing the spikes.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Household Fuel Support",
        description: "Household fuel support: an assistance program for the heating bill.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Guaranteed Affordability",
        description:
          "Guaranteed affordability: broad price guarantees on household and industrial energy.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "us.environment.extraction.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "environment.extraction",
        weight: 1,
      },
    ],
    title: "Mineral Rights and Leasing Act",
    description: "How freely the subsurface may be developed — leases pay the treasury back.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Lands Closed",
        description: "The subsurface is closed; no leasing program exists to open it.",
      },
      {
        name: "Leasing Windows",
        description: "Conventional leasing rounds open acreage on standard terms.",
        gdpCostFraction: 0.00005,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Streamlined Leasing",
        description: "Streamlined leasing: fast rounds and royalty relief for early movers.",
        gdpCostFraction: 0.00008,
        gdpRevenueFraction: 0.0005,
      },
      {
        name: "Open Access Regime",
        description: "An open-access regime: broad acreage offered under light review.",
        gdpCostFraction: 0.0001,
        gdpRevenueFraction: 0.0007,
      },
      {
        name: "Maximum Access Charter",
        description:
          "The maximum access charter: near-unrestricted development, with the treasury collecting the rent.",
        gdpCostFraction: 0.00013,
        gdpRevenueFraction: 0.0008,
      },
    ],
  },
  {
    id: "us.society.integration.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.integration",
        weight: 1,
      },
    ],
    title: "Equal Rights Enforcement Act",
    description:
      "The federal machinery enforcing equal standing among racial and ethnic communities.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Enforcement",
        description: "Discrimination goes unaddressed; the law observes and declines to intervene.",
      },
      {
        name: "Federal Contracts Rule",
        description:
          "The federal-contracts rule: nondiscrimination wherever public money is spent.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Civil Rights Division",
        description: "A civil rights division litigates and enforces case by case.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Desegregation Mandate",
        description:
          "The desegregation mandate: active enforcement, marshals included where needed.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Full Equality Charter",
        description:
          "The full equality charter: comprehensive rights enforcement in every public sphere.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "us.society.womensOpportunity.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.womensOpportunity",
        weight: 1,
      },
    ],
    title: "Women's Bureau and Family Support Act",
    description: "Women's access to work and the support structures behind families.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "Opportunity goes unaddressed; the want ads say which jobs are whose.",
      },
      {
        name: "Women's Bureau",
        description: "The women's bureau sets standards and argues the case with data.",
        incomeCostFraction: 0.0011,
      },
      {
        name: "Equal Pay Rules",
        description: "Equal-pay rules enforced: the wage gap becomes a legal liability.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Childcare Network",
        description: "A childcare network: public nurseries making the workday possible.",
        incomeCostFraction: 0.004,
      },
      {
        name: "Full Opportunity System",
        description:
          "The full opportunity system: comprehensive support from hiring desk to nursery door.",
        incomeCostFraction: 0.0063,
      },
    ],
  },
  {
    id: "us.society.socialMobility.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.socialMobility",
        weight: 1,
      },
    ],
    title: "Opportunity and Advancement Act",
    description: "Ladders that let anyone rise regardless of birth.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "Advancement is unaided; the ladder belongs to those born on it.",
      },
      {
        name: "Scholarship Ladders",
        description: "Merit scholarship ladders lift the talented past the tuition wall.",
        incomeCostFraction: 0.0011,
      },
      {
        name: "Advancement Programs",
        description: "Advancement programs: scholarships joined to placement and counseling.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Mobility Guarantee",
        description:
          "A mobility guarantee: first-generation support from application through first job.",
        incomeCostFraction: 0.0038,
      },
      {
        name: "Open Society Drive",
        description: "The open society drive: maximal opportunity machinery, biography be damned.",
        incomeCostFraction: 0.0058,
      },
    ],
  },
  {
    id: "us.society.demography.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.demography",
        weight: 1,
      },
    ],
    title: "Population and Census Programs Act",
    description: "The state's attention to who the nation is becoming.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Count Only",
        description: "Only the decennial count exists; the nation learns who it is once a decade.",
      },
      {
        name: "Demographic Service",
        description:
          "A demographic service: vital statistics collected and published continuously.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Family Programs",
        description: "Family programs support household formation with credits and services.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Population Policy",
        description: "An active population policy balances regions and generations deliberately.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Full Demographic Policy",
        description:
          "Full demographic policy: a comprehensive population strategy with targets and programs.",
        gdpCostFraction: 0.0028,
      },
    ],
  },
  {
    id: "us.society.civicLife.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.civicLife",
        weight: 1,
      },
    ],
    title: "Civic Institutions Support Act",
    description: "The scaffolding under clubs, charities, and civic associations.",
    category: "society",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Support",
        description: "Associations go unaided; the lodge hall stands or falls on dues.",
      },
      {
        name: "Charitable Framework",
        description: "The charitable framework: tax treatment that lets giving compound.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Community Facilities",
        description: "Community facilities: halls and libraries co-funded with the towns.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Civic Corps",
        description: "A civic corps: national service programs staffing the associations' work.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Civic Renaissance Drive",
        description: "The civic renaissance drive: maximal support for the associational nation.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "us.society.familyStability.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.familyStability",
        weight: 1,
      },
    ],
    title: "Family Allowance and Child Welfare Act",
    description: "Direct support for forming and keeping families together.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Family Programs",
        description: "Families are unsupported; the household budget is nobody's policy.",
      },
      {
        name: "Child Welfare Services",
        description: "Dependent-children aid reaches the households the breadwinner left.",
        incomeCostFraction: 0.0014,
      },
      {
        name: "Family Allowances",
        description: "Family allowances: a per-child payment to every household.",
        incomeCostFraction: 0.0032,
      },
      {
        name: "Family Support System",
        description:
          "The family support system: allowances plus housing priority for growing families.",
        incomeCostFraction: 0.0058,
      },
      {
        name: "Full Family Charter",
        description:
          "The full family charter: comprehensive family policy from allowance to inheritance.",
        incomeCostFraction: 0.009,
      },
    ],
  },
  {
    id: "us.society.tradition.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "society.tradition",
        weight: 1,
      },
    ],
    title: "Heritage and National Observances Act",
    description: "Monuments, observances, and the institutions of shared identity.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "Heritage goes unattended; the monuments weather and the archives molder.",
      },
      {
        name: "National Observances",
        description: "National observances: ceremonies and monuments kept in dignified repair.",
        gdpCostFraction: 0.00005,
      },
      {
        name: "Heritage Programs",
        description: "Heritage programs: historic preservation with money behind the plaques.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Civic Tradition Drive",
        description: "A civic tradition drive: curricula and commissions tending the shared story.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "National Identity Charter",
        description:
          "The national identity charter: maximal heritage investment, memory as infrastructure.",
        gdpCostFraction: 0.0003,
      },
    ],
  },
  {
    id: "us.governance.participation.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.participation",
        weight: 1,
      },
    ],
    title: "Federal Elections Administration Act",
    description: "The federal hand in who can vote and how easily.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Federal Role",
        description: "Elections are wholly state-run; the franchise varies by county line.",
      },
      {
        name: "Standards and Statistics",
        description:
          "Standards and statistics: federal reporting that at least counts the counted.",
        gdpCostFraction: 0.00005,
      },
      {
        name: "Registration Support",
        description: "Registration support: federal assistance getting voters onto the rolls.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Access Enforcement",
        description: "Access enforcement: ballot-access protections with federal remedies.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Full Participation Charter",
        description:
          "The full participation charter: universal registration, the franchise made administrative fact.",
        gdpCostFraction: 0.0003,
      },
    ],
  },
  {
    id: "us.governance.openness.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.openness",
        weight: 1,
      },
    ],
    title: "Public Records and Information Act",
    description: "How much of the government's business the public may see.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Official Silence",
        description:
          "Official silence is the default; records are closed unless someone powerful wants them open.",
      },
      {
        name: "Publication Rules",
        description: "Publication rules: registers and gazettes disclosing the formal acts.",
        gdpCostFraction: 0.00005,
      },
      {
        name: "Records Access",
        description: "Records access: request rights with independent review.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Open Government Standard",
        description: "The open-government standard: disclosure by default, secrecy argued for.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Radical Transparency",
        description: "Radical transparency: a comprehensive openness regime across the executive.",
        gdpCostFraction: 0.0003,
      },
    ],
  },
  {
    id: "us.governance.localAutonomy.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.localAutonomy",
        weight: 1,
      },
    ],
    title: "Intergovernmental Grants Act",
    description: "The money and discretion Washington sends to the states.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Grant System",
        description: "No grant system exists; the states fund themselves or do without.",
      },
      {
        name: "Categorical Grants",
        description: "Categorical grants fund narrow named programs on federal terms.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Grant Partnership",
        description:
          "The grant partnership: a broad categorical system threading federal money statewide.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Block Grants",
        description: "Block grants: flexible funds the states direct themselves.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Revenue Sharing",
        description: "Revenue sharing: general-purpose transfers, no strings worth mentioning.",
        gdpCostFraction: 0.002,
      },
    ],
  },
  {
    id: "us.governance.integrity.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.integrity",
        weight: 1,
      },
    ],
    title: "Ethics and Audit Act",
    description: "Auditors, inspectors, and the rules that keep the state honest.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Watchdogs",
        description: "Conduct goes unpoliced; the till is guarded by conscience alone.",
      },
      {
        name: "Audit Office",
        description: "An audit office examines the accounts and publishes what it finds.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Ethics Enforcement",
        description: "Ethics enforcement: conflict rules with penalties attached.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Anticorruption Regime",
        description: "An anticorruption regime: inspectors general in every department.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Glass-House Standard",
        description:
          "The glass-house standard: maximal integrity apparatus, every official auditable on demand.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "us.governance.administration.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.administration",
        weight: 1,
      },
    ],
    title: "Civil Service and Administration Act",
    description: "The professionalism and efficiency of the federal machine itself.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Spoils System",
        description: "The spoils system staffs the government; competence is a coincidence.",
      },
      {
        name: "Merit Foundations",
        description: "Merit foundations: competitive examinations guard the door.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Professional Service",
        description:
          "A professional service: the classified merit system covering the working government.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Modern Administration",
        description: "Modern administration: management reform and training as standing functions.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Administrative Excellence",
        description: "Administrative excellence: the apex professional state, envied and imitated.",
        gdpCostFraction: 0.0038,
      },
    ],
  },
  {
    id: "us.governance.decisiveness.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.decisiveness",
        weight: 1,
      },
    ],
    title: "Executive Organization Act",
    description: "How quickly and coherently the executive can decide and act.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Fragmented Executive",
        description: "The departments pull apart; coordination happens by accident or not at all.",
      },
      {
        name: "Coordination Offices",
        description: "Coordination offices: budget and policy staffs imposing a common arithmetic.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Organized Presidency",
        description:
          "The organized presidency: an executive office that can actually see the whole board.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Streamlined Command",
        description: "Streamlined command: reorganization authority to redraw the boxes at will.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Decisive Executive",
        description:
          "The decisive executive: maximal coherence, one administration speaking with one voice.",
        gdpCostFraction: 0.0006,
      },
    ],
  },
  {
    id: "us.governance.centralAuthority.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "governance.centralAuthority",
        weight: 1,
      },
    ],
    title: "Federal Supremacy and Enforcement Act",
    description: "Whether federal law actually governs everywhere it claims to.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Weak Center",
        description: "The federal writ barely runs; states comply when convenient.",
      },
      {
        name: "Enforcement Capacity",
        description: "Enforcement capacity: marshals and compliance suits behind federal law.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Assured Supremacy",
        description: "Assured supremacy: federal law reliably enforced in every state.",
        gdpCostFraction: 0.00038,
      },
      {
        name: "Strong Center",
        description: "A strong center: preemption used deliberately and often.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Commanding Center",
        description:
          "The commanding center: maximal federal authority, the states as administrative districts in all but name.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "us.defense.diplomacy.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.diplomacy",
        weight: 1,
      },
    ],
    title: "Foreign Service and Negotiations Act",
    description: "The diplomatic corps and the negotiations it can sustain.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Skeleton Service",
        description: "A skeleton service: minimal missions, and cables that go unanswered.",
      },
      {
        name: "Professional Service",
        description:
          "A professional service: staffed embassies and a treaty corps that closes agreements.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Global Diplomacy",
        description: "Global diplomacy: worldwide presence and a seat at every arms table.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Diplomatic Offensive",
        description:
          "The diplomatic offensive: conferences convened and standing envoys everywhere that matters.",
        gdpCostFraction: 0.0048,
      },
      {
        name: "Pax Americana Diplomacy",
        description:
          "Pax Americana diplomacy: maximal reach, the world's agenda drafted in Washington.",
        gdpCostFraction: 0.0072,
      },
    ],
  },
  {
    id: "us.defense.institutions.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.institutions",
        weight: 1,
      },
    ],
    title: "International Organizations and Assistance Act",
    description: "Standing in the international bodies and the aid that comes with leadership.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Memberships",
        description: "Outside the institutions: no memberships, no dues, no say.",
      },
      {
        name: "Member in Standing",
        description: "A member in standing: dues paid and delegations seated.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Institutional Leadership",
        description: "Institutional leadership: agencies led and aid attached to the dues.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "System Architect",
        description: "The system architect: institutions shaped, funded, and steered.",
        gdpCostFraction: 0.004,
      },
      {
        name: "Order Underwriter",
        description:
          "The order's underwriter: the system's chief financier, and its chief beneficiary.",
        gdpCostFraction: 0.006,
      },
    ],
  },
  {
    id: "us.defense.softPower.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.softPower",
        weight: 1,
      },
    ],
    title: "Information and Cultural Exchange Act",
    description: "The nation's voice and image projected abroad.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "No voice abroad; the nation's case goes unargued on every frequency.",
      },
      {
        name: "Broadcasting Service",
        description: "An international broadcasting service carries the signal over the jamming.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Information Agency",
        description:
          "An information agency: broadcasting plus exchanges of students and symphonies.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Cultural Offensive",
        description:
          "The cultural offensive: libraries, tours, and scholarships on every continent.",
        gdpCostFraction: 0.0024,
      },
      {
        name: "Global Persuasion Drive",
        description:
          "The global persuasion drive: maximal cultural projection, the argument made everywhere at once.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "us.defense.security.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.security",
        weight: 1,
      },
    ],
    title: "National Security and Intelligence Act",
    description: "The intelligence and counterintelligence shield.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Apparatus",
        description: "Espionage goes unopposed; the secrets walk out the front door.",
      },
      {
        name: "Security Foundations",
        description: "Security foundations: a counterintelligence bureau on the case.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Security Establishment",
        description: "The security establishment: agencies coordinated and the borders hardened.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Deep Security State",
        description:
          "A deep security state: expansive collection and vetting across government and industry.",
        gdpCostFraction: 0.008,
      },
      {
        name: "Total Vigilance",
        description:
          "Total vigilance: the maximal apparatus, with the loyalty file as a fact of life.",
        gdpCostFraction: 0.0121,
      },
    ],
  },
  {
    id: "us.defense.defenseIndustry.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.defenseIndustry",
        weight: 1,
      },
    ],
    title: "Defense Production and Research Act",
    description: "The industrial and research base behind the armed forces.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Defense Industry Policy",
        description:
          "No defense-industry policy: arms are bought off the shelf, if the shelf has them.",
      },
      {
        name: "Arsenal Maintenance",
        description: "Arsenal maintenance keeps the yards and armories warm.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Production Base",
        description: "A production base sustained: mobilization capacity held ready between wars.",
        gdpCostFraction: 0.0101,
      },
      {
        name: "Research and Production Drive",
        description:
          "The research-and-production drive: jets, rockets, and electronics in serial development.",
        gdpCostFraction: 0.0151,
      },
      {
        name: "Full Mobilization Base",
        description:
          "The full mobilization base: maximal industrial readiness, the arsenal of democracy on retainer.",
        gdpCostFraction: 0.0227,
      },
    ],
  },
  {
    id: "us.defense.armedForces.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.armedForces",
        weight: 1,
      },
    ],
    title: "Armed Forces Establishment Act",
    description: "The size, training, and readiness of the armed forces themselves.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 4,
    levels: [
      {
        name: "Skeleton Force",
        description: "A skeleton force: a constabulary-scale military for a continental nation.",
      },
      {
        name: "Peacetime Cadre",
        description: "A peacetime cadre: a small professional force with a large doctrine.",
        gdpCostFraction: 0.02,
      },
      {
        name: "Standing Forces",
        description: "Standing forces: substantial ready divisions and fleets in commission.",
        gdpCostFraction: 0.0378,
      },
      {
        name: "Large Standing Forces",
        description: "Large standing forces: a major peacetime establishment across every theater.",
        gdpCostFraction: 0.0554,
      },
      {
        name: "Mobilized Establishment",
        description:
          "The mobilized establishment: war-footing manpower and readiness held in peacetime.",
        gdpCostFraction: 0.0756,
      },
    ],
  },
  {
    id: "us.defense.projection.primary",
    countryId: "US",
    kind: "primary",
    targets: [
      {
        metricId: "defense.projection",
        weight: 1,
      },
    ],
    title: "Strategic Forces Act",
    description: "The strategic arm: the deterrent and the reach to project power anywhere.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Strategic Forces",
        description: "No strategic forces: nothing deters, and nothing reaches.",
      },
      {
        name: "Strategic Foundations",
        description: "Strategic foundations: the bomber force and the first stockpile.",
        gdpCostFraction: 0.0076,
      },
      {
        name: "Deterrent Force",
        description: "A deterrent force: a credible strategic arm the adversary must respect.",
        gdpCostFraction: 0.0151,
      },
      {
        name: "Global Strike Posture",
        description: "The global strike posture: thermonuclear forces and bases ringing the globe.",
        gdpCostFraction: 0.0227,
      },
      {
        name: "Overwhelming Superiority",
        description:
          "Overwhelming superiority: maximal strategic dominance, unanswerable by design.",
        gdpCostFraction: 0.0327,
      },
    ],
  },
  {
    id: "us.sec.nationalHighwaysFreight",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "infrastructure.highways",
        weight: 0.5,
      },
      {
        metricId: "infrastructure.condition",
        weight: 0.4,
      },
      {
        metricId: "economy.productivity",
        weight: 0.3,
      },
      {
        metricId: "infrastructure.transit",
        weight: 0.25,
      },
    ],
    title: "National Highways and Freight Act",
    description: "Freight corridors, terminals, and the commerce the road network carries.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No freight program exists; the trucks queue at bottlenecks nobody owns.",
      },
      {
        name: "Corridor Improvements",
        description: "Corridor improvements clear the worst chokepoints on the trunk routes.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Freight Modernization",
        description:
          "Freight modernization: terminals, weigh stations, and standardized corridors.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "National Logistics Drive",
        description: "A national logistics drive: the freight network planned as one system.",
        gdpCostFraction: 0.0032,
      },
      {
        name: "Continental Freight System",
        description:
          "The continental freight system: road, rail, and terminal capacity meshed coast to coast.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "us.sec.servicemensReadjustment",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "education.adultSkills",
        weight: 0.5,
      },
      {
        metricId: "infrastructure.ownership",
        weight: 0.4,
      },
      {
        metricId: "society.socialMobility",
        weight: 0.4,
      },
      {
        metricId: "education.attainment",
        weight: 0.3,
      },
    ],
    title: "Servicemen's Readjustment Act",
    description:
      "The veterans' compact: education, home loans, and a ladder into the middle class.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Veterans Programs",
        description:
          "No veterans programs exist; the discharged serviceman keeps his duffel and his luck.",
      },
      {
        name: "Mustering-Out Benefits",
        description: "Mustering-out benefits: a payment and a bus ticket home.",
        incomeCostFraction: 0.0036,
      },
      {
        name: "Education Benefits",
        description:
          "Education benefits send the veteran to college or trade school on the government's account.",
        incomeCostFraction: 0.0083,
      },
      {
        name: "Full Readjustment Program",
        description:
          "The full readjustment program: education, loan guarantees, and unemployment allowances together.",
        incomeCostFraction: 0.01437,
      },
      {
        name: "Expanded Generations Program",
        description:
          "The expanded generations program: readjustment benefits broadened until they remake the middle class.",
        incomeCostFraction: 0.0215,
      },
    ],
  },
  {
    id: "us.sec.socialInsuranceExpansion",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 0.5,
      },
      {
        metricId: "economy.mobility",
        weight: 0.4,
      },
      {
        metricId: "society.familyStability",
        weight: 0.3,
      },
    ],
    title: "Social Insurance Expansion Act",
    description:
      "Periodic expansions carrying social insurance to farms, domestics, and the self-employed.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Expansion",
        description:
          "No expansion is made; the insurance rolls stay where the original act drew them.",
      },
      {
        name: "Coverage Extension",
        description: "Coverage extension brings new occupations into the system.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "Benefit Uprating",
        description: "Benefit uprating lifts payments toward what groceries actually cost.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Broad Expansion",
        description:
          "Broad expansion: farm and domestic workers, the self-employed — the gaps closed.",
        incomeCostFraction: 0.0079,
      },
      {
        name: "Universal Adequacy Drive",
        description:
          "The universal adequacy drive: everyone covered, and benefits reviewed against real prices.",
        incomeCostFraction: 0.0126,
      },
    ],
    budgetKeyOverride: "socialSecurity",
  },
  {
    id: "us.sec.atomicEnergyProgram",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.energySecurity",
        weight: 0.5,
      },
      {
        metricId: "education.research",
        weight: 0.4,
      },
      {
        metricId: "defense.defenseIndustry",
        weight: 0.4,
      },
      {
        metricId: "defense.security",
        weight: 0.3,
      },
    ],
    title: "Atomic Energy Program Act",
    description: "The atomic establishment: reactors, laboratories, and the materials complex.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Atomic Program",
        description: "No atomic program exists; the physicists' letters go unanswered.",
      },
      {
        name: "Research Reactors",
        description: "Research reactors run at the national laboratories.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Atomic Establishment",
        description:
          "The atomic establishment: a civilian commission over reactors, laboratories, and materials.",
        gdpCostFraction: 0.00378,
      },
      {
        name: "Power and Weapons Complex",
        description: "The power-and-weapons complex: dual-track development at full budget.",
        gdpCostFraction: 0.0063,
      },
      {
        name: "Atomic Age Leadership",
        description:
          "Atomic-age leadership: maximal investment across the whole nuclear enterprise.",
        gdpCostFraction: 0.0095,
      },
    ],
  },
  {
    id: "us.sec.civilRightsEnforcement",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "society.integration",
        weight: 0.5,
      },
      {
        metricId: "order.dueProcess",
        weight: 0.4,
      },
      {
        metricId: "governance.participation",
        weight: 0.4,
      },
      {
        metricId: "order.communityTrust",
        weight: 0.3,
      },
      {
        metricId: "governance.centralAuthority",
        weight: 0.25,
      },
    ],
    title: "Civil Rights Enforcement Act",
    description: "Cross-cutting enforcement of equal rights in voting, process, and public life.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Enforcement Program",
        description:
          "No enforcement program exists; rights are announced and then abandoned to circumstance.",
      },
      {
        name: "Litigation Support",
        description: "Litigation support funds the test cases working through the courts.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Enforcement Commission",
        description: "An enforcement commission investigates, subpoenas, and publishes.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Federal Registrars",
        description:
          "Federal registrars enter the counties where the rolls have been closed by custom.",
        gdpCostFraction: 0.0017,
      },
      {
        name: "Full Enforcement Regime",
        description:
          "The full enforcement regime: rights enforced in voting, process, and public life alike.",
        gdpCostFraction: 0.0025,
      },
    ],
  },
  {
    id: "us.sec.ruralDevelopment",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "infrastructure.utilities",
        weight: 0.5,
      },
      {
        metricId: "economy.mobility",
        weight: 0.3,
      },
      {
        metricId: "environment.stewardship",
        weight: 0.3,
      },
      {
        metricId: "society.demography",
        weight: 0.25,
      },
    ],
    title: "Rural Development and Electrification Act",
    description: "Keeping the countryside connected, productive, and populated.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Program",
        description: "No rural program exists; the countryside empties toward the city lights.",
      },
      {
        name: "Rural Credit",
        description: "Rural credit lends where the banks see only distance and dust.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Rural Development Program",
        description:
          "The rural development program: electrification, water, and farm-to-market roads.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Countryside Modernization",
        description:
          "Countryside modernization: services and industry seeded beyond the city limits.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Rural Renaissance Drive",
        description:
          "The rural renaissance drive: the full apparatus aimed at keeping the countryside alive.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "us.sec.agriculturalParity",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "economy.mobility",
        weight: 0.5,
      },
      {
        metricId: "environment.stewardship",
        weight: 0.4,
      },
      {
        metricId: "economy.stability",
        weight: 0.3,
      },
      {
        metricId: "economy.householdIncome",
        weight: 0.3,
      },
    ],
    title: "Agricultural Support and Parity Act",
    description: "Price supports, soil programs, and the farm household's income floor.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Farm Programs",
        description: "No farm programs exist; the harvest price is the gambler's price.",
      },
      {
        name: "Price Supports",
        description: "Price supports floor the staple crops at the elevator.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "Parity Program",
        description:
          "The parity program: supports pegged to the farm household's purchasing power.",
        incomeCostFraction: 0.0036,
      },
      {
        name: "Comprehensive Farm Policy",
        description:
          "Comprehensive farm policy: supports, soil programs, and credit under one roof.",
        incomeCostFraction: 0.0061,
      },
      {
        name: "Full Parity Guarantee",
        description: "The full parity guarantee: the farm income floor written into permanent law.",
        incomeCostFraction: 0.009,
      },
    ],
  },
  {
    id: "us.sec.urbanRenewal",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 0.5,
      },
      {
        metricId: "infrastructure.development",
        weight: 0.4,
      },
      {
        metricId: "environment.urbanAir",
        weight: 0.3,
      },
      {
        metricId: "order.safety",
        weight: 0.25,
      },
      {
        metricId: "infrastructure.ownership",
        weight: 0.25,
      },
    ],
    title: "Urban Renewal and Housing Act",
    description: "Clearing, rebuilding, and re-planning the industrial city.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No program touches the blocks; the slum ages in place.",
      },
      {
        name: "Slum Clearance",
        description: "Slum clearance levels the condemned acreage.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Renewal Districts",
        description: "Renewal districts: assembled land, new plans, and public-private rebuilding.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Comprehensive Renewal",
        description: "Comprehensive renewal: whole districts re-planned and rebuilt in sequence.",
        gdpCostFraction: 0.0027,
      },
      {
        name: "Cities Rebuilt Drive",
        description:
          "The cities-rebuilt drive: renewal at metropolitan scale, the skyline redrawn by program.",
        gdpCostFraction: 0.004,
      },
    ],
  },
  {
    id: "us.sec.laborManagementRelations",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "economy.workerSecurity",
        weight: 0.5,
      },
      {
        metricId: "economy.productivity",
        weight: 0.3,
      },
      {
        metricId: "economy.stability",
        weight: 0.25,
      },
      {
        metricId: "society.civicLife",
        weight: 0.25,
      },
    ],
    title: "Labor-Management Relations Act",
    description: "The rules of engagement between unions and management.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the struggle; the strike and the lockout write the rules.",
      },
      {
        name: "Mediation Service",
        description: "A mediation service stands between the parties before the walkout.",
        gdpCostFraction: 0.00005,
      },
      {
        name: "Bargaining Framework",
        description:
          "The bargaining framework: elections, certifications, and unfair-practice rules.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Strong Bargaining Order",
        description:
          "A strong bargaining order: duties to bargain enforced on both sides of the table.",
        gdpCostFraction: 0.00018,
      },
      {
        name: "Industrial Peace Charter",
        description:
          "The industrial peace charter: comprehensive machinery that makes the strike the last resort.",
        gdpCostFraction: 0.00025,
      },
    ],
  },
  {
    id: "us.sec.researchFoundation",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "education.research",
        weight: 0.5,
      },
      {
        metricId: "education.attainment",
        weight: 0.3,
      },
      {
        metricId: "defense.defenseIndustry",
        weight: 0.3,
      },
      {
        metricId: "education.standards",
        weight: 0.25,
      },
    ],
    title: "Federal Research Foundation Act",
    description: "The civilian grants foundation seeding university science.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Foundation",
        description: "No foundation exists; university science lives grant to private grant.",
      },
      {
        name: "Grants Office",
        description: "A grants office makes the first federal awards on merit review.",
        gdpCostFraction: 0.00013,
      },
      {
        name: "Research Foundation",
        description:
          "The research foundation: peer-reviewed grants as a standing national institution.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Expanded Fellowships",
        description: "Expanded fellowships put stipends behind the graduate pipeline.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "National Science Push",
        description: "The national science push: foundation funding at scale across every field.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "us.sec.hospitalConstruction",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.universalCare",
        weight: 0.5,
      },
      {
        metricId: "health.outcomes",
        weight: 0.4,
      },
      {
        metricId: "health.prevention",
        weight: 0.35,
      },
    ],
    title: "Hospital Construction Grants Act",
    description: "Matching grants that put a modern hospital within reach of every county.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Grants",
        description: "No grants exist; the county without a hospital stays without one.",
      },
      {
        name: "Rural Hospitals",
        description: "Rural hospitals first: matching grants where the map is emptiest.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Construction Program",
        description: "The construction program: hospitals rising on a planned national schedule.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Regional Networks",
        description: "Regional networks: referral chains linking county wards to city centers.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Universal Bed Standard",
        description: "The universal bed standard: beds per thousand guaranteed in every county.",
        gdpCostFraction: 0.0028,
      },
    ],
  },
  {
    id: "us.sec.interstateCommerce",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 0.5,
      },
      {
        metricId: "economy.productivity",
        weight: 0.3,
      },
      {
        metricId: "governance.administration",
        weight: 0.25,
      },
      {
        metricId: "economy.householdIncome",
        weight: 0.25,
      },
    ],
    title: "Interstate Commerce and Fair Trade Act",
    description: "The commissions refereeing rates, routes, and fair dealing across state lines.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Commission",
        description:
          "No commission referees the traffic; rates are what the strongest road demands.",
      },
      {
        name: "Rate Review",
        description: "Rate review hears the shippers' complaints case by case.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Commerce Commission",
        description:
          "The commerce commission: rates, routes, and fair dealing under standing supervision.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Active Market Policing",
        description: "Active market policing: discrimination and rebating prosecuted as found.",
        gdpCostFraction: 0.00035,
      },
      {
        name: "Open Commerce Charter",
        description:
          "The open commerce charter: fair-dealing rules enforced across every line of interstate trade.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.immigrationNationality",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "society.demography",
        weight: 0.5,
      },
      {
        metricId: "society.integration",
        weight: 0.35,
      },
      {
        metricId: "education.adultSkills",
        weight: 0.25,
      },
      {
        metricId: "society.tradition",
        weight: 0.25,
      },
    ],
    title: "Immigration and Nationality Act",
    description: "Who may come, in what numbers, and how they become Americans.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Closed Borders",
        description: "The borders are closed; entry is the exception and exclusion the rule.",
      },
      {
        name: "Quota System",
        description: "The quota system admits by national origin arithmetic.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Managed Admissions",
        description: "Managed admissions: quotas plus skills and family preferences.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Expanded Admissions",
        description: "Expanded admissions: higher ceilings and wider categories.",
        gdpCostFraction: 0.00033,
      },
      {
        name: "Open Door Policy",
        description: "The open door: admission generous by design, naturalization a paved road.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.justiceAdministration",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "order.courts",
        weight: 0.5,
      },
      {
        metricId: "order.legalAid",
        weight: 0.5,
      },
      {
        metricId: "governance.integrity",
        weight: 0.3,
      },
    ],
    title: "Federal Justice Administration Act",
    description: "Administering the courts as a system — dockets, defenders, and discipline.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Program",
        description:
          "No program funds the machinery; the clerk's office runs on carbon paper and patience.",
      },
      {
        name: "Court Administration",
        description: "Court administration funded: clerks, records, and calendars in order.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Justice Administration",
        description:
          "Justice administration: a professional office managing the courts as a system.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Expanded Access Program",
        description:
          "The expanded access program: defenders, fee waivers, and sessions where the litigants are.",
        gdpCostFraction: 0.00035,
      },
      {
        name: "Model Justice System",
        description:
          "The model justice system: the machinery funded to run without queues or lost files.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.correctionsRehabilitation",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "order.deterrence",
        weight: 0.5,
      },
      {
        metricId: "order.safety",
        weight: 0.35,
      },
      {
        metricId: "order.legalAid",
        weight: 0.25,
      },
      {
        metricId: "order.dueProcess",
        weight: 0.25,
      },
    ],
    title: "Corrections and Rehabilitation Standards Act",
    description: "What happens inside the walls — and whether anyone comes out better.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description: "No standards reach inside the walls; the warden's word is the whole code.",
      },
      {
        name: "Basic Standards",
        description: "Basic standards: capacity, safety, and inspection minimums.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Rehabilitation Programs",
        description: "Rehabilitation programs: education and trade training on the cellblock.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Modern Corrections",
        description:
          "Modern corrections: classification, parole preparation, and professional staff.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Model Corrections System",
        description:
          "The model corrections system: institutions run to published standards, release planned from day one.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "us.sec.investigationsExpansion",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "order.policeStrength",
        weight: 0.5,
      },
      {
        metricId: "order.safety",
        weight: 0.4,
      },
      {
        metricId: "defense.security",
        weight: 0.3,
      },
      {
        metricId: "governance.centralAuthority",
        weight: 0.25,
      },
      {
        metricId: "order.deterrence",
        weight: 0.25,
      },
    ],
    title: "Federal Investigations Expansion Act",
    description:
      "The bureau's reach into organized crime, subversion, and the interstate underworld.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Expansion",
        description: "No expansion is made; the bureau covers the map thinly and knows it.",
      },
      {
        name: "Field Offices",
        description: "Field offices open in the uncovered districts.",
        gdpCostFraction: 0.00008,
      },
      {
        name: "Bureau Expansion",
        description: "Bureau expansion: agents, laboratories, and files at national scale.",
        gdpCostFraction: 0.00018,
      },
      {
        name: "National Task Forces",
        description: "National task forces pool federal and state power against the syndicates.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Saturation Coverage",
        description:
          "Saturation coverage: investigative capacity that closes cases faster than they open.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "us.sec.parksMonuments",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.stewardship",
        weight: 0.5,
      },
      {
        metricId: "environment.conservation",
        weight: 0.5,
      },
      {
        metricId: "society.civicLife",
        weight: 0.25,
      },
    ],
    title: "National Parks and Monuments Act",
    description: "The park system as national inheritance.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Program",
        description: "No program tends the parks; the trails wash out and the lodges close.",
      },
      {
        name: "Parks Maintained",
        description: "The parks are maintained: rangers posted and roads passable.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "System Expansion",
        description: "System expansion: new parks and monuments added to the inheritance.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Mission-Scale Investment",
        description: "Mission-scale investment: visitor works and restoration across the system.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Crown Jewels Standard",
        description: "The crown-jewels standard: the park system kept as the nation's showpiece.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "us.sec.cleanRivers",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.urbanAir",
        weight: 0.5,
      },
      {
        metricId: "environment.conservation",
        weight: 0.4,
      },
      {
        metricId: "health.prevention",
        weight: 0.3,
      },
      {
        metricId: "infrastructure.utilities",
        weight: 0.25,
      },
    ],
    title: "Clean Rivers and Municipal Sanitation Act",
    description: "Sewage works and river cleanups for the industrial age's mess.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No program exists; the river is the industrial city's drain.",
      },
      {
        name: "Treatment Grants",
        description: "Treatment grants fund the first municipal works.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Rivers Program",
        description: "The rivers program: sewage treatment on a basin-by-basin schedule.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Clean Waters Drive",
        description: "The clean waters drive: treatment at every outfall, enforcement behind it.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Every River Swimmable",
        description: "Every river swimmable: the standard set, funded, and meant.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "us.sec.civilDefense",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "defense.security",
        weight: 0.4,
      },
      {
        metricId: "environment.energySecurity",
        weight: 0.3,
      },
      {
        metricId: "infrastructure.condition",
        weight: 0.3,
      },
      {
        metricId: "order.policeStrength",
        weight: 0.25,
      },
      {
        metricId: "governance.decisiveness",
        weight: 0.25,
      },
    ],
    title: "Civil Defense and Preparedness Act",
    description: "Sirens, shelters, and continuity of government for the atomic age.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Program",
        description: "No program exists; the sirens are scrap and the shelters are basements.",
      },
      {
        name: "Warning Systems",
        description: "Warning systems: sirens and spotters wired to a national net.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Preparedness Program",
        description: "The preparedness program: drills, stockpiles, and shelter surveys.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Shelter and Continuity",
        description:
          "Shelter and continuity: hardened basements and a government that can relocate.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Total Preparedness",
        description: "Total preparedness: the whole population drilled for the atomic age.",
        gdpCostFraction: 0.0014,
      },
    ],
  },
  {
    id: "us.sec.votingRightsStandards",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "governance.participation",
        weight: 0.5,
      },
      {
        metricId: "governance.openness",
        weight: 0.3,
      },
      {
        metricId: "governance.integrity",
        weight: 0.3,
      },
      {
        metricId: "governance.localAutonomy",
        weight: 0.25,
      },
    ],
    title: "Voting Rights and Election Standards Act",
    description: "Federal standards for how elections are run and reported.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description: "No standards exist; each county runs the vote as it pleases.",
      },
      {
        name: "Reporting Standards",
        description: "Reporting standards make the results legible and comparable.",
        gdpCostFraction: 0.00008,
      },
      {
        name: "Federal Standards",
        description: "Federal standards fix registration and ballot procedure nationwide.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Enforcement Machinery",
        description: "Enforcement machinery: examiners and observers where standards are flouted.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Full Guarantee Regime",
        description:
          "The full guarantee regime: the franchise administered under federal warranty.",
        gdpCostFraction: 0.0004,
      },
    ],
  },
  {
    id: "us.sec.governmentReorganization",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "governance.administration",
        weight: 0.5,
      },
      {
        metricId: "governance.decisiveness",
        weight: 0.4,
      },
      {
        metricId: "economy.fiscal",
        weight: 0.3,
      },
      {
        metricId: "governance.integrity",
        weight: 0.25,
      },
      {
        metricId: "order.courts",
        weight: 0.25,
      },
    ],
    title: "Government Reorganization Act",
    description: "Commissions with teeth, pruning and rewiring the executive branch.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Authority",
        description: "No authority exists to prune the branch; agencies accrete like coral.",
      },
      {
        name: "Study Commissions",
        description: "Study commissions map the duplication and file their reports.",
        gdpCostFraction: 0.00005,
      },
      {
        name: "Reorganization Authority",
        description:
          "Reorganization authority: the executive may merge and abolish, subject to veto.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Sweeping Consolidation",
        description: "Sweeping consolidation: the branch redrawn wholesale on commission lines.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Continuous Reform Mandate",
        description:
          "The continuous reform mandate: reorganization as a permanent function, not an event.",
        gdpCostFraction: 0.0004,
      },
    ],
  },
  {
    id: "us.sec.publicBroadcasting",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "governance.openness",
        weight: 0.5,
      },
      {
        metricId: "defense.softPower",
        weight: 0.3,
      },
      {
        metricId: "society.civicLife",
        weight: 0.3,
      },
      {
        metricId: "order.communityTrust",
        weight: 0.25,
      },
    ],
    title: "Public Broadcasting and Information Act",
    description: "A public information estate alongside the commercial press.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No program exists; the airwaves belong entirely to the sponsors.",
      },
      {
        name: "Educational Broadcasting",
        description: "Educational broadcasting: reserved channels and small grants.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Public Networks",
        description: "Public networks: stations linked and programmed nationally.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "National Public Media",
        description: "National public media: a funded public estate beside the commercial dial.",
        gdpCostFraction: 0.00035,
      },
      {
        name: "Full Public Service Media",
        description:
          "Full public-service media: the public network as a first-rank national institution.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.mutualSecurity",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "defense.institutions",
        weight: 0.5,
      },
      {
        metricId: "defense.diplomacy",
        weight: 0.4,
      },
      {
        metricId: "defense.softPower",
        weight: 0.4,
      },
    ],
    title: "Mutual Security and Foreign Aid Act",
    description: "Arms, funds, and reconstruction for allies on the front lines.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Aid Programs",
        description: "No aid programs exist; the allies hold the line on their own purse.",
      },
      {
        name: "Relief Assistance",
        description: "Relief assistance: food and fuel for the hardest-pressed friends.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Reconstruction Aid",
        description: "Reconstruction aid rebuilds the allied economies wholesale.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Mutual Security Program",
        description: "The mutual security program: arms and funds fused into one alliance budget.",
        gdpCostFraction: 0.0088,
      },
      {
        name: "Free World Underwriting",
        description:
          "Free-world underwriting: the alliance's economies and arsenals carried on the national ledger.",
        gdpCostFraction: 0.0132,
      },
    ],
  },
  {
    id: "us.sec.collectiveDefense",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "defense.diplomacy",
        weight: 0.5,
      },
      {
        metricId: "defense.armedForces",
        weight: 0.3,
      },
      {
        metricId: "defense.projection",
        weight: 0.3,
      },
      {
        metricId: "defense.institutions",
        weight: 0.3,
      },
    ],
    title: "Collective Defense Treaties Act",
    description: "The treaty architecture binding allies into common defense.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Alliances",
        description: "No alliances bind anyone; each nation faces the hour alone.",
      },
      {
        name: "Regional Pacts",
        description: "Regional pacts pledge consultation and little more.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Alliance System",
        description: "The alliance system: mutual-defense treaties with standing machinery.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Integrated Commands",
        description: "Integrated commands: joint staffs and common war plans.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Global Alliance Web",
        description:
          "The global alliance web: collective defense wherever the flag or a friend stands.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "us.sec.reserveForces",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "defense.armedForces",
        weight: 0.5,
      },
      {
        metricId: "defense.projection",
        weight: 0.35,
      },
      {
        metricId: "defense.defenseIndustry",
        weight: 0.25,
      },
    ],
    title: "Reserve Forces Act",
    description: "The citizen reserve behind the standing force.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reserve System",
        description: "No reserve system exists; the trained men scatter and stay scattered.",
      },
      {
        name: "Organized Reserves",
        description: "Organized reserves drill monthly in the armories.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Ready Reserve System",
        description: "The ready reserve system: units manned, equipped, and callable.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Deep Reserve Structure",
        description:
          "A deep reserve structure: refresher training and mobilization slots for millions.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Nation in Arms",
        description:
          "The nation in arms: every trained citizen registered and assigned against the day.",
        gdpCostFraction: 0.0045,
      },
    ],
  },
  {
    id: "us.sec.strategicStockpiles",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.resourceDev",
        weight: 0.5,
      },
      {
        metricId: "environment.extraction",
        weight: 0.4,
      },
      {
        metricId: "environment.energySecurity",
        weight: 0.3,
      },
    ],
    title: "Strategic Materials Stockpiles Act",
    description: "Warehouses of tungsten, rubber, and oil against the day the sea lanes close.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Stockpiles",
        description: "No stockpiles exist; the war economy would start from an empty warehouse.",
      },
      {
        name: "Critical Materials",
        description: "Critical materials: tungsten, rubber, and tin laid in first.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Strategic Stockpile",
        description: "The strategic stockpile: a full schedule of materials at depth.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Deep Reserves",
        description: "Deep reserves: multi-season stocks against a long interruption.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Total Material Security",
        description: "Total material security: reserves sized for the war nobody schedules.",
        gdpCostFraction: 0.0038,
      },
    ],
  },
  {
    id: "us.sec.mineralGrazingLands",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.extraction",
        weight: 0.5,
      },
      {
        metricId: "environment.resourceDev",
        weight: 0.4,
      },
      {
        metricId: "environment.affordability",
        weight: 0.3,
      },
    ],
    title: "Mineral and Grazing Lands Act",
    description: "The working public lands — grazed, drilled, and paying rent.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Lands Withdrawn",
        description: "The lands are withdrawn; neither pick nor herd may enter.",
      },
      {
        name: "Leasing Program",
        description: "A leasing program opens acreage on standard rents.",
        gdpCostFraction: 0.0001,
        gdpRevenueFraction: 0.0002,
      },
      {
        name: "Expanded Access",
        description: "Expanded access: more acreage, faster rounds.",
        gdpCostFraction: 0.00013,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Development Priority",
        description: "Development priority: the working lands put to work in earnest.",
        gdpCostFraction: 0.00018,
        gdpRevenueFraction: 0.0004,
      },
      {
        name: "Full Multiple Use",
        description:
          "Full multiple use: grazed, drilled, and logged under one management doctrine.",
        gdpCostFraction: 0.00023,
        gdpRevenueFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.fuelPowerRegulation",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "environment.affordability",
        weight: 0.5,
      },
      {
        metricId: "infrastructure.utilities",
        weight: 0.25,
      },
      {
        metricId: "economy.stability",
        weight: 0.25,
      },
    ],
    title: "Fuel and Power Regulation Act",
    description: "Rate boards standing between monopolies and the household bill.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Regulation",
        description: "No regulation exists; the monopoly bills what the monopoly likes.",
      },
      {
        name: "Rate Oversight",
        description: "Rate oversight reviews the worst filings.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Utility Regulation",
        description: "Utility regulation: rate boards with accountants and authority.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Price Stabilization",
        description: "Price stabilization: increases held to demonstrated cost.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Full Price Control",
        description: "Full price control: household energy priced by commission, not by market.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "us.sec.federalAidSchools",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "education.universalSchooling",
        weight: 0.5,
      },
      {
        metricId: "education.teacherCorps",
        weight: 0.5,
      },
      {
        metricId: "education.attainment",
        weight: 0.3,
      },
    ],
    title: "Federal Aid to Schools Act",
    description: "The recurring fight over whether Washington helps pay for the schoolhouse.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Aid",
        description: "No aid flows; the schoolhouse is the district's burden alone.",
      },
      {
        name: "Impacted Areas",
        description: "Impacted-area aid pays where federal installations fill the classrooms.",
        incomeCostFraction: 0.0009,
      },
      {
        name: "General Aid",
        description: "General aid: per-pupil support to every district.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Equalizing Aid",
        description: "Equalizing aid tilts the formula toward the poorest counties.",
        incomeCostFraction: 0.004,
      },
      {
        name: "Full Partnership",
        description:
          "The full partnership: federal money as a permanent pillar of the public school.",
        incomeCostFraction: 0.0061,
      },
    ],
  },
  {
    id: "us.sec.literacyVocational",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "education.standards",
        weight: 0.4,
      },
      {
        metricId: "education.universalSchooling",
        weight: 0.3,
      },
      {
        metricId: "education.adultSkills",
        weight: 0.3,
      },
      {
        metricId: "education.choice",
        weight: 0.25,
      },
    ],
    title: "Literacy and Vocational Standards Act",
    description: "Common yardsticks for what a diploma and a trade card mean.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description:
          "No standards exist; the diploma and the trade card mean what the issuer says.",
      },
      {
        name: "Model Standards",
        description: "Model standards published for schools and trades to adopt.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Certification System",
        description: "A certification system: examined credentials with a registry behind them.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "National Certificates",
        description: "National certificates: one yardstick from coast to coast.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Universal Standards",
        description:
          "Universal standards: every credential examined, registered, and honored alike.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "us.sec.scholarshipsIndependent",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "education.choice",
        weight: 0.5,
      },
      {
        metricId: "society.socialMobility",
        weight: 0.3,
      },
      {
        metricId: "society.tradition",
        weight: 0.25,
      },
      {
        metricId: "education.teacherCorps",
        weight: 0.25,
      },
    ],
    title: "Scholarships and Independent Schools Act",
    description: "Scholarships and the independent-school sector they sustain.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description:
          "No programs exist; the independent school is for those who can write the check.",
      },
      {
        name: "Scholarship Fund",
        description: "A scholarship fund opens a few doors on merit.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Scholarship System",
        description: "The scholarship system: means-tested awards at national scale.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Broad Choice Support",
        description:
          "Broad choice support: scholarships and aid sustaining a genuine independent sector.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Choice Funding",
        description:
          "Full choice funding: the independent sector funded as a public option in all but name.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "us.sec.maternalChildWelfare",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "society.familyStability",
        weight: 0.5,
      },
      {
        metricId: "society.womensOpportunity",
        weight: 0.4,
      },
      {
        metricId: "society.demography",
        weight: 0.3,
      },
    ],
    title: "Maternal and Child Welfare Act",
    description: "Clinics, nurses, and stipends where families begin.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programs",
        description: "No programs exist; birth and infancy are private ventures with private odds.",
      },
      {
        name: "Maternal Services",
        description: "Maternal services: clinics and visiting nurses where families begin.",
        incomeCostFraction: 0.0009,
      },
      {
        name: "Mother and Child Program",
        description: "The mother-and-child program: prenatal care, checkups, and milk funds.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "Family Services System",
        description: "The family services system: one network from pregnancy through school age.",
        incomeCostFraction: 0.0032,
      },
      {
        name: "Universal Family Support",
        description: "Universal family support: every mother and child under the program's watch.",
        incomeCostFraction: 0.005,
      },
    ],
    budgetKeyOverride: "socialSecurity",
  },
  {
    id: "us.sec.fairEmployment",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "society.womensOpportunity",
        weight: 0.5,
      },
      {
        metricId: "society.integration",
        weight: 0.3,
      },
      {
        metricId: "economy.workerSecurity",
        weight: 0.3,
      },
    ],
    title: "Fair Employment Practices Act",
    description: "Who gets hired, and whether the law has anything to say about it.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Commission",
        description: "No commission exists; the hiring line is sorted by prejudice undisturbed.",
      },
      {
        name: "Wartime Rules Continued",
        description: "The wartime rules continue by executive grace.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Practices Commission",
        description: "A practices commission investigates and publishes.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Enforcement Powers",
        description: "Enforcement powers: orders, damages, and contempt behind the findings.",
        gdpCostFraction: 0.00033,
      },
      {
        name: "Full Employment Equality",
        description: "Full employment equality: hiring, pay, and promotion policed nationwide.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "us.sec.smallBusinessCredit",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 0.45,
      },
      {
        metricId: "economy.fiscal",
        weight: 0.3,
      },
      {
        metricId: "economy.householdIncome",
        weight: 0.3,
      },
    ],
    title: "Small Business and Credit Act",
    description: "Loans and advocacy for the smallest firms against the biggest.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programs",
        description:
          "No programs exist; the corner firm borrows at the banker's whim or not at all.",
      },
      {
        name: "Credit Windows",
        description: "Credit windows lend where the collateral is thin but the trade is sound.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Small Business Administration",
        description: "A small business administration: loans, counseling, and set-asides.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Expanded Lending",
        description: "Expanded lending: capital at scale for the smallest firms.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Enterprise Nation Drive",
        description:
          "The enterprise-nation drive: maximal support for the million-proprietor economy.",
        gdpCostFraction: 0.002,
      },
    ],
  },
  {
    id: "us.sec.veteransHealthPensions",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 0.4,
      },
      {
        metricId: "health.universalCare",
        weight: 0.3,
      },
      {
        metricId: "health.outcomes",
        weight: 0.3,
      },
    ],
    title: "Veterans Health and Pensions Act",
    description: "The parallel welfare state owed to those who served.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programs",
        description: "No programs exist; the veteran's wounds are his own expense.",
      },
      {
        name: "Service Pensions",
        description: "Service pensions pay the disabled their monthly due.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Hospitals and Pensions",
        description: "Hospitals and pensions: a veterans' medical system beside the checks.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Expanded Care System",
        description: "The expanded care system: clinics, prosthetics, and domiciliary care.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Full Veterans Guarantee",
        description:
          "The full veterans guarantee: comprehensive lifetime provision for those who served.",
        incomeCostFraction: 0.0108,
      },
    ],
    budgetKeyOverride: "socialSecurity",
  },
  {
    id: "us.sec.medicalResearchInstitutes",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.outcomes",
        weight: 0.4,
      },
      {
        metricId: "health.systemEfficiency",
        weight: 0.4,
      },
      {
        metricId: "health.providerChoice",
        weight: 0.3,
      },
      {
        metricId: "education.research",
        weight: 0.25,
      },
    ],
    title: "Medical Research Institutes Act",
    description: "Mission laboratories aimed at cancer, heart disease, and the rest.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Institutes",
        description: "No institutes exist; the great killers go unstudied on the federal books.",
      },
      {
        name: "Health Institute",
        description: "A health institute takes up the first disease missions.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Institutes System",
        description: "The institutes system: one campus per field, cancer to heart.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Disease Missions",
        description: "Disease missions: campaign-scale budgets against the named killers.",
        gdpCostFraction: 0.0017,
      },
      {
        name: "Conquest of Disease Drive",
        description:
          "The conquest-of-disease drive: maximal research until the mortality tables move.",
        gdpCostFraction: 0.0025,
      },
    ],
  },
  {
    id: "us.sec.healthPlansMarkets",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.providerChoice",
        weight: 0.5,
      },
      {
        metricId: "health.responsibility",
        weight: 0.4,
      },
      {
        metricId: "health.systemEfficiency",
        weight: 0.3,
      },
      {
        metricId: "health.socialInsurance",
        weight: 0.25,
      },
    ],
    title: "Health Plans and Benefits Markets Act",
    description: "The private-benefits economy and the rules that shape it.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Framework",
        description: "No framework exists; the benefits economy grows wild and unreadable.",
      },
      {
        name: "Group Plan Rules",
        description: "Group-plan rules settle the tax and trust questions.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Benefits Market Rules",
        description: "Benefits-market rules: disclosure and solvency standards for the plans.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Portable Benefits",
        description: "Portable benefits: coverage that follows the worker between employers.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Open Benefits Market",
        description:
          "The open benefits market: a national, portable, transparent private-coverage economy.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "us.sec.publicAssistanceReform",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "health.responsibility",
        weight: 0.5,
      },
      {
        metricId: "governance.administration",
        weight: 0.3,
      },
      {
        metricId: "society.familyStability",
        weight: 0.25,
      },
    ],
    title: "Public Assistance Reform Act",
    description: "Reforming the dole: caseworkers, conditions, and the deserving-poor debate.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Reform",
        description: "No reform touches the dole; the rolls grow by inertia.",
      },
      {
        name: "Eligibility Review",
        description: "Eligibility review: the rolls audited case by case.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Casework Standards",
        description: "Casework standards: trained workers and documented need.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Work-Linked Assistance",
        description: "Work-linked assistance: the check tied to the job search.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Full Conditionality",
        description:
          "Full conditionality: assistance conditioned, verified, and time-bound throughout.",
        gdpCostFraction: 0.0004,
      },
    ],
  },
  {
    id: "us.sec.defenseHousing",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 0.4,
      },
      {
        metricId: "infrastructure.condition",
        weight: 0.3,
      },
      {
        metricId: "governance.localAutonomy",
        weight: 0.3,
      },
      {
        metricId: "infrastructure.development",
        weight: 0.25,
      },
    ],
    title: "Defense Housing and Community Facilities Act",
    description: "Housing and schools for the towns the mobilization built overnight.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No program exists; the boomtown sleeps in trailers and tar paper.",
      },
      {
        name: "Base-Town Housing",
        description: "Base-town housing: units built where the gates are.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Community Facilities",
        description: "Community facilities: schools and waterworks for the mobilization towns.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Garrison Communities",
        description: "Garrison communities: complete towns planned around the installations.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Model Defense Towns",
        description: "Model defense towns: the mobilization community as a showcase of planning.",
        gdpCostFraction: 0.0033,
      },
    ],
  },
  {
    id: "us.sec.urbanTransitCommuter",
    countryId: "US",
    kind: "secondary",
    targets: [
      {
        metricId: "infrastructure.transit",
        weight: 0.5,
      },
      {
        metricId: "infrastructure.highways",
        weight: 0.3,
      },
      {
        metricId: "infrastructure.publicHousing",
        weight: 0.25,
      },
    ],
    title: "Urban Transit and Commuter Act",
    description:
      "Keeping the streetcars, subways, and commuter rails alive against the automobile.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Program",
        description: "No program exists; the commuter railroads fail on their own timetable.",
      },
      {
        name: "Commuter Aid",
        description: "Commuter aid keeps the morning trains running.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Transit Grants",
        description: "Transit grants fund cars, track, and signals.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Metropolitan Program",
        description: "The metropolitan program: regional systems co-funded and coordinated.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Transit Renaissance",
        description:
          "The transit renaissance: comprehensive urban transit, fares low and headways short.",
        gdpCostFraction: 0.0015,
      },
    ],
  },
];
