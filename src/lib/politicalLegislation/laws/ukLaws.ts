/**
 * UK political-legislation catalog — TRANSCRIBED from the reviewed catalog document
 * docs/superpowers/specs/2026-07-17-legislation-catalog-uk.md (the content SSOT;
 * local-only). Do not hand-edit content here: fix the document, then re-transcribe.
 * Derived display figures (absolute currency amounts) are intentionally not carried.
 */

import type { PoliticalLaw } from "../types";

export const UK_LAWS: PoliticalLaw[] = [
  {
    id: "uk.tax.incomeTax",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 36,
      waypoints: [
        {
          rate: 0,
          label: "No Income Taxation",
        },
        {
          rate: 12,
          label: "Minimal Schedule",
        },
        {
          rate: 24,
          label: "Standard Schedule",
        },
        {
          rate: 36,
          label: "Graduated Schedule with Surtax",
        },
        {
          rate: 46,
          label: "Elevated Surtax Schedule",
        },
        {
          rate: 54,
          label: "Confiscatory Schedule",
        },
      ],
    },
    title: "Income Tax and Surtax Act",
    description: "The income tax and its surtax on higher incomes — the Exchequer's backbone.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.tax.domesticCorporateTax",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "domesticCorporateTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 35,
      waypoints: [
        {
          rate: 0,
          label: "No Profits Levy",
        },
        {
          rate: 12,
          label: "Light Assessment",
        },
        {
          rate: 24,
          label: "Standard Assessment",
        },
        {
          rate: 35,
          label: "Profits Tax with Distributions Charge",
        },
        {
          rate: 48,
          label: "Excess Profits Levy",
        },
      ],
    },
    title: "Profits Tax and Corporation Duty Act",
    description: "The levy on company profits, with heavier charges on distributed dividends.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.tax.foreignCorporateTax",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "foreignCorporateTax",
      minRate: 0,
      maxRate: 65,
      step: 1,
      baselineRate: 39,
      waypoints: [
        {
          rate: 0,
          label: "Exempt Overseas Enterprise",
        },
        {
          rate: 16,
          label: "Light Assessment",
        },
        {
          rate: 30,
          label: "Standard Assessment",
        },
        {
          rate: 39,
          label: "Elevated Assessment",
        },
        {
          rate: 55,
          label: "Punitive Assessment",
        },
      ],
    },
    title: "Overseas Companies Levy Act",
    description: "Taxation of foreign-controlled enterprise trading within the United Kingdom.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.tax.payrollTax",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "payrollTax",
      minRate: 0,
      maxRate: 20,
      step: 0.2,
      baselineRate: 7.2,
      waypoints: [
        {
          rate: 0,
          label: "No Contributions",
        },
        {
          rate: 3,
          label: "Foundation Stamp",
        },
        {
          rate: 7.2,
          label: "Beveridge Contribution",
        },
        {
          rate: 12,
          label: "Expanded Contribution",
        },
        {
          rate: 18,
          label: "Comprehensive Contribution",
        },
      ],
    },
    title: "National Insurance Contributions Act",
    description: "The weekly stamp funding pensions, sickness, and unemployment benefit.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.tax.salesTax",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "salesTax",
      minRate: 0,
      maxRate: 30,
      step: 1,
      baselineRate: 0,
      waypoints: [
        {
          rate: 0,
          label: "Standing Purchase Tax Only",
        },
        {
          rate: 6,
          label: "Broadened Levies",
        },
        {
          rate: 12,
          label: "General Consumption Levy",
        },
        {
          rate: 20,
          label: "Heavy Consumption Levy",
        },
        {
          rate: 30,
          label: "Austerity Levy",
        },
      ],
    },
    title: "Purchase and Consumption Levies Act",
    description:
      "New consumption levies beyond the standing purchase tax the Treasury already collects; zero keeps the status quo.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.tax.tariffs",
    countryId: "UK",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "tariffs",
      minRate: 0,
      maxRate: 25,
      step: 0.5,
      baselineRate: 0,
      waypoints: [
        {
          rate: 0,
          label: "Standing Schedule",
        },
        {
          rate: 4,
          label: "Revenue Duties",
        },
        {
          rate: 8,
          label: "Moderate Protection",
        },
        {
          rate: 15,
          label: "High Protection",
        },
        {
          rate: 25,
          label: "Fortress Tariff",
        },
      ],
    },
    title: "Customs and Imperial Preference Act",
    description: "Additional duties beyond the standing customs schedule and preference system.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "uk.economy.workerSecurity.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.workerSecurity",
        weight: 1,
      },
    ],
    title: "Wages Councils and Employment Protection Act",
    description: "Wages councils, workplace rules, and the law behind the bargain.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Statutory Protection",
        description:
          "No statutory protection exists; terms of employment are whatever the contract and the foreman say.",
      },
      {
        name: "Wages Councils",
        description: "Wages councils set minimum rates in the weak trades where no union reaches.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Employment Protections",
        description:
          "Councils are joined by dismissal rules — notice, reasons, and a hearing before the sack.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Strong Protections",
        description:
          "Bargaining rights are enforced in law, and the employer who ignores the union answers for it.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Comprehensive Guarantees",
        description:
          "Comprehensive guarantees: a universal employment charter over every workplace in the kingdom.",
        gdpCostFraction: 0.0022,
      },
    ],
  },
  {
    id: "uk.economy.mobility.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.mobility",
        weight: 1,
      },
    ],
    title: "National Assistance and Depressed Areas Act",
    description:
      "The safety net beneath the Beveridge floor and the aid sent to struggling regions.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Assistance",
        description:
          "Poverty is unrelieved by the state; the workhouse's shadow is the only national policy.",
      },
      {
        name: "Assistance Board",
        description:
          "The assistance board pays means-tested national assistance — the safety net below the insurance stamp.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Assistance and Development Areas",
        description:
          "Assistance is paired with development-area aid steering work to the depressed districts.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Broad Opportunity Programme",
        description:
          "A broad opportunity programme: retraining, relocation grants, and area boards for the left-behind regions.",
        incomeCostFraction: 0.0143,
      },
      {
        name: "Full Opportunity Guarantee",
        description:
          "The full opportunity guarantee: a comprehensive anti-poverty system from the valleys to the estates.",
        incomeCostFraction: 0.0215,
      },
    ],
  },
  {
    id: "uk.economy.householdIncome.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.householdIncome",
        weight: 1,
      },
    ],
    title: "Food Subsidies and Household Costs Act",
    description: "The subsidies standing between the weekly shop and the world price.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Subsidies",
        description:
          "No subsidies stand between the household and the world price; the weekly shop takes what it must.",
      },
      {
        name: "Targeted Subsidies",
        description: "Bread and milk are supported — the staples of the ration book held steady.",
        incomeCostFraction: 0.008,
      },
      {
        name: "Broad Food Subsidies",
        description: "Broad food subsidies keep the staples below cost across the counter.",
        incomeCostFraction: 0.0143,
      },
      {
        name: "Expanded Cost Support",
        description: "Cost support expands to fuel and rent aid beside the food subsidies.",
        incomeCostFraction: 0.0244,
      },
      {
        name: "Universal Cost Shield",
        description:
          "A universal cost shield: comprehensive price supports across the household's whole budget.",
        incomeCostFraction: 0.0337,
      },
    ],
  },
  {
    id: "uk.economy.stability.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.stability",
        weight: 1,
      },
    ],
    title: "Exchange Control and Stabilization Act",
    description: "Defending sterling: controls, reserves, and the machinery of confidence.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Controls",
        description: "Sterling floats unmanaged; the reserves drain at the market's pleasure.",
      },
      {
        name: "Exchange Monitoring",
        description:
          "The reserves are watched and the data gathered — the Treasury at least sees the run coming.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Exchange Control",
        description:
          "Exchange control in earnest: capital movements licensed, reserves managed, the dollar gap policed.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Active Stabilization",
        description:
          "Active stabilization: standby powers and intervention funds ready before the crisis breaks.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Full Command Toolkit",
        description:
          "The full command toolkit: comprehensive controls over exchange, credit, and prices.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "uk.economy.productivity.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.productivity",
        weight: 1,
      },
    ],
    title: "Industrial Investment and Productivity Act",
    description: "Allowances, councils, and campaigns against the productivity gap.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "Investment goes unaided; the plant modernizes when the shareholders feel flush.",
      },
      {
        name: "Productivity Councils",
        description:
          "Productivity councils run the advisory and demonstration work — the gap studied, if not yet closed.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Investment Incentives",
        description:
          "Investment incentives: initial allowances and modernization aid pulling capital into the works.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Industrial Modernization",
        description:
          "Industrial modernization: retooling grants and export drives against the productivity gap.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "National Investment Drive",
        description:
          "A national investment drive: broad capital mobilization, the Treasury underwriting the re-equipment of industry.",
        gdpCostFraction: 0.0035,
      },
    ],
  },
  {
    id: "uk.economy.fiscal.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.fiscal",
        weight: 1,
      },
    ],
    title: "Exchequer Discipline and Debt Act",
    description: "How hard the Treasury's grip is on the nation's books.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework binds the books; finance is ad hoc and the estimates are a courtesy.",
      },
      {
        name: "Debt Administration",
        description: "Orderly gilt management puts the national debt on a professional footing.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Exchequer Rules",
        description:
          "Exchequer rules: estimates discipline and audit, the Treasury's grip firm on every vote.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Austerity Framework",
        description:
          "The austerity framework: binding ceilings and retrenchment, however the spending ministers howl.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Iron Exchequer",
        description:
          "The iron exchequer: constitutional-grade restraint on what any government may borrow or spend.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "uk.economy.competition.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 1,
      },
    ],
    title: "Restrictive Practices and Competition Act",
    description: "The commission and courts prying cartelized Britain open.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Enforcement",
        description: "Cartels go unrestrained; half of British industry fixes prices over lunch.",
      },
      {
        name: "Monopolies Commission",
        description:
          "The monopolies commission inquires and reports, and the reports gather dust politely.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Active Enforcement",
        description:
          "Active enforcement: a register of restrictive practices and prohibitions with consequences.",
        gdpCostFraction: 0.0004,
        gdpRevenueFraction: 0.0001,
      },
      {
        name: "Structural Enforcement",
        description:
          "Structural enforcement: divestment powers used against the hardened combines.",
        gdpCostFraction: 0.0006,
        gdpRevenueFraction: 0.00015,
      },
      {
        name: "Open Markets Charter",
        description:
          "An open markets charter: sweeping deconcentration, no firm too clubbable to divide.",
        gdpCostFraction: 0.0009,
        gdpRevenueFraction: 0.0002,
      },
    ],
  },
  {
    id: "uk.education.universalSchooling.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.universalSchooling",
        weight: 1,
      },
    ],
    title: "National Education Settlement Act",
    description: "The education settlement: who gets schooled, how long, at whose expense.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No National Settlement",
        description:
          "No national settlement exists; schooling is local, partial, and ends when the family needs the wage.",
      },
      {
        name: "Elementary Guarantee",
        description:
          "Universal elementary places: every child schooled through the elementary years.",
        incomeCostFraction: 0.0057,
      },
      {
        name: "Secondary for Some",
        description:
          "Selective secondary expansion: grammar places for those who pass, the rest left at the gate.",
        incomeCostFraction: 0.0115,
      },
      {
        name: "Secondary for All",
        description:
          "Secondary for all: free secondary education as a universal right, whatever the eleven-plus says.",
        incomeCostFraction: 0.0165,
      },
      {
        name: "Comprehensive Guarantee",
        description:
          "The comprehensive guarantee: a universal comprehensive system, one school for every child.",
        incomeCostFraction: 0.0237,
      },
    ],
  },
  {
    id: "uk.education.teacherCorps.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.teacherCorps",
        weight: 1,
      },
    ],
    title: "Teachers and School Building Act",
    description: "Training colleges and building programmes behind the classroom door.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "Staffing is left to the authorities; the shortage is met by larger classes and lowered standards.",
      },
      {
        name: "Emergency Training",
        description: "Emergency training schemes rush new teachers through shortened courses.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Teachers and Buildings",
        description:
          "Training colleges plus school works — new teachers and new roofs in the same programme.",
        incomeCostFraction: 0.005,
      },
      {
        name: "National Teaching Service",
        description:
          "A national teaching service: recruitment campaigns and a pay settlement that makes the profession worth entering.",
        incomeCostFraction: 0.0086,
      },
      {
        name: "Full Staffing Guarantee",
        description:
          "The full staffing guarantee: ratios and estates underwritten in every authority.",
        incomeCostFraction: 0.0129,
      },
    ],
  },
  {
    id: "uk.education.adultSkills.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.adultSkills",
        weight: 1,
      },
    ],
    title: "Technical Colleges and Apprenticeship Act",
    description: "The technical colleges and apprenticeship ladders of industrial Britain.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Provision",
        description: "Training is left to employers, which is to say largely left undone.",
      },
      {
        name: "Evening Institutes",
        description:
          "Evening institutes and day release give the working man his night-school ladder.",
        incomeCostFraction: 0.0014,
      },
      {
        name: "Technical Colleges",
        description:
          "The technical college network plus apprenticeships — the skilled trades renewed by system.",
        incomeCostFraction: 0.0029,
      },
      {
        name: "National Training System",
        description:
          "A national training system: an open entitlement to retrain at public expense.",
        incomeCostFraction: 0.005,
      },
      {
        name: "Universal Skills Guarantee",
        description:
          "The universal skills guarantee: lifetime reskilling rights for every worker industry reshapes.",
        incomeCostFraction: 0.0079,
      },
    ],
  },
  {
    id: "uk.education.attainment.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.attainment",
        weight: 1,
      },
    ],
    title: "Attainment and Literacy Standards Act",
    description: "Raising what the average school-leaver actually walks out with.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description:
          "Attainment goes untracked; the school-leaver walks out at the first legal moment, unexamined.",
      },
      {
        name: "Literacy Campaigns",
        description:
          "Literacy campaigns and completion drives chase the adults the schools missed.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Completion Programmes",
        description:
          "Completion programmes: staying-on support for the families who need the wage.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Attainment Standards",
        description:
          "Attainment standards: completion targets funded, with maintenance allowances behind them.",
        gdpCostFraction: 0.002,
      },
      {
        name: "Universal Attainment Drive",
        description:
          "The universal attainment drive: a national completion guarantee to the school-leaving certificate.",
        gdpCostFraction: 0.0031,
      },
    ],
  },
  {
    id: "uk.education.research.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.research",
        weight: 1,
      },
    ],
    title: "Scientific Research Councils Act",
    description: "The research councils and national laboratories behind British science.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Councils",
        description:
          "The state funds no research; British science lives on college endowments and luck.",
      },
      {
        name: "Research Grants",
        description: "The research councils make grants to the universities on merit.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Research Establishment",
        description:
          "The research establishment: national laboratories funded alongside the council grants.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "National Research Drive",
        description:
          "A national research drive: mission programmes and big facilities aimed at named problems.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Scientific Mobilization",
        description:
          "Scientific mobilization: the apex national effort, from the radio telescope to the wind tunnel.",
        gdpCostFraction: 0.004,
      },
    ],
  },
  {
    id: "uk.education.standards.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.standards",
        weight: 1,
      },
    ],
    title: "Examinations and Inspection Act",
    description: "Inspectors, examinations, and the sorting of the nation's children.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No National Standards",
        description: "Standards are wholly local; one authority's scholar is another's truant.",
      },
      {
        name: "Inspectorate",
        description:
          "The inspectorate reports: His Majesty's inspectors walk the classrooms and publish what they find.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Selection Examinations",
        description: "National selection at eleven sorts the intake by examination.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Certificate Regime",
        description:
          "The certificate regime: national certificates with stakes employers and colleges respect.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Rigorous National Regime",
        description:
          "A rigorous national regime: binding standards and honors streams, no authority exempt.",
        gdpCostFraction: 0.0015,
      },
    ],
  },
  {
    id: "uk.education.choice.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "education.choice",
        weight: 1,
      },
    ],
    title: "Direct Grant and School Choice Act",
    description: "The assisted route into the independent sector, and how wide it opens.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Assigned Places Only",
        description: "No assisted alternatives exist; the assigned place is the only place.",
      },
      {
        name: "Direct Grant Places",
        description: "Direct grant places open assisted seats at the independent schools.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Direct Grant System",
        description:
          "The direct grant system: grant schools plus scholarships, a funded route past the local school.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Broad Choice Support",
        description:
          "Broad choice support: the assisted sector expanded for any family that seeks it.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Full Choice System",
        description:
          "The full choice system: portable funding and an open sector, the grant following the pupil.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "uk.health.universalCare.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.universalCare",
        weight: 1,
      },
    ],
    title: "National Health Service Act",
    description:
      "Publicly funded care free at the point of use, from panel patchwork to the full service.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 4,
    levels: [
      {
        name: "No National Service",
        description:
          "Care goes by purse and charity; the panel doctor for some, the voluntary ward for the lucky.",
      },
      {
        name: "Public Infirmaries",
        description:
          "The municipal and voluntary patchwork: public infirmaries holding the line unevenly.",
        incomeCostFraction: 0.009,
      },
      {
        name: "National Insurance Care",
        description:
          "Panel doctors for the insured — the stamp buys the working man his GP, and his family nothing.",
        incomeCostFraction: 0.0158,
      },
      {
        name: "Broad Public Service",
        description: "A broad public service: most care free at use, the wards open to all comers.",
        incomeCostFraction: 0.0237,
      },
      {
        name: "Universal Comprehensive Service",
        description:
          "The universal comprehensive service: full care free at the point of use, from spectacles to surgery.",
        incomeCostFraction: 0.0308,
      },
    ],
  },
  {
    id: "uk.health.socialInsurance.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 1,
      },
    ],
    title: "National Insurance and Pensions Act",
    description: "The contributory system insuring the nation from cradle to grave.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No National Insurance",
        description:
          "Old age and sickness go uninsured; the friendly society and the family are the whole scheme.",
      },
      {
        name: "Foundation Insurance",
        description:
          "Foundation insurance: narrow contributory pensions for the industrial workforce.",
        incomeCostFraction: 0.0108,
      },
      {
        name: "Expanded Insurance",
        description: "Coverage widens and benefits rise — more trades stamped, more risks carried.",
        incomeCostFraction: 0.0201,
      },
      {
        name: "Beveridge Insurance",
        description:
          "The cradle-to-grave contributory system: one stamp insuring sickness, unemployment, and age together.",
        incomeCostFraction: 0.0301,
      },
      {
        name: "Full Social Insurance",
        description:
          "Full social insurance: universal coverage at an adequacy standard a pensioner can live on.",
        incomeCostFraction: 0.0416,
      },
    ],
    budgetKeyOverride: "statePensions",
  },
  {
    id: "uk.health.prevention.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.prevention",
        weight: 1,
      },
    ],
    title: "Public Health and Vaccination Act",
    description: "Vaccination campaigns and the sanitary state beneath the health service.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "Prevention is left to the boroughs, and the boroughs leave it to chance.",
      },
      {
        name: "Sanitary Authorities",
        description:
          "Sanitary authorities inspect and notify — the Victorian machinery kept oiled.",
        incomeCostFraction: 0.0011,
      },
      {
        name: "Vaccination Programmes",
        description: "Mass immunization campaigns carry the needle to every school and clinic.",
        incomeCostFraction: 0.0032,
      },
      {
        name: "Preventive Network",
        description:
          "The preventive network: screening, health visitors, and maternity care across the country.",
        incomeCostFraction: 0.0057,
      },
      {
        name: "Total Prevention System",
        description:
          "A total prevention system: a universal preventive service beneath the curative one.",
        incomeCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "uk.health.outcomes.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.outcomes",
        weight: 1,
      },
    ],
    title: "Hospital Boards and Medical Progress Act",
    description: "The hospital boards and research assault on the nation's killers.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Investment",
        description: "Outcomes are left to providence; nobody counts what the wards achieve.",
      },
      {
        name: "Board Administration",
        description: "Regional hospital boards administer the estate and publish their returns.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Boards and Research",
        description: "Boards plus clinical research — administration joined to inquiry.",
        gdpCostFraction: 0.002,
      },
      {
        name: "National Health Campaign",
        description:
          "A national health campaign: disease-mission programmes against the great killers.",
        gdpCostFraction: 0.0035,
      },
      {
        name: "Outcomes Guarantee",
        description:
          "The outcomes guarantee: national mortality targets, with funding accountable to them.",
        gdpCostFraction: 0.0056,
      },
    ],
  },
  {
    id: "uk.health.responsibility.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.responsibility",
        weight: 1,
      },
    ],
    title: "Charges and Benefit Conditions Act",
    description: "Charges at the chemist and the conditions on the book of benefits.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Conditions",
        description: "Benefits and service run unconditional; the book asks nothing of its holder.",
      },
      {
        name: "Modest Charges",
        description:
          "Modest charges arrive at the chemist and the dentist — the shilling on the prescription.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Targeting Regime",
        description: "A targeting regime: means tests reaching beyond the insurance stamp.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Work Requirements",
        description:
          "Work requirements with enforcement: the benefit conditioned on the search for work.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Strict Conditionality",
        description:
          "Strict conditionality: a comprehensive conditions regime across the book of benefits.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "uk.health.providerChoice.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.providerChoice",
        weight: 1,
      },
    ],
    title: "Private Practice and Provident Schemes Act",
    description: "The private wing: pay beds, provident schemes, and consultant freedoms.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Framework",
        description:
          "Private practice is unstructured; the consultant's rooms operate by custom alone.",
      },
      {
        name: "Pay Beds and Panels",
        description:
          "Pay beds and panels: private practice accommodated within the service's walls.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Provident Framework",
        description:
          "The provident framework: mutual schemes recognized for those who insure privately.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Choice Protections",
        description:
          "Choice protections: consultant choice and portable cover written into the rules.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Open Market Charter",
        description:
          "An open market charter: a full parallel private market beside the public service.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "uk.health.systemEfficiency.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "health.systemEfficiency",
        weight: 1,
      },
    ],
    title: "Service Efficiency and Management Act",
    description: "The committees hunting waste inside the service's corridors.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "Administration goes unexamined; the service spends and nobody reconciles the books.",
      },
      {
        name: "Costing Returns",
        description: "Costing returns introduce cost accounting to the wards.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Efficiency Committee",
        description:
          "An efficiency committee reviews management and procurement across the regions.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Performance Funding",
        description: "Performance funding ties the allocation to throughput rather than habit.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Lean Service Mandate",
        description:
          "The lean service mandate: binding efficiency targets across the whole estate.",
        gdpCostFraction: 0.0012,
      },
    ],
  },
  {
    id: "uk.infrastructure.publicHousing.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 1,
      },
    ],
    title: "Housing and Town Development Act",
    description: "Council housing from clearance schemes to the great building drive.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Council Housing",
        description: "Housing is wholly private; the landlord's terrace is the only offer.",
      },
      {
        name: "Slum Clearance",
        description:
          "Slum clearance with limited building — the condemned courts come down faster than replacements rise.",
        incomeCostFraction: 0.0086,
      },
      {
        name: "Council Building Programme",
        description:
          "The council building programme: steady authority building, the waiting list moving at last.",
        incomeCostFraction: 0.0158,
      },
      {
        name: "Three Hundred Thousand Homes",
        description:
          "The maximum building drive: hundreds of thousands of homes a year, the cranes never idle.",
        incomeCostFraction: 0.0251,
      },
      {
        name: "Universal Housing Duty",
        description:
          "The universal housing duty: guaranteed council access for every household that seeks it.",
        incomeCostFraction: 0.0359,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "uk.infrastructure.transit.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.transit",
        weight: 1,
      },
    ],
    title: "Railways and Public Transport Act",
    description: "Support and investment for the nationalized railways and bus networks.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Support",
        description: "The carriers live on fare receipts alone, and die on them too.",
      },
      {
        name: "Deficit Grants",
        description: "Deficit grants keep the boards' trains and buses running.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Modernization Support",
        description:
          "Modernization support: new rolling stock and electrification on the priority lines.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Network Investment",
        description:
          "Network investment: the major modernization plan, steam giving way by schedule.",
        gdpCostFraction: 0.0055,
      },
      {
        name: "Total Network Renewal",
        description: "Total network renewal: full-system rebuilding, track to timetable.",
        gdpCostFraction: 0.0085,
      },
    ],
  },
  {
    id: "uk.infrastructure.utilities.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.utilities",
        weight: 1,
      },
    ],
    title: "Utilities and Telephone Expansion Act",
    description: "Pushing the mains and the telephone exchange to the last cottage.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "Connection is left to the boards, and the boards stop where the line stops paying.",
      },
      {
        name: "Rural Connection Grants",
        description: "Rural connection grants push electrification into the countryside.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Connection Programme",
        description:
          "The connection programme: grants plus telephone exchange expansion down the market towns.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Universal Service Drive",
        description: "A universal service drive: power and telephone to every village and farm.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Total Connection Mandate",
        description:
          "The total connection mandate: every household wired and connected, to the last cottage.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "uk.infrastructure.condition.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.condition",
        weight: 1,
      },
    ],
    title: "Public Works and Maintenance Act",
    description: "Mending what the war broke and keeping the rest standing.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Deferred Maintenance",
        description:
          "Maintenance is deferred and war damage left standing; the tarpaulin is a fixture.",
      },
      {
        name: "War Damage Repairs",
        description: "War damage repairs proceed worst-first through the bombed streets.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Maintenance Programme",
        description: "A maintenance programme puts renewal on scheduled cycles at last.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Resilience Standard",
        description:
          "The resilience standard: flood defence and hardening engineered into the estate.",
        gdpCostFraction: 0.0039,
      },
      {
        name: "Gold-Standard Upkeep",
        description:
          "Gold-standard upkeep: condition guaranteed nationwide on a fixed inspection cycle.",
        gdpCostFraction: 0.006,
      },
    ],
  },
  {
    id: "uk.infrastructure.highways.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.highways",
        weight: 1,
      },
    ],
    title: "Trunk Roads Programme Act",
    description: "The trunk roads and the motorway age waiting to begin.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Roads Programme",
        description: "Roads are left to the counties, and the counties leave them as they are.",
      },
      {
        name: "Trunk Road Maintenance",
        description: "The national trunk routes are maintained to a passable standard.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Trunk Improvement Programme",
        description:
          "The trunk improvement programme: widening and bypasses easing the worst of it.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Motorway Programme",
        description: "The motorway programme begins: the first limited-access miles of a new age.",
        gdpCostFraction: 0.0042,
      },
      {
        name: "National Motorway Grid",
        description:
          "The national motorway grid: full buildout, the island rewired for the lorry and the car.",
        gdpCostFraction: 0.0068,
      },
    ],
  },
  {
    id: "uk.infrastructure.ownership.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.ownership",
        weight: 1,
      },
    ],
    title: "Building Societies and Ownership Act",
    description: "The building societies and the dream of a property-owning democracy.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Support",
        description:
          "Ownership goes unaided; the deposit is the moat around the property-owning classes.",
      },
      {
        name: "Societies Framework",
        description: "The building societies are regulated into a sound and steady framework.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Guarantee Scheme",
        description: "A guarantee scheme backs mortgages the societies would not carry alone.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Ownership Drive",
        description: "The ownership drive: a low-deposit national scheme opening the door wide.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Property-Owning Democracy",
        description:
          "The property-owning democracy: maximal subsidy to owning, the rent book traded for deeds.",
        gdpCostFraction: 0.0033,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "uk.infrastructure.development.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.development",
        weight: 1,
      },
    ],
    title: "Planning and Development Control Act",
    description: "The permission machine between a drawing and a building.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Planning Control",
        description:
          "Building is unregulated; the ribbon development crawls along every arterial road.",
      },
      {
        name: "Planning Permissions",
        description: "The universal permission regime: no building without planning consent.",
        gdpCostFraction: 0.0002,
        gdpRevenueFraction: 0.0001,
      },
      {
        name: "Streamlined Consent",
        description:
          "Streamlined consent: statutory deadlines on the planning committee's deliberations.",
        gdpCostFraction: 0.0003,
        gdpRevenueFraction: 0.00015,
      },
      {
        name: "Development Districts",
        description:
          "Development districts: pre-approved growth zones where the drawings can break ground.",
        gdpCostFraction: 0.0005,
        gdpRevenueFraction: 0.0002,
      },
      {
        name: "Open Building Charter",
        description: "An open building charter: consent by right, the presumption flipped to yes.",
        gdpCostFraction: 0.0007,
        gdpRevenueFraction: 0.00025,
      },
    ],
  },
  {
    id: "uk.order.dueProcess.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.dueProcess",
        weight: 1,
      },
    ],
    title: "Criminal Justice and Detention Standards Act",
    description: "The rules the Crown must follow before it may hold a subject.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Statutory Standards",
        description: "Process runs by custom alone; the Crown holds whom it holds.",
      },
      {
        name: "Basic Protections",
        description:
          "Basic protections enforced: counsel and habeas made real in every police court.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Detention Standards",
        description: "Detention standards: inspected prisons and review boards behind the gates.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Strong Process Rights",
        description:
          "Strong process rights: exclusionary rules and oversight that make the shortcut expensive.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Rights Charter",
        description:
          "The full rights charter: comprehensive procedural guarantees for every subject of the Crown.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "uk.order.legalAid.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.legalAid",
        weight: 1,
      },
    ],
    title: "Legal Aid and Advice Act",
    description: "The statutory scheme putting a barrister within reach.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Legal Aid",
        description: "Counsel is for those who pay; the dock is a lonely place for the poor.",
      },
      {
        name: "Poor Persons Procedure",
        description:
          "The poor persons procedure: charitable defence for the destitute, by the profession's grace.",
        incomeCostFraction: 0.0006,
      },
      {
        name: "Legal Aid Scheme",
        description: "The statutory scheme: civil and criminal legal aid as a public service.",
        incomeCostFraction: 0.0013,
      },
      {
        name: "Access Guarantee",
        description: "An access guarantee: aid guaranteed broadly, the means test generous.",
        incomeCostFraction: 0.0023,
      },
      {
        name: "Universal Legal Service",
        description:
          "The universal legal service: full public representation in any court, free at the point of need.",
        incomeCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "uk.order.communityTrust.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.communityTrust",
        weight: 1,
      },
    ],
    title: "Police Conduct and Watch Committees Act",
    description: "The committees and codes keeping the constable answerable.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Oversight",
        description:
          "The constable's conduct is examined by no one; the station closes ranks by habit.",
      },
      {
        name: "Watch Committees",
        description: "Watch committees provide local oversight of the forces.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Conduct Standards",
        description:
          "Conduct standards: training requirements and complaints machinery with a docket.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Accountability Regime",
        description: "An accountability regime: independent investigations with real consequences.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Full Consent Model",
        description:
          "The full consent model: policing by consent codified, trusted because it answers.",
        gdpCostFraction: 0.0008,
      },
    ],
  },
  {
    id: "uk.order.safety.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.safety",
        weight: 1,
      },
    ],
    title: "Crime Prevention Grants Act",
    description: "Money aimed at stopping crime before the constable is needed.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "Safety is left to the watch alone; prevention is a word in sermons.",
      },
      {
        name: "Targeted Grants",
        description: "Targeted grants reach the high-crime boroughs.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Prevention Programme",
        description:
          "The prevention programme: youth clubs, probation officers, and street lighting.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "National Safety Drive",
        description:
          "A national safety drive: comprehensive prevention across policing, probation, and planning.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Total Safety Guarantee",
        description:
          "The total safety guarantee: maximal prevention investment down to the last close and court.",
        gdpCostFraction: 0.002,
      },
    ],
  },
  {
    id: "uk.order.courts.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.courts",
        weight: 1,
      },
    ],
    title: "Courts and Assizes Capacity Act",
    description: "Judges, assizes, and courtrooms enough to clear the lists.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Starved Courts",
        description: "The lists lengthen untended; an assize date is a season, not a day.",
      },
      {
        name: "Judicial Appointments",
        description: "Judicial appointments add judges and clerks where the lists are worst.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Court Modernization",
        description: "Court modernization: procedure reform and buildings fit for the caseload.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Speedy Trial Standard",
        description:
          "The speedy trial standard: time-to-trial targets, funded rather than announced.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Full Capacity Guarantee",
        description:
          "The full capacity guarantee: justice without queues at every assize and sessions.",
        gdpCostFraction: 0.0022,
      },
    ],
  },
  {
    id: "uk.order.policeStrength.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.policeStrength",
        weight: 1,
      },
    ],
    title: "Police Forces and Constabulary Act",
    description: "The strength and kit of the constabularies.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Skeleton Forces",
        description:
          "The constabularies stand under strength; the beat goes unwalked in half the borough.",
      },
      {
        name: "Establishment Funding",
        description: "Establishment funding brings the forces to their authorized numbers.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Modern Constabulary",
        description: "The modern constabulary: wireless, vehicles, and forensics behind the beat.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "National Enforcement Web",
        description: "A national enforcement web: regional crime squads pooling the forces' reach.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Maximum Enforcement",
        description:
          "Maximum enforcement: saturation capacity, no district beyond the sound of a whistle.",
        gdpCostFraction: 0.0045,
      },
    ],
  },
  {
    id: "uk.order.deterrence.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "order.deterrence",
        weight: 1,
      },
    ],
    title: "Sentencing and Prisons Act",
    description: "How heavily the scales come down, and where the convicted go.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Policy",
        description: "Sentencing is wholly judicial; the scales swing by circuit and temperament.",
      },
      {
        name: "Prison Standards",
        description: "Prison standards funded: capacity and rules for the estate.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Firm Sentencing",
        description: "Firm sentencing: guidelines plus the cells to make them stick.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Severe Regime",
        description: "A severe regime: mandatory penalties enforced without judicial discount.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Maximum Deterrence",
        description:
          "Maximum deterrence: the certainty-and-severity doctrine, applied without embarrassment.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "uk.environment.conservation.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.conservation",
        weight: 1,
      },
    ],
    title: "Rivers and Pollution Control Act",
    description: "The river boards and consent regime against industrial filth.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Controls",
        description: "Discharge is unrestrained; the rivers run whatever color the mills decide.",
      },
      {
        name: "River Boards",
        description: "River boards prosecute the worst sources, one summons at a time.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Discharge Consents",
        description: "The consent regime: outflows permitted, measured, and capped.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Strict Limits",
        description:
          "Strict limits: binding ceilings with penalties that outrun the savings of fouling.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Total Stewardship",
        description:
          "Total stewardship: a sweeping conservation regime over the island's air, water, and land.",
        gdpCostFraction: 0.0023,
      },
    ],
  },
  {
    id: "uk.environment.stewardship.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.stewardship",
        weight: 1,
      },
    ],
    title: "National Parks and Access Act",
    description: "The parks, paths, and green belts of a crowded island.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Lands Unmanaged",
        description: "The countryside is unprotected; the crowded island consumes its own green.",
      },
      {
        name: "Parks Commission",
        description: "The parks commission designates the first national parks.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Parks and Access Programme",
        description: "Parks plus rights of way: the ramblers' paths secured in law.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Countryside Stewardship",
        description:
          "Countryside stewardship: catchment and soil programmes tending whole landscapes.",
        gdpCostFraction: 0.0022,
      },
      {
        name: "National Stewardship",
        description:
          "National stewardship: maximal care of the land and water of a small, crowded island.",
        gdpCostFraction: 0.0034,
      },
    ],
  },
  {
    id: "uk.environment.urbanAir.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.urbanAir",
        weight: 1,
      },
    ],
    title: "Smoke Abatement and Clean Air Act",
    description: "The fight against the coal smoke that kills by the thousand.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description: "The smogs go unanswered; the killing fogs are treated as weather.",
      },
      {
        name: "Smoke Inspectors",
        description: "Smoke inspectors work abatement chimney by chimney.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Smokeless Zones",
        description: "Smoke-control areas are declared, and the smokeless zone becomes law.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Clean Air Standard",
        description: "The clean air standard: binding urban limits with teeth.",
        gdpCostFraction: 0.0016,
      },
      {
        name: "Healthy Cities Charter",
        description:
          "A healthy-cities charter: the comprehensive urban environment, from the grate to the gutter.",
        gdpCostFraction: 0.0024,
      },
    ],
  },
  {
    id: "uk.environment.energySecurity.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.energySecurity",
        weight: 1,
      },
    ],
    title: "Electricity and Grid Development Act",
    description: "Keeping the turbines turning and the grid connected.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "Generation is left to the boards alone, and the winter margins show it.",
      },
      {
        name: "Strategic Stocks",
        description: "Strategic stocks of coal and oil cushion the first crisis.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Generation Programme",
        description: "The generation programme: new stations and grid investment on schedule.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Grid Modernization",
        description: "Grid modernization: the supergrid and a capacity drive ahead of demand.",
        gdpCostFraction: 0.0027,
      },
      {
        name: "Energy Independence Drive",
        description:
          "The energy independence drive: maximal supply security, whatever the estimates say.",
        gdpCostFraction: 0.0041,
      },
    ],
  },
  {
    id: "uk.environment.resourceDev.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.resourceDev",
        weight: 1,
      },
    ],
    title: "Coal and Domestic Resources Act",
    description: "Coal — the nation's furnace — and what else the ground will give.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "The pits are left to decline; the nation's furnace burns on inherited seams.",
      },
      {
        name: "Survey and Support",
        description:
          "Survey and support: the geological survey funded and the struggling pits propped.",
        gdpCostFraction: 0.0005,
        gdpRevenueFraction: 0.0001,
      },
      {
        name: "Development Programme",
        description: "The development programme: mechanization and new seams opened.",
        gdpCostFraction: 0.001,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Production Drive",
        description:
          "A production drive: output targets and investment, coal as a national campaign.",
        gdpCostFraction: 0.0018,
        gdpRevenueFraction: 0.00045,
      },
      {
        name: "Maximum Production Push",
        description: "The maximum production push: all-out extraction from every workable seam.",
        gdpCostFraction: 0.0027,
        gdpRevenueFraction: 0.0006,
      },
    ],
  },
  {
    id: "uk.environment.affordability.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.affordability",
        weight: 1,
      },
    ],
    title: "Fuel Prices and Allocation Act",
    description: "Standing between the coal scuttle and the household purse.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "Fuel prices go unmanaged; the scuttle empties at the market's pleasure.",
      },
      {
        name: "Price Monitoring",
        description: "Tariff review machinery watches the boards' price lists.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Tariff Restraint",
        description: "Tariff restraint holds the boards' charges down by direction.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Household Fuel Support",
        description: "Household fuel support: an assistance scheme for the coldest hearths.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Guaranteed Affordability",
        description:
          "Guaranteed affordability: broad price guarantees on the household's heat and light.",
        gdpCostFraction: 0.0017,
      },
    ],
  },
  {
    id: "uk.environment.extraction.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "environment.extraction",
        weight: 1,
      },
    ],
    title: "Minerals Licensing Act",
    description: "Who may quarry, mine, and drill — and what the Crown charges for it.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Grounds Closed",
        description: "The grounds are closed; no licensing regime opens them.",
      },
      {
        name: "Licensing Windows",
        description: "Conventional licensing rounds open acreage on standard terms.",
        gdpCostFraction: 0.0001,
        gdpRevenueFraction: 0.0002,
      },
      {
        name: "Streamlined Licensing",
        description: "Streamlined licensing: fast rounds and royalty relief.",
        gdpCostFraction: 0.00015,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Open Access Regime",
        description: "An open access regime: broad acreage under light review.",
        gdpCostFraction: 0.0002,
        gdpRevenueFraction: 0.0004,
      },
      {
        name: "Maximum Access Charter",
        description:
          "The maximum access charter: near-unrestricted development, the Crown collecting its rent.",
        gdpCostFraction: 0.00025,
        gdpRevenueFraction: 0.0005,
      },
    ],
  },
  {
    id: "uk.society.integration.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.integration",
        weight: 1,
      },
    ],
    title: "Race Relations and Equal Standing Act",
    description: "Equal standing for all subjects of the Crown, written into statute — or not.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "No Statutory Protection",
        description: "Discrimination is lawful; the colour bar operates wherever it pleases.",
      },
      {
        name: "Public Places Rule",
        description:
          "The public places rule: nondiscrimination in public services and accommodations.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Relations Board",
        description: "A relations board with powers investigates and orders remedies.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Broad Enforcement",
        description: "Broad enforcement: housing and employment brought under the statute.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Full Equality Charter",
        description:
          "The full equality charter: comprehensive rights enforcement for every subject of the Crown.",
        gdpCostFraction: 0.0023,
      },
    ],
  },
  {
    id: "uk.society.womensOpportunity.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.womensOpportunity",
        weight: 1,
      },
    ],
    title: "Women's Employment and Family Services Act",
    description: "From marriage bars to equal pay — the state's hand in women's working lives.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description: "Opportunity goes unaddressed; the marriage bar ends careers at the altar.",
      },
      {
        name: "Women's Services",
        description: "Women's services: advisory and welfare offices arguing the case.",
        incomeCostFraction: 0.0006,
      },
      {
        name: "Equal Pay Rules",
        description:
          "Equal pay in the public service — the state pays its own women what it pays its men.",
        incomeCostFraction: 0.0013,
      },
      {
        name: "Nursery Network",
        description: "The nursery network: public nurseries making the working day possible.",
        incomeCostFraction: 0.0024,
      },
      {
        name: "Full Opportunity System",
        description:
          "The full opportunity system: comprehensive support from the hiring hall to the nursery gate.",
        incomeCostFraction: 0.0037,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.society.socialMobility.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.socialMobility",
        weight: 1,
      },
    ],
    title: "Opportunity and Advancement Act",
    description: "Ladders over the class wall, built at public expense.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description: "Class barriers stand unaddressed; the accent still reads as a reference.",
      },
      {
        name: "Scholarship Ladders",
        description: "Scholarship ladders: county awards and grants over the wall.",
        incomeCostFraction: 0.0007,
      },
      {
        name: "Advancement Programmes",
        description: "Advancement programmes: awards plus placement services behind them.",
        incomeCostFraction: 0.0016,
      },
      {
        name: "Mobility Guarantee",
        description:
          "A mobility guarantee: first-generation support from application to first post.",
        incomeCostFraction: 0.0027,
      },
      {
        name: "Open Society Drive",
        description:
          "The open society drive: maximal opportunity machinery against the class wall.",
        incomeCostFraction: 0.0042,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.society.demography.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.demography",
        weight: 1,
      },
    ],
    title: "Population and Registration Act",
    description: "The registers, and what the state does about what they show.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Count Only",
        description: "The census alone: the nation counts itself and does nothing with the sum.",
      },
      {
        name: "Registration Service",
        description:
          "The registration service: births, marriages, and deaths recorded continuously.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Family Programmes",
        description: "Family programmes support household formation with services and credits.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Population Policy",
        description: "An active population policy balances regions and generations by design.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Full Demographic Policy",
        description:
          "Full demographic policy: a comprehensive population strategy with programmes to match.",
        gdpCostFraction: 0.0018,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.society.civicLife.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.civicLife",
        weight: 1,
      },
    ],
    title: "Voluntary Bodies and Charities Act",
    description: "The village hall, the WI, and the state's quiet scaffolding beneath them.",
    category: "society",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Support",
        description: "Associations are unaided; the village hall leaks on its own account.",
      },
      {
        name: "Charitable Framework",
        description: "The charitable framework: status and rate relief for the voluntary bodies.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Community Facilities",
        description: "Community facilities: halls and institutes co-funded with the councils.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Civic Service",
        description:
          "Civic service: national volunteering programmes staffing the voluntary sector.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Civic Renaissance Drive",
        description: "The civic renaissance drive: maximal support for the associational nation.",
        gdpCostFraction: 0.0014,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.society.familyStability.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.familyStability",
        weight: 1,
      },
    ],
    title: "Family Allowances Act",
    description: "The allowance book at the post office, and everything behind it.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Allowances",
        description: "Families are unsupported; the household budget is a private struggle.",
      },
      {
        name: "Second-Child Allowance",
        description: "The allowance begins at the second child, drawn weekly at the post office.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Family Allowances",
        description: "Universal family allowances: a payment for every child in the book.",
        incomeCostFraction: 0.0086,
      },
      {
        name: "Family Support System",
        description:
          "The family support system: allowances plus housing priority for growing families.",
        incomeCostFraction: 0.0143,
      },
      {
        name: "Full Family Charter",
        description:
          "The full family charter: comprehensive family policy from allowance to inheritance.",
        incomeCostFraction: 0.0215,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.society.tradition.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "society.tradition",
        weight: 1,
      },
    ],
    title: "Crown, Church and Heritage Act",
    description: "Coronations, cathedrals, and the keeping of the old ways.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "Heritage goes unattended; the great houses fall and the customs fade.",
      },
      {
        name: "National Observances",
        description: "National observances: the ceremonies and monuments kept in dignified order.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Heritage Programmes",
        description: "Heritage programmes: the historic buildings listed and protected.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "National Tradition Drive",
        description:
          "A national tradition drive: curricula and commissions tending the inheritance.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "National Identity Charter",
        description:
          "The national identity charter: maximal heritage investment, the old ways endowed.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "uk.governance.participation.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.participation",
        weight: 1,
      },
    ],
    title: "Representation and Franchise Act",
    description: "Who may vote, and how easily the state lets them.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Restricted Franchise",
        description:
          "The franchise is narrowed; participation is a privilege wearing the costume of a right.",
      },
      {
        name: "Universal Franchise",
        description: "Universal franchise secured: one person, one vote, one register.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Modern Registration",
        description:
          "Modern registration: rolling registers and access rules that keep the rolls honest.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Access Enforcement",
        description:
          "Access enforcement: participation actively enabled, the polling station brought to the voter.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Full Participation Charter",
        description:
          "The full participation charter: maximal participation machinery, no elector left off the roll.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.governance.openness.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.openness",
        weight: 1,
      },
    ],
    title: "Official Information and Publications Act",
    description: "Cracking the door on the official mind.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Official Secrecy",
        description: "Whitehall's business is its own; the official mind is a locked box.",
      },
      {
        name: "Publication Rules",
        description: "Publication rules: gazettes and command papers disclosing the formal record.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Records Access",
        description: "Records access: request rights with independent review.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Open Government Standard",
        description: "The open government standard: disclosure by default, secrecy argued for.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Radical Transparency",
        description:
          "Radical transparency: a comprehensive openness regime across the departments of state.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.governance.localAutonomy.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.localAutonomy",
        weight: 1,
      },
    ],
    title: "Local Government Finance Act",
    description: "What Whitehall sends the town hall, and with how many strings.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Grant System",
        description: "The councils live on the rates alone, and the rates buy little.",
      },
      {
        name: "Specific Grants",
        description: "Specific grants fund narrow named services on Whitehall's terms.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Grant Settlement",
        description: "The grant settlement: a broad annual settlement funding the town halls.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Block Grants",
        description: "Block grants: flexible funds the councils direct themselves.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Devolved Finance",
        description:
          "Devolved finance: general revenue sharing, the town hall trusted with the purse.",
        gdpCostFraction: 0.0045,
      },
    ],
  },
  {
    id: "uk.governance.integrity.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.integrity",
        weight: 1,
      },
    ],
    title: "Public Accounts and Tribunals Act",
    description: "The committees and auditors keeping ministers honest.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Watchdogs",
        description: "Conduct goes unpoliced; the minister's honor is the only audit.",
      },
      {
        name: "Audit Office",
        description: "The audit office examines the accounts and reports to the House.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Accounts and Standards",
        description:
          "Accounts and standards: committee scrutiny with teeth, the accounting officer answerable.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Anticorruption Regime",
        description:
          "An anticorruption regime: tribunals and inspectors with powers of compulsion.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Glass-House Standard",
        description:
          "The glass-house standard: maximal integrity apparatus, every red box auditable.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "uk.governance.administration.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.administration",
        weight: 1,
      },
    ],
    title: "Civil Service and Whitehall Act",
    description: "The permanent government: recruited, ranked, and running the state.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Patronage Service",
        description: "The patronage service: jobbery and connection staff the state.",
      },
      {
        name: "Merit Foundations",
        description:
          "Merit foundations: entry by open competition, the crammer replacing the cousin.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Professional Service",
        description: "The professional service: a classified career service running the state.",
        gdpCostFraction: 0.002,
      },
      {
        name: "Administrative Excellence",
        description:
          "Administrative excellence: the mandarin machine at full strength and reputation.",
        gdpCostFraction: 0.0028,
      },
      {
        name: "Reformed Whitehall",
        description:
          "Reformed Whitehall: modern management throughout, the machine overhauled while running.",
        gdpCostFraction: 0.004,
      },
    ],
  },
  {
    id: "uk.governance.decisiveness.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.decisiveness",
        weight: 1,
      },
    ],
    title: "Cabinet and Machinery of Government Act",
    description: "Whether the centre can actually decide, and make it stick.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Fragmented Government",
        description:
          "The departments run uncoordinated; the centre is an address, not an authority.",
      },
      {
        name: "Cabinet Offices",
        description: "The cabinet secretariat and committees impose minutes and sequence.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Organized Centre",
        description:
          "The organized centre: central coordination at strength, business dispatched in order.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Streamlined Command",
        description:
          "Streamlined command: reorganization powers to redraw the departments at will.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Decisive Executive",
        description:
          "The decisive executive: maximal central coherence, one government speaking as one.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "uk.governance.centralAuthority.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "governance.centralAuthority",
        weight: 1,
      },
    ],
    title: "Parliamentary Sovereignty and Crown Powers Act",
    description: "Whether an Act of Parliament settles the matter, everywhere.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Weak Centre",
        description: "The writ barely runs; an Act of Parliament is a suggestion in the provinces.",
      },
      {
        name: "Enforcement Capacity",
        description: "Enforcement capacity: Crown enforcement funded and used.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Assured Sovereignty",
        description:
          "Assured sovereignty: Parliament's writ reliable in every corner of the kingdom.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Strong Centre",
        description: "A strong centre: preemption used deliberately against local deviation.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Commanding Centre",
        description:
          "The commanding centre: maximal central authority, the town hall an agent of the Crown.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "uk.defense.diplomacy.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.diplomacy",
        weight: 1,
      },
    ],
    title: "Diplomatic Service Act",
    description: "The Foreign Office and the world it still expects to arrange.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Skeleton Service",
        description: "A skeleton service: missions shuttered and the bags half empty.",
      },
      {
        name: "Professional Service",
        description: "The professional service: staffed embassies and a treaty desk that delivers.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Global Diplomacy",
        description: "Global diplomacy: worldwide presence and conference power at every table.",
        gdpCostFraction: 0.006,
      },
      {
        name: "Diplomatic Offensive",
        description:
          "The diplomatic offensive: summits convened and standing envoys everywhere that matters.",
        gdpCostFraction: 0.0095,
      },
      {
        name: "Great-Power Diplomacy",
        description:
          "Great-power diplomacy: maximal reach, the world still arranged partly from London.",
        gdpCostFraction: 0.0141,
      },
    ],
  },
  {
    id: "uk.defense.institutions.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.institutions",
        weight: 1,
      },
    ],
    title: "Commonwealth and International Bodies Act",
    description: "The Commonwealth, the UN seat, and the dues of standing.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Memberships",
        description: "Outside the institutions: no memberships, no dues, no standing.",
      },
      {
        name: "Member in Standing",
        description: "A member in standing: dues paid, delegations seated, votes cast.",
        gdpCostFraction: 0.002,
      },
      {
        name: "Commonwealth Leadership",
        description: "Commonwealth leadership: the club led, funded, and chaired.",
        gdpCostFraction: 0.004,
      },
      {
        name: "System Architect",
        description: "The system architect: institutions shaped and financed to British design.",
        gdpCostFraction: 0.0065,
      },
      {
        name: "Order Underwriter",
        description: "The order's underwriter: a system's chief financier, and its quiet author.",
        gdpCostFraction: 0.0096,
      },
    ],
  },
  {
    id: "uk.defense.softPower.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.softPower",
        weight: 1,
      },
    ],
    title: "External Broadcasting and Culture Act",
    description: "The wireless voice and cultural hand of Britain abroad.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Voice Abroad",
        description: "Silence on the airwaves: the nation's case goes unargued abroad.",
      },
      {
        name: "External Services",
        description: "External services funded: the world service on every shortwave band.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Broadcasting and Council",
        description:
          "Broadcasting plus the cultural council — the wireless voice and the touring exhibition.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Cultural Offensive",
        description: "The cultural offensive: libraries, tours, and scholarships across the globe.",
        gdpCostFraction: 0.0048,
      },
      {
        name: "Global Persuasion Drive",
        description:
          "The global persuasion drive: maximal cultural projection, the argument made in every capital.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "uk.defense.security.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.security",
        weight: 1,
      },
    ],
    title: "Security Services and Signals Act",
    description: "The quiet services and the listening stations.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Apparatus",
        description: "Espionage goes unopposed; the secrets leave by the front door.",
      },
      {
        name: "Security Foundations",
        description: "The quiet services are funded and staffed.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Security Establishment",
        description:
          "The establishment at strength: the services and the signals stations together.",
        gdpCostFraction: 0.0045,
      },
      {
        name: "Deep Security State",
        description:
          "A deep security state: expansive collection and vetting across government and industry.",
        gdpCostFraction: 0.0073,
      },
      {
        name: "Total Vigilance",
        description:
          "Total vigilance: the maximal apparatus, and the positive vetting file as a rite of passage.",
        gdpCostFraction: 0.0109,
      },
    ],
  },
  {
    id: "uk.defense.defenseIndustry.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.defenseIndustry",
        weight: 1,
      },
    ],
    title: "Defence Production and Research Act",
    description: "The aircraft works and establishments arming the services.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Industrial Policy",
        description:
          "No industrial policy: arms are bought abroad with dollars the Treasury lacks.",
      },
      {
        name: "Royal Ordnance Base",
        description: "The royal ordnance base: arsenals and yards maintained in being.",
        gdpCostFraction: 0.0045,
      },
      {
        name: "Production and Research",
        description:
          "Production and research: jets, electronics, and the establishments behind them.",
        gdpCostFraction: 0.0091,
      },
      {
        name: "Research and Production Drive",
        description:
          "The research-and-production drive: the bomber force's industry and the atomic establishments at full stretch.",
        gdpCostFraction: 0.0146,
      },
      {
        name: "Full Mobilization Base",
        description:
          "The full mobilization base: maximal industrial readiness across the aircraft works and yards.",
        gdpCostFraction: 0.0221,
      },
    ],
  },
  {
    id: "uk.defense.armedForces.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.armedForces",
        weight: 1,
      },
    ],
    title: "Armed Forces and National Service Act",
    description: "The regulars, the conscripts, and garrisons from the Rhine to Malaya.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Skeleton Forces",
        description:
          "A token establishment: skeleton forces for a power with worldwide commitments.",
      },
      {
        name: "Regular Forces",
        description: "Regular forces only: the professionals without the conscript mass.",
        gdpCostFraction: 0.0202,
      },
      {
        name: "Strong Standing Forces",
        description: "Strong standing forces: substantial regulars across the stations.",
        gdpCostFraction: 0.0303,
      },
      {
        name: "National Service Establishment",
        description:
          "The national service establishment: conscript-augmented forces from the Rhine to the far stations.",
        gdpCostFraction: 0.0429,
      },
      {
        name: "Mobilized Establishment",
        description: "The mobilized establishment: war-footing manpower held in peacetime.",
        gdpCostFraction: 0.0581,
      },
    ],
  },
  {
    id: "uk.defense.projection.primary",
    countryId: "UK",
    kind: "primary",
    targets: [
      {
        metricId: "defense.projection",
        weight: 1,
      },
    ],
    title: "Strategic Forces and Deterrent Act",
    description: "The bomb, the bombers to carry it, and the reach east of Suez.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Strategic Forces",
        description: "No strategic forces: no deterrent, and no reach beyond the horizon.",
      },
      {
        name: "Strategic Foundations",
        description: "Strategic foundations: the first weapons and the bomber plans.",
        gdpCostFraction: 0.0056,
      },
      {
        name: "Deterrent Programme",
        description: "The deterrent programme: the national deterrent building at speed.",
        gdpCostFraction: 0.0111,
      },
      {
        name: "Independent Deterrent",
        description:
          "The independent deterrent: a credible national strategic arm, answerable to London alone.",
        gdpCostFraction: 0.0177,
      },
      {
        name: "Great-Power Arsenal",
        description: "The great-power arsenal: maximal strategic force across every delivery arm.",
        gdpCostFraction: 0.0253,
      },
    ],
  },
  {
    id: "uk.sec.trunkRoadsFreight",
    countryId: "UK",
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
    title: "Trunk Roads and Freight Act",
    description: "Haulage corridors, docks access, and the goods the roads must carry.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "No freight programme exists; the lorries queue at the docks and the docks shrug.",
      },
      {
        name: "Corridor Improvements",
        description: "Corridor improvements clear the worst haulage chokepoints.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Freight Modernization",
        description: "Freight modernization: docks access, depots, and standardized corridors.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "National Logistics Drive",
        description: "A national logistics drive: the freight network planned as one system.",
        gdpCostFraction: 0.0032,
      },
      {
        name: "Continental-Scale Freight",
        description:
          "Continental-scale freight: road, rail, and port capacity meshed across the island.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "uk.sec.nationalServiceResettlement",
    countryId: "UK",
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
    title: "National Service Resettlement Act",
    description: "What the demobbed and the national serviceman are owed on the way out.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Resettlement Scheme",
        description:
          "No resettlement scheme exists; the demobbed man keeps his suit and his gratuity.",
      },
      {
        name: "Release Benefits",
        description: "Release benefits: a payment, a ration book, and a rail warrant home.",
        incomeCostFraction: 0.0016,
      },
      {
        name: "Training and Resettlement",
        description:
          "Training and resettlement: trade courses and placement for the returning serviceman.",
        incomeCostFraction: 0.0032,
      },
      {
        name: "Full Resettlement Programme",
        description:
          "The full resettlement programme: training, housing priority, and reserved places together.",
        incomeCostFraction: 0.0057,
      },
      {
        name: "Generations Programme",
        description:
          "The generations programme: resettlement benefits broadened until they remake civilian life.",
        incomeCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "uk.sec.nationalInsuranceExtension",
    countryId: "UK",
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
    title: "National Insurance Extension Act",
    description: "Periodic upratings carrying the stamp's promises to everyone.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Extension",
        description:
          "No extension is made; the stamp's promises stay where the original scheme drew them.",
      },
      {
        name: "Coverage Extension",
        description: "Coverage extension brings new trades under the stamp.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Benefit Uprating",
        description: "Benefit uprating lifts the rates toward what the shops actually charge.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Broad Extension",
        description: "Broad extension: the self-employed and the missed trades brought in.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Universal Adequacy Drive",
        description:
          "The universal adequacy drive: everyone stamped, and rates reviewed against real prices.",
        incomeCostFraction: 0.0108,
      },
    ],
    budgetKeyOverride: "statePensions",
  },
  {
    id: "uk.sec.atomicEnergyProgramme",
    countryId: "UK",
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
    title: "Atomic Energy Programme Act",
    description: "Harwell, the piles, and the island's own atomic ambitions.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Atomic Programme",
        description: "No atomic programme exists; the scientists' memoranda circulate unanswered.",
      },
      {
        name: "Research Establishments",
        description: "The research establishments take up the atomic problem.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Atomic Establishment",
        description: "The atomic establishment: an authority over piles, plants, and materials.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Power and Weapons Complex",
        description: "The power-and-weapons complex: dual-track development at full budget.",
        gdpCostFraction: 0.0042,
      },
      {
        name: "Atomic Age Leadership",
        description:
          "Atomic-age leadership: maximal investment across the island's whole nuclear enterprise.",
        gdpCostFraction: 0.0063,
      },
    ],
  },
  {
    id: "uk.sec.commonwealthCitizens",
    countryId: "UK",
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
    title: "Commonwealth Citizens and Equal Standing Act",
    description:
      "Whether the citizens of the Commonwealth arriving at the docks stand equal in law.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "No Statutory Protections",
        description:
          "No statutory protections exist; the newcomer's standing is whatever the landlady decides.",
      },
      {
        name: "Public Standing Rules",
        description: "Public standing rules: nondiscrimination in public services and offices.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Standing Commission",
        description: "A standing commission hears grievances and publishes findings.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Broad Enforcement",
        description: "Broad enforcement: housing and employment brought under the statute.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Full Standing Charter",
        description:
          "The full standing charter: comprehensive rights for every Commonwealth citizen, enforceable in court.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "uk.sec.highlandsRural",
    countryId: "UK",
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
    title: "Highlands and Rural Development Act",
    description: "Hydro schemes and lifelines for the glens and the far counties.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme reaches the glens; the far counties empty southward.",
      },
      {
        name: "Rural Boards",
        description: "Rural boards take up the lifeline services.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Hydro and Development Boards",
        description: "Hydro and development boards: dams in the glens and power down the straths.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Countryside Modernization",
        description: "Countryside modernization: services and industry seeded beyond the cities.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Rural Renaissance Drive",
        description:
          "The rural renaissance drive: the full apparatus aimed at keeping the far counties alive.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "uk.sec.agricultureDeficiency",
    countryId: "UK",
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
    title: "Agriculture and Deficiency Payments Act",
    description: "The annual price review and the cheque that keeps the farm going.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Farm Support",
        description: "No farm support exists; the harvest price is the market's mood.",
      },
      {
        name: "Marketing Boards",
        description: "Marketing boards steady the trade in milk and staples.",
        incomeCostFraction: 0.0029,
      },
      {
        name: "Price Guarantees",
        description: "Price guarantees floor the main commodities at the annual review.",
        incomeCostFraction: 0.0057,
      },
      {
        name: "Deficiency Payments System",
        description:
          "The deficiency payments system: the market price topped up to the guaranteed price by cheque.",
        incomeCostFraction: 0.01,
      },
      {
        name: "Full Parity Guarantee",
        description: "The full parity guarantee: the farm income floor written into permanent law.",
        incomeCostFraction: 0.0143,
      },
    ],
  },
  {
    id: "uk.sec.slumClearance",
    countryId: "UK",
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
    title: "Slum Clearance and Town Development Act",
    description: "Tearing down the courts and back-to-backs, and moving the people out.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme touches the courts and back-to-backs; the slum ages in place.",
      },
      {
        name: "Clearance Orders",
        description: "Clearance orders level the condemned streets.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Clearance and Overspill",
        description: "Clearance and overspill: the people moved out as the courts come down.",
        gdpCostFraction: 0.0023,
      },
      {
        name: "Comprehensive Redevelopment",
        description:
          "Comprehensive redevelopment: whole districts re-planned and rebuilt in sequence.",
        gdpCostFraction: 0.0039,
      },
      {
        name: "Cities Rebuilt Drive",
        description: "The cities-rebuilt drive: clearance and rebuilding at metropolitan scale.",
        gdpCostFraction: 0.006,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "uk.sec.industrialRelations",
    countryId: "UK",
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
    title: "Industrial Relations and Trade Disputes Act",
    description: "The rules of the ring for unions, employers, and the settling of disputes.",
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
        name: "Conciliation Service",
        description: "The conciliation service stands between the parties before the walkout.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Bargaining Framework",
        description:
          "The bargaining framework: recognition, procedure, and the umpires to referee it.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Strong Bargaining Order",
        description:
          "A strong bargaining order: duties to bargain enforced on both sides of the table.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Industrial Peace Charter",
        description:
          "The industrial peace charter: comprehensive machinery making the strike the last resort.",
        gdpCostFraction: 0.0004,
      },
    ],
  },
  {
    id: "uk.sec.universityGrants",
    countryId: "UK",
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
    title: "University Grants Committee Act",
    description: "The quiet committee funding the universities at arm's length.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Committee",
        description: "No committee exists; the universities live on endowments and fees.",
      },
      {
        name: "Grants Office",
        description: "A grants office makes the first exchequer awards.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Grants Committee",
        description:
          "The grants committee: public money at arm's length, the universities funded but not run.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Expanded Fellowships",
        description: "Expanded fellowships put stipends behind the graduate pipeline.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "National University Push",
        description:
          "The national university push: committee funding at scale across every faculty.",
        gdpCostFraction: 0.0017,
      },
    ],
  },
  {
    id: "uk.sec.hospitalBuilding",
    countryId: "UK",
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
    title: "Hospital Building Programme Act",
    description: "New wards for a service still living in Victorian brick.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Building Programme",
        description:
          "No building programme exists; the service works out of Victorian brick and army huts.",
      },
      {
        name: "Repairs and Extensions",
        description: "Repairs and extensions patch the worst of the estate.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Building Programme",
        description: "The building programme: new hospitals rising on a planned schedule.",
        gdpCostFraction: 0.002,
      },
      {
        name: "Regional Hospital Plan",
        description: "The regional hospital plan: a modern district hospital for every population.",
        gdpCostFraction: 0.0035,
      },
      {
        name: "Universal Bed Standard",
        description: "The universal bed standard: beds per thousand guaranteed everywhere.",
        gdpCostFraction: 0.0053,
      },
    ],
  },
  {
    id: "uk.sec.monopoliesMergers",
    countryId: "UK",
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
    title: "Monopolies and Mergers Act",
    description: "The commission asking whether the cartel serves the public interest.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Commission",
        description:
          "No commission exists; the cartel serves the public interest by its own account.",
      },
      {
        name: "Inquiry Commission",
        description: "An inquiry commission investigates and reports.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Commission with Powers",
        description: "A commission with powers: orders, undertakings, and prohibitions.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Active Market Policing",
        description: "Active market policing: mergers reviewed before the ink dries.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Open Commerce Charter",
        description: "The open commerce charter: fair-dealing enforced across every trade.",
        gdpCostFraction: 0.0008,
      },
    ],
  },
  {
    id: "uk.sec.nationalityMigration",
    countryId: "UK",
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
    title: "British Nationality and Migration Act",
    description: "Who may come from the Commonwealth, and what a British passport means.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Closed Door",
        description: "The door is closed; entry is the exception and refusal the rule.",
      },
      {
        name: "Restricted Entry",
        description: "Restricted entry: vouchers and quotas at the gangway.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Open Commonwealth Door",
        description:
          "The open Commonwealth door: the passport of the realm honored from every dominion.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Managed Expansion",
        description: "Managed expansion: wider entry with settlement services behind it.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Open Door Policy",
        description: "The open door: admission generous by design, citizenship a paved road.",
        gdpCostFraction: 0.0006,
      },
    ],
  },
  {
    id: "uk.sec.justiceAdministration",
    countryId: "UK",
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
    title: "Justice Administration Act",
    description: "Running the courts as a service, not a ritual.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme funds the machinery; the courts run on wax seals and patience.",
      },
      {
        name: "Court Administration",
        description: "Court administration funded: clerks, lists, and records in order.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Justice Administration",
        description:
          "Justice administration: a professional office running the courts as a service.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Expanded Access Programme",
        description:
          "The expanded access programme: aid, fee relief, and sessions where the litigants live.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Model Justice System",
        description:
          "The model justice system: the machinery funded to run without queues or lost files.",
        gdpCostFraction: 0.0008,
      },
    ],
  },
  {
    id: "uk.sec.borstalPrisonReform",
    countryId: "UK",
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
    title: "Borstal and Prison Reform Act",
    description: "The borstals and the argument over what prison is for.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reform",
        description:
          "No reform enters the walls; the prison is a warehouse with rules from the last century.",
      },
      {
        name: "Basic Standards",
        description: "Basic standards: capacity, safety, and inspection minimums.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Borstal System",
        description:
          "The borstal system: training regimes for the young in place of the adult yard.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Modern Corrections",
        description: "Modern corrections: classification, education, and preparation for release.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Model Corrections System",
        description:
          "The model corrections system: institutions run to published standards, release planned from sentencing.",
        gdpCostFraction: 0.0011,
      },
    ],
  },
  {
    id: "uk.sec.specialBranchExpansion",
    countryId: "UK",
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
    title: "Special Branch Expansion Act",
    description: "The Branch's reach into subversion and the organized underworld.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Expansion",
        description: "No expansion is made; the Branch covers the map thinly and knows it.",
      },
      {
        name: "Branch Offices",
        description: "Branch offices open in the provincial forces.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Branch Expansion",
        description: "Branch expansion: officers, files, and liaison at national scale.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "National Coordination",
        description:
          "National coordination: the forces' special work pooled against subversion and the syndicates.",
        gdpCostFraction: 0.00035,
      },
      {
        name: "Saturation Coverage",
        description: "Saturation coverage: capacity that closes cases faster than they open.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "uk.sec.countrysideAccess",
    countryId: "UK",
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
    title: "Countryside and Access Act",
    description: "The national parks and the ramblers' hard-won paths.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme tends the countryside; the paths close stile by stile.",
      },
      {
        name: "Parks Maintained",
        description: "The parks are maintained: wardens posted and ways kept open.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Parks and Rights of Way",
        description: "Parks and rights of way: the ramblers' map secured in law.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Mission-Scale Investment",
        description: "Mission-scale investment: visitor works and restoration across the parks.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Crown Jewels Standard",
        description:
          "The crown-jewels standard: the national parks kept as the island's showpiece.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "uk.sec.cleanRiversSanitation",
    countryId: "UK",
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
    title: "Clean Rivers and Sanitation Act",
    description: "Sewage works for rivers that have carried the mills' waste for a century.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description: "No programme exists; the river remains the mill's drain.",
      },
      {
        name: "Treatment Grants",
        description: "Treatment grants fund the first municipal works.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Rivers Programme",
        description: "The rivers programme: sewage treatment basin by basin.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Clean Waters Drive",
        description: "The clean waters drive: treatment at every outfall, enforcement behind it.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Every River Swimmable",
        description: "Every river swimmable: the standard set, funded, and meant.",
        gdpCostFraction: 0.0027,
      },
    ],
  },
  {
    id: "uk.sec.civilDefenceCorps",
    countryId: "UK",
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
    title: "Civil Defence Corps Act",
    description: "Wardens, sirens, and the drills for a war nobody names.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Corps",
        description: "No corps exists; the wartime wardens have hung up their helmets.",
      },
      {
        name: "Warning Systems",
        description: "Warning systems: sirens and posts wired to a national net.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Civil Defence Corps",
        description: "The civil defence corps: wardens enrolled, trained, and drilled.",
        gdpCostFraction: 0.00076,
      },
      {
        name: "Shelter and Continuity",
        description:
          "Shelter and continuity: hardened basements and a government that can disperse.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Total Preparedness",
        description: "Total preparedness: the whole population drilled for the war nobody names.",
        gdpCostFraction: 0.002,
      },
    ],
  },
  {
    id: "uk.sec.electionsAdministration",
    countryId: "UK",
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
    title: "Elections Administration Act",
    description: "How the count is run, and who watches the counting.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description: "No standards govern the count; each returning officer improvises.",
      },
      {
        name: "Returning Officer Standards",
        description: "Returning officer standards fix procedure and reporting.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "National Standards",
        description: "National standards: one rulebook for registration, ballot, and count.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Enforcement Machinery",
        description: "Enforcement machinery: inspectors and petitions with teeth.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Full Guarantee Regime",
        description: "The full guarantee regime: the count administered under national warranty.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.sec.machineryOfGovernment",
    countryId: "UK",
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
    title: "Machinery of Government Act",
    description: "Committees with knives, pruning the departments of state.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Authority",
        description: "No authority exists to prune the departments; Whitehall accretes by habit.",
      },
      {
        name: "Review Committees",
        description: "Review committees map the duplication and file their reports.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Reorganization Authority",
        description: "Reorganization authority: departments merged and abolished by order.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Sweeping Consolidation",
        description:
          "Sweeping consolidation: the departments redrawn wholesale on committee lines.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Continuous Reform Mandate",
        description:
          "The continuous reform mandate: reorganization as a standing function of the centre.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.sec.broadcastingCharter",
    countryId: "UK",
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
    title: "Broadcasting Charter Act",
    description: "The Corporation, its charter, and the nation talking to itself.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Public Broadcasting",
        description:
          "No public broadcasting exists; the airwaves are silence or someone else's voice.",
      },
      {
        name: "Sound Broadcasting",
        description:
          "Sound broadcasting under charter: the wireless service funded by the licence.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Charter Broadcasting",
        description:
          "Charter broadcasting at strength: the Corporation's networks as national furniture.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Television Expansion",
        description: "Television expansion: transmitters marching up the map.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Full Public Service Media",
        description:
          "Full public-service media: the Corporation as a first-rank national institution.",
        gdpCostFraction: 0.0015,
      },
    ],
  },
  {
    id: "uk.sec.colomboPlanDevelopment",
    countryId: "UK",
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
    title: "Colombo Plan and Development Act",
    description: "Development money following the flag through the Commonwealth.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Aid Programmes",
        description:
          "No aid programmes exist; the Commonwealth's poor members wait on private capital.",
      },
      {
        name: "Relief Assistance",
        description: "Relief assistance: food and sterling for the hardest-pressed members.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Development Programmes",
        description:
          "Development programmes: plans, credits, and technicians through the Commonwealth.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Commonwealth Development Drive",
        description: "The Commonwealth development drive: whole projects delivered under the plan.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Development Underwriting",
        description:
          "Development underwriting: the Commonwealth's development carried on the British ledger.",
        gdpCostFraction: 0.0038,
      },
    ],
  },
  {
    id: "uk.sec.northAtlanticDefence",
    countryId: "UK",
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
    title: "North Atlantic and Commonwealth Defence Act",
    description: "The Atlantic alliance and the imperial defence agreements around it.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Alliances",
        description: "No alliances bind anyone; the island faces the hour alone again.",
      },
      {
        name: "Regional Pacts",
        description: "Regional pacts pledge consultation and staff talks.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Alliance System",
        description: "The alliance system: mutual-defence treaties with standing machinery.",
        gdpCostFraction: 0.0013,
      },
      {
        name: "Integrated Commands",
        description: "Integrated commands: joint staffs and common war plans with the allies.",
        gdpCostFraction: 0.0022,
      },
      {
        name: "Global Alliance Web",
        description:
          "The global alliance web: collective defence from the Atlantic to the far stations.",
        gdpCostFraction: 0.0033,
      },
    ],
  },
  {
    id: "uk.sec.territorialReserves",
    countryId: "UK",
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
    title: "Territorial and Reserve Forces Act",
    description: "The Terriers and the reserves behind the regulars.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reserve System",
        description:
          "No reserve system exists; the trained men scatter to civilian life and stay there.",
      },
      {
        name: "Territorial Army",
        description: "The Territorial Army drills in the drill halls on the weekend.",
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
          "A deep reserve structure: refresher training and mobilization slots for the multitude.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Nation in Arms",
        description:
          "The nation in arms: every trained man registered and assigned against the day.",
        gdpCostFraction: 0.0045,
      },
    ],
  },
  {
    id: "uk.sec.strategicMaterialsSterling",
    countryId: "UK",
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
    title: "Strategic Materials and Sterling Area Act",
    description: "Rubber, tin, and dollars — the sterling area's strategic ledger.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Stockpiles",
        description: "No stockpiles exist; the war economy would begin at an empty warehouse.",
      },
      {
        name: "Critical Materials",
        description: "Critical materials first: rubber, tin, and wolfram laid in.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Strategic Stockpile",
        description:
          "The strategic stockpile: a full schedule of materials at depth, dollars permitting.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Deep Reserves",
        description:
          "Deep reserves: multi-season stocks against a long interruption of the sea lanes.",
        gdpCostFraction: 0.0017,
      },
      {
        name: "Total Material Security",
        description: "Total material security: reserves sized for the war nobody schedules.",
        gdpCostFraction: 0.0025,
      },
    ],
  },
  {
    id: "uk.sec.quarriesMinerals",
    countryId: "UK",
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
    title: "Quarries and Minerals Act",
    description: "The working ground — quarried, mined, and paying rent to the Crown.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Grounds Withdrawn",
        description: "The grounds are withdrawn; neither quarry nor pit may open.",
      },
      {
        name: "Licensing Programme",
        description: "A licensing programme opens workings on standard rents.",
        gdpCostFraction: 0.0001,
        gdpRevenueFraction: 0.00015,
      },
      {
        name: "Expanded Access",
        description: "Expanded access: more acreage, faster rounds.",
        gdpCostFraction: 0.00015,
        gdpRevenueFraction: 0.0002,
      },
      {
        name: "Development Priority",
        description: "Development priority: the working grounds put to work in earnest.",
        gdpCostFraction: 0.0002,
        gdpRevenueFraction: 0.0003,
      },
      {
        name: "Full Multiple Use",
        description: "Full multiple use: quarried, mined, and restored under one doctrine.",
        gdpCostFraction: 0.00025,
        gdpRevenueFraction: 0.0004,
      },
    ],
  },
  {
    id: "uk.sec.fuelBoardsRegulation",
    countryId: "UK",
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
    title: "Fuel Boards Regulation Act",
    description: "The consumer councils standing between the boards and the bill.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Regulation",
        description: "No regulation stands between the boards and the bill.",
      },
      {
        name: "Tariff Oversight",
        description: "Tariff oversight reviews the boards' worst filings.",
        gdpCostFraction: 0.00015,
      },
      {
        name: "Board Regulation",
        description: "Board regulation: consumer councils with accountants and standing.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Price Stabilization",
        description: "Price stabilization: increases held to demonstrated cost.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Full Price Control",
        description: "Full price control: the household's heat and light priced by commission.",
        gdpCostFraction: 0.0007,
      },
    ],
  },
  {
    id: "uk.sec.schoolMealsMilk",
    countryId: "UK",
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
    title: "School Meals and Milk Act",
    description: "The third of a pint on every desk, and dinner behind it.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Provision",
        description:
          "No provision is made; the child learns on whatever breakfast the house could spare.",
      },
      {
        name: "Milk in Schools",
        description: "Milk in schools: the third of a pint on every desk.",
        incomeCostFraction: 0.0014,
      },
      {
        name: "Meals and Milk Service",
        description: "The meals and milk service: school dinner and milk together.",
        incomeCostFraction: 0.0029,
      },
      {
        name: "Universal Free Provision",
        description: "Universal free provision: every child fed at every school.",
        incomeCostFraction: 0.005,
      },
      {
        name: "Full Welfare in Schools",
        description:
          "Full welfare in schools: meals, milk, clothing funds, and holidays under one line.",
        incomeCostFraction: 0.0072,
      },
    ],
  },
  {
    id: "uk.sec.certificatesVocational",
    countryId: "UK",
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
    title: "Certificates and Vocational Standards Act",
    description: "What a certificate proves, from the City and Guilds to the GCE.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description:
          "No standards govern the paper; a certificate proves what its printer intended.",
      },
      {
        name: "Model Standards",
        description: "Model standards are published for the trades and schools.",
        gdpCostFraction: 0.00025,
      },
      {
        name: "Certificate System",
        description: "The certificate system: examined credentials with a registry behind them.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "National Certificates",
        description:
          "National certificates: one yardstick from the City and Guilds to the grammar school.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Universal Standards",
        description:
          "Universal standards: every credential examined, registered, and honored alike.",
        gdpCostFraction: 0.0012,
      },
    ],
  },
  {
    id: "uk.sec.assistedPlaces",
    countryId: "UK",
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
    title: "Assisted Places and Endowed Schools Act",
    description: "Scholarship boys, endowments, and the old schools' open door.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description: "No programmes exist; the old schools are for those who can write the cheque.",
      },
      {
        name: "Assisted Places Fund",
        description: "An assisted places fund opens a few doors on merit.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Assisted Places System",
        description: "The assisted places system: means-tested awards at national scale.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Broad Choice Support",
        description:
          "Broad choice support: scholarships and endowments sustaining a wide assisted sector.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Choice Funding",
        description:
          "Full choice funding: the independent sector opened wholesale on public assistance.",
        gdpCostFraction: 0.0011,
      },
    ],
  },
  {
    id: "uk.sec.maternityChildWelfare",
    countryId: "UK",
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
    title: "Maternity and Child Welfare Act",
    description: "Clinics, health visitors, and orange juice at the welfare.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "No programmes exist; birth and infancy are private ventures with private odds.",
      },
      {
        name: "Maternity Services",
        description: "Maternity services: clinics and midwives where families begin.",
        incomeCostFraction: 0.0013,
      },
      {
        name: "Mother and Child Service",
        description:
          "The mother-and-child service: health visitors, orange juice, and cod liver oil at the welfare.",
        incomeCostFraction: 0.0025,
      },
      {
        name: "Family Services System",
        description: "The family services system: one network from pregnancy through school age.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Universal Family Support",
        description: "Universal family support: every mother and infant under the service's eye.",
        incomeCostFraction: 0.0065,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "uk.sec.equalPayImplementation",
    countryId: "UK",
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
    title: "Equal Pay Implementation Act",
    description: "The long-promised principle, and whether the Treasury will pay for it.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "No Implementation",
        description:
          "No implementation is made; the principle is agreed and the cheque never drawn.",
      },
      {
        name: "Civil Service Equal Pay",
        description: "Civil service equal pay: the state pays its own women equally, by stages.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Public Sector Equal Pay",
        description: "Public sector equal pay: the principle extended across the public payroll.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Enforcement Powers",
        description: "Enforcement powers: tribunals and remedies behind the principle.",
        gdpCostFraction: 0.00035,
      },
      {
        name: "Full Employment Equality",
        description:
          "Full employment equality: pay, promotion, and protection equalized across every trade.",
        gdpCostFraction: 0.0005,
      },
    ],
  },
  {
    id: "uk.sec.exportCreditsEnterprise",
    countryId: "UK",
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
    title: "Export Credits and Enterprise Act",
    description: "Underwriting the export drive that pays for the imports.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "No programmes exist; the exporter carries the foreign buyer's risk alone.",
      },
      {
        name: "Credit Guarantees",
        description: "Credit guarantees underwrite the first contracts.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Export Credits Department",
        description: "The export credits department: guarantees as a standing national service.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Expanded Guarantees",
        description: "Expanded guarantees: cover at scale for the export drive.",
        gdpCostFraction: 0.001,
      },
      {
        name: "Enterprise Nation Drive",
        description:
          "The enterprise nation drive: maximal backing for the trade that pays for the imports.",
        gdpCostFraction: 0.0015,
      },
    ],
  },
  {
    id: "uk.sec.warPensionsServiceHealth",
    countryId: "UK",
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
    title: "War Pensions and Service Health Act",
    description: "Two wars' worth of debts, paid weekly at the post office.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "No programmes exist; two wars' worth of wounds are private expenses.",
      },
      {
        name: "Service Pensions",
        description: "Service pensions pay the disabled their weekly due.",
        incomeCostFraction: 0.0022,
      },
      {
        name: "Pensions and Treatment",
        description: "Pensions and treatment: the ministry's hospitals beside the pension book.",
        incomeCostFraction: 0.0043,
      },
      {
        name: "Expanded Care System",
        description: "The expanded care system: clinics, limbs, and convalescence under one roof.",
        incomeCostFraction: 0.0072,
      },
      {
        name: "Full Veterans Guarantee",
        description:
          "The full veterans guarantee: comprehensive lifetime provision for those who served.",
        incomeCostFraction: 0.0108,
      },
    ],
    budgetKeyOverride: "statePensions",
  },
  {
    id: "uk.sec.medicalResearchCouncil",
    countryId: "UK",
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
    title: "Medical Research Council Act",
    description: "The council's units, from penicillin's heirs to the smoking question.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Council",
        description: "No council exists; the laboratories live grant to charitable grant.",
      },
      {
        name: "Research Units",
        description: "Research units attach to the teaching hospitals.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Research Council",
        description: "The research council: standing units and programme grants on merit.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Disease Missions",
        description: "Disease missions: campaign-scale programmes against the great killers.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Conquest of Disease Drive",
        description:
          "The conquest-of-disease drive: maximal research until the mortality tables move.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "uk.sec.friendlySocietiesBenefits",
    countryId: "UK",
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
    title: "Friendly Societies and Benefits Act",
    description: "The societies and provident funds working alongside the state schemes.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the societies; the provident funds operate on trust and custom.",
      },
      {
        name: "Societies Recognized",
        description: "The societies are recognized and registered.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Benefits Market Rules",
        description: "Benefits-market rules: disclosure and solvency standards for the schemes.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Portable Benefits",
        description: "Portable benefits: cover that follows the member between employments.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Open Benefits Market",
        description:
          "The open benefits market: a national, portable, transparent provident economy.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.sec.nationalAssistanceReform",
    countryId: "UK",
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
    title: "National Assistance Reform Act",
    description: "The Board's visitors, the means test's ghost, and the deserving-poor debate.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Reform",
        description:
          "No reform touches the Board; the rolls grow by inertia and the visitors call unguided.",
      },
      {
        name: "Eligibility Review",
        description: "Eligibility review: the rolls audited case by case.",
        gdpCostFraction: 0.0001,
      },
      {
        name: "Casework Standards",
        description: "Casework standards: trained visitors and documented need.",
        gdpCostFraction: 0.0002,
      },
      {
        name: "Work-Linked Assistance",
        description: "Work-linked assistance: the allowance tied to the search for work.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Full Conditionality",
        description:
          "Full conditionality: assistance conditioned, verified, and reviewed throughout.",
        gdpCostFraction: 0.00045,
      },
    ],
  },
  {
    id: "uk.sec.newTowns",
    countryId: "UK",
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
    title: "New Towns Act",
    description: "Whole towns drawn on clean paper, out beyond the green belt.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme exists; the overspill piles into the same old streets.",
      },
      {
        name: "First Designations",
        description: "The first designations: corporations appointed and ground surveyed.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "New Towns Programme",
        description: "The new towns programme: whole towns rising beyond the green belt.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Second Generation",
        description:
          "The second generation: new designations with the lessons of the first built in.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Model Towns Drive",
        description:
          "The model towns drive: the new town as national showcase, planned to the last cul-de-sac.",
        gdpCostFraction: 0.0045,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "uk.sec.londonTransportBuses",
    countryId: "UK",
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
    title: "London Transport and Municipal Buses Act",
    description: "The Underground, the trolleybuses, and everyone's ride to work.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description: "No programme exists; the fleets age and the fares climb.",
      },
      {
        name: "Operating Support",
        description: "Operating support keeps the Underground and the buses running.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "Fleet Investment",
        description: "Fleet investment: new stock for the tubes and the garages.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Metropolitan Programme",
        description: "The metropolitan programme: extensions and coordination across the region.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Transit Renaissance",
        description:
          "The transit renaissance: comprehensive urban transport, fares low and headways short.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "uk.sec.secretVote",
    countryId: "UK",
    kind: "secondary",
    targets: [
      { metricId: "defense.institutions", weight: 0.6 },
      { metricId: "defense.projection", weight: 0.35 },
      { metricId: "governance.centralAuthority", weight: 0.3 },
    ],
    title: "Secret Vote",
    description: "The single unexplained line in the estimates that funds the secret services.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 0,
    budgetKeyOverride: "intelligence",
    levels: [
      {
        name: "Unfunded",
        description: "No secret vote is taken. The services keep their registry and little else.",
      },
      {
        name: "Nominal Provision",
        description: "A modest vote sustains a headquarters and a thin establishment abroad.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Standing Service",
        description:
          "The vote sustains the established stations and one network kept properly paid.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Expanded Service",
        description:
          "The vote carries several networks at full funding and the officers to run them.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Unrestricted Vote",
        description:
          "The sum is voted without particulars and the service answers for it to almost no one.",
        gdpCostFraction: 0.005,
      },
    ],
  },
];
