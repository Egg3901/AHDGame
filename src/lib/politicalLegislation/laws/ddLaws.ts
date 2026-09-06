/**
 * DD political-legislation catalog — the DDR at RU parity: same topology
 * (63 primaries, 40 secondaries with index-identical targets, 6 tax sliders)
 * and the RU catalog's cost economics (both NMP command economies), with
 * authored DDR surface text and 1953 enacted levels (SED consolidation, the
 * June uprising's shadow, reparations, resettlers, Wismut, the KVP).
 */

import type { PoliticalLaw } from "../types";

export const DD_LAWS: PoliticalLaw[] = [
  {
    id: "dd.tax.incomeTax",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 12,
      waypoints: [
        {
          rate: 0,
          label: "No Direct Taxation",
        },
        {
          rate: 6,
          label: "Minimal Schedule",
        },
        {
          rate: 12,
          label: "Standard Wage Tax",
        },
        {
          rate: 20,
          label: "Elevated Schedule",
        },
        {
          rate: 32,
          label: "Confiscatory Schedule",
        },
      ],
    },
    title: "Wage Tax Act",
    description:
      "The wage tax deducted at the pay office — modest beside what the state takes at the counter.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.tax.domesticCorporateTax",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "domesticCorporateTax",
      minRate: 0,
      maxRate: 85,
      step: 1,
      baselineRate: 60,
      waypoints: [
        {
          rate: 0,
          label: "Profits Retained by Enterprises",
        },
        {
          rate: 25,
          label: "Shared Remittance",
        },
        {
          rate: 45,
          label: "Majority Remittance",
        },
        {
          rate: 60,
          label: "Standard Remittance",
        },
        {
          rate: 80,
          label: "Total Remittance",
        },
      ],
    },
    title: "Enterprise Levy Act",
    description:
      "The deductions every people's enterprise remits to the budget after the plan's retentions.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.tax.foreignCorporateTax",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "foreignCorporateTax",
      minRate: 0,
      maxRate: 80,
      step: 1,
      baselineRate: 60,
      waypoints: [
        {
          rate: 0,
          label: "Concessions Invited",
        },
        {
          rate: 25,
          label: "Standard Assessment",
        },
        {
          rate: 45,
          label: "Elevated Assessment",
        },
        {
          rate: 60,
          label: "Punitive Assessment",
        },
        {
          rate: 80,
          label: "Prohibitive Assessment",
        },
      ],
    },
    title: "Foreign Enterprise Assessment Act",
    description:
      "What foreign enterprise pays for the rare privilege of operating on Republic soil.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.tax.payrollTax",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "payrollTax",
      minRate: 0,
      maxRate: 20,
      step: 0.5,
      baselineRate: 8,
      waypoints: [
        {
          rate: 0,
          label: "No Contributions",
        },
        {
          rate: 4,
          label: "Minimal Fund",
        },
        {
          rate: 8,
          label: "Standard Contribution",
        },
        {
          rate: 14,
          label: "Expanded Fund",
        },
        {
          rate: 20,
          label: "Maximum Fund",
        },
      ],
    },
    title: "Social Insurance Contributions Act",
    description:
      "The contribution every wage carries into the unified insurance — pension, sickness and accident under one card.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.tax.salesTax",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "salesTax",
      minRate: 0,
      maxRate: 45,
      step: 1,
      baselineRate: 28,
      waypoints: [
        {
          rate: 0,
          label: "No Product Levy",
        },
        {
          rate: 10,
          label: "Light Levy",
        },
        {
          rate: 28,
          label: "Standard Product Levy",
        },
        {
          rate: 36,
          label: "Elevated Levy",
        },
        {
          rate: 45,
          label: "Maximum Levy",
        },
      ],
    },
    title: "Product Levy Act",
    description: "The levy folded into every retail price — the budget's great quiet engine.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.tax.tariffs",
    countryId: "DD",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "tariffs",
      minRate: 0,
      maxRate: 30,
      step: 0.5,
      baselineRate: 0,
      waypoints: [
        {
          rate: 0,
          label: "Monopoly Trading Only",
        },
        {
          rate: 5,
          label: "Token Duties",
        },
        {
          rate: 12,
          label: "Standard Tariff",
        },
        {
          rate: 20,
          label: "Protective Wall",
        },
        {
          rate: 30,
          label: "Closed Border",
        },
      ],
    },
    title: "Customs and Foreign Trade Monopoly Act",
    description:
      "The monopoly does the trading; the customs line is a formality it keeps for ceremony.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "dd.economy.workerSecurity.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.workerSecurity",
        weight: 1,
      },
    ],
    title: "Labour Code and Works Agreements Act",
    description:
      "The labour book, the works collective agreement, and the union's seat at every plant.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Labour Code",
        description:
          "No labour code binds the enterprise: hours, wages, and dismissal are the works director's ledger entries.",
      },
      {
        name: "Basic Labour Code",
        description:
          "A basic code fixes the working day and safety minimums, enforced where an inspector happens to call.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Employment Protections",
        description:
          "Dismissal requires cause and the works council's signature; the union countersigns what the directorate decides.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Guaranteed Employment",
        description:
          "Every citizen is guaranteed a workplace — and bound to it, for the labour book travels with the worker.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Total Labour Charter",
        description:
          "The full charter: guaranteed employment, codified norms, paid rest, and a grievance path through the union for every works in the Republic.",
        gdpCostFraction: 0.0032,
      },
    ],
    reformTitle: "Labour Code Liberalization Act",
  },
  {
    id: "dd.economy.mobility.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.mobility",
        weight: 1,
      },
    ],
    title: "Social Assistance and Equalization Act",
    description: "Aid reaches the listed categories — invalids, resettlers, the war's widows.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Assistance",
        description:
          "Hardship is a private misfortune; the citizen in need petitions relatives, not the Republic.",
      },
      {
        name: "Categorical Assistance",
        description:
          "Aid flows only to the listed categories — invalids, resettlers, the war's widows — and the lists are short.",
        incomeCostFraction: 0.0041,
      },
      {
        name: "Broad Assistance",
        description:
          "Means-tested relief and resettlement grants reach beyond the categories, paid through the district councils.",
        incomeCostFraction: 0.0082,
      },
      {
        name: "Opportunity Programmes",
        description:
          "Retraining courses and organized placement move the displaced into the plan's new works and pits.",
        incomeCostFraction: 0.0138,
      },
      {
        name: "Universal Floor",
        description:
          "A universal floor: relief, retraining, housing priority, and placement guaranteed to any citizen the economy has left behind.",
        incomeCostFraction: 0.0204,
      },
    ],
  },
  {
    id: "dd.economy.householdIncome.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.householdIncome",
        weight: 1,
      },
    ],
    title: "State Retail Price Subsidies Act",
    description:
      "The HO counter and the ration card — prices held down where the plan can afford it.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Price Programme",
        description:
          "Retail prices float on scarcity; the queue and the western shop window set what the wage is worth.",
      },
      {
        name: "Staple Subsidies",
        description:
          "Bread, groats, and essentials are held at fixed prices in the state stores, whatever the cost to the budget.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Broad Subsidies",
        description:
          "The subsidy extends past staples to cloth, soap, and household goods across the state retail network.",
        incomeCostFraction: 0.0092,
      },
      {
        name: "Price Reduction Campaigns",
        description:
          "Recurring announced price cuts lower the state price list category by category, with appropriate ceremony.",
        incomeCostFraction: 0.0143,
      },
      {
        name: "Universal Price Shield",
        description:
          "A universal price shield pins the entire state assortment below cost, the budget silently absorbing the difference.",
        incomeCostFraction: 0.0214,
      },
    ],
  },
  {
    id: "dd.economy.stability.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.stability",
        weight: 1,
      },
    ],
    title: "State Plan Discipline Act",
    description: "The State Planning Commission and the discipline that makes targets law.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Plan Authority",
        description:
          "No planning authority exists; enterprises produce what they can and barter for what they cannot.",
      },
      {
        name: "Planning Commission",
        description:
          "The planning commission drafts control figures and monitors fulfilment, but its targets remain advice.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Binding Plan Targets",
        description:
          "Plan targets carry the force of law; failure to fulfil is answered before the ministry and the prosecutor.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Full Plan Command",
        description:
          "The plan commands every balance — steel, grain, labour — and the commission arbitrates all claims between ministries.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Total Economic Command",
        description:
          "Total command: every input, output, and price in the Republic set centrally, the market a memory.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "dd.economy.productivity.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.productivity",
        weight: 1,
      },
    ],
    title: "Industrial Investment Programme Act",
    description: "The furnaces and combines rebuilt from rubble and reparations.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No State Investment",
        description:
          "The state directs no investment; industry makes do with what survived the war and the reparations trains.",
      },
      {
        name: "Reconstruction Priorities",
        description:
          "Capital flows to the priority reconstructions — the named furnaces and machine works on the commission's list.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Sectoral Investment",
        description:
          "Branch programmes fund whole sectors by turn: metallurgy this cycle, chemicals the next.",
        gdpCostFraction: 0.0171,
      },
      {
        name: "General Plan Investment",
        description:
          "Heavy industry takes first claim on every mark of accumulation; consumer goods wait at the end of the queue.",
        gdpCostFraction: 0.0257,
      },
      {
        name: "Total Industrial Mobilization",
        description:
          "Maximal accumulation: the highest investment share the household sector can bear, poured into combines and new capacity.",
        gdpCostFraction: 0.0357,
      },
    ],
  },
  {
    id: "dd.economy.fiscal.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.fiscal",
        weight: 1,
      },
    ],
    title: "State Bank and Budget Discipline Act",
    description: "The State Bank's mark control — every enterprise account watched.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Fiscal Machinery",
        description:
          "No audit reaches the enterprise account; ministries spend as they report, and report as they please.",
      },
      {
        name: "State Bank Controls",
        description:
          "The State Bank operates credit and cash plans, watching enterprise accounts through its branch network.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Budget Discipline",
        description:
          "Ministries are held to their approved estimates, and overspending must be confessed to the finance ministry.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Financial Control",
        description:
          "Mark control in full: every transfer between enterprises passes the Bank's ledger, and irregularities travel upward fast.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Fiscal Command",
        description:
          "A total fiscal command: continuous audit of every account in the Republic, from ministry to village cooperative.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.economy.competition.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 1,
      },
    ],
    title: "Private Trades and Cooperatives Act",
    description:
      "The master craftsman's shop and the corner tradesman — the small economy the plan still tolerates.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Private Sector",
        description:
          "All production is ministerial; the last private workshops are absorbed or closed.",
      },
      {
        name: "Licensed Trades",
        description:
          "Artisan trades and cooperatives are tolerated under licence — the cobblers and tinsmiths the ministries cannot be bothered to run.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Trades and Cooperatives",
        description:
          "The private and cooperative sector receives legal standing, allocated supplies, and credit.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Expanded Private Sector",
        description:
          "The sector expands into services and light goods, filling the gaps the plan admits it leaves.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Open Small Enterprise",
        description:
          "Open small enterprise: private trades and cooperatives compete openly wherever the plan does not claim priority.",
        gdpCostFraction: 0.0021,
      },
    ],
    reformTitle: "Small Enterprise Expansion Act",
  },
  {
    id: "dd.education.universalSchooling.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.universalSchooling",
        weight: 1,
      },
    ],
    title: "Unified School Act",
    description: "One school for every child — the unified school that replaced the old sorting.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Universal Schooling",
        description:
          "Schooling is left to district means; the sorting of children resumes where the old system left it.",
      },
      {
        name: "Basic Foundation",
        description:
          "Universal primary grades: the foundation years compulsory and free for every child.",
        incomeCostFraction: 0.0092,
      },
      {
        name: "Eight-Year Standard",
        description:
          "The eight-year unified school becomes the universal standard, one school for every child of the Republic.",
        incomeCostFraction: 0.0173,
      },
      {
        name: "Ten-Year Expansion",
        description:
          "The ten-year school spreads district by district, completion targets written into the plan.",
        incomeCostFraction: 0.0265,
      },
      {
        name: "Universal Complete Secondary",
        description:
          "Ten years for every child, everywhere — full secondary education as universal obligation and guaranteed place.",
        incomeCostFraction: 0.0367,
      },
    ],
  },
  {
    id: "dd.education.teacherCorps.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.teacherCorps",
        weight: 1,
      },
    ],
    title: "New Teachers and School Construction Act",
    description:
      "The new-teacher courses that refilled the staffrooms, and the schoolhouses rising with the plan.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "Districts staff their schools as best they can; the shortage left by the dismissals is answered with larger classes.",
      },
      {
        name: "Teacher Institutes",
        description:
          "Pedagogical institutes train the new teachers — young, quickly schooled, and politically vetted.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Teachers and Buildings",
        description:
          "Training is paired with school construction, new buildings rising beside the new graduates.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Corps Expansion",
        description:
          "The corps expands with salary uplifts, housing priority, and paid postings to the villages.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Elite Teaching Service",
        description:
          "An elite teaching service: institute expansion, model salaries, and standing that makes the classroom a career.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "dd.education.adultSkills.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.adultSkills",
        weight: 1,
      },
    ],
    title: "Vocational Training and Works Schools Act",
    description: "The works school that turns the apprentice into a machinist.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Training System",
        description:
          "Trades are learned at the bench from whoever will teach them; the works trains only what it cannot poach.",
      },
      {
        name: "Apprentice Schools",
        description: "Factory apprentice schools attach training workshops to the major plants.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Trade Schools Network",
        description:
          "A trade school network organizes vocational training by branch, with certified trades.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Works Academy System",
        description:
          "The works academy system directs training and assigns graduates to the plan's priority sites.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Universal Retraining",
        description:
          "Universal retraining: any worker may be schooled into a new trade at state expense, in every district.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "dd.education.attainment.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.attainment",
        weight: 1,
      },
    ],
    title: "Attainment and Advancement Act",
    description: "Whether the children of farmhands and miners finish what they start.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description:
          "Nobody measures who finishes school; the drop-out goes to the pit or the field and the register closes.",
      },
      {
        name: "Completion Tracking",
        description:
          "Attainment is recorded and gaps flagged — the first honest count of who completes what, and where.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Advancement Support",
        description:
          "Stipends, evening schools, and correspondence courses catch the pupils work pulled out early.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Attainment Drive",
        description:
          "A funded completion drive: districts carry attainment targets, and the inspectorate follows the laggards.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Universal Attainment",
        description:
          "Universal attainment: every pupil carried through the full ladder, the state underwriting whatever that takes.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "dd.education.research.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.research",
        weight: 1,
      },
    ],
    title: "Academy of Sciences Act",
    description: "The academy re-founded, the institutes restaffed — minus those taken west.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No State Science",
        description: "The state funds no science; the institutes empty as their people drift west.",
      },
      {
        name: "Academy Restored",
        description:
          "The Academy's core institutes are restored and funded, the classical disciplines back on state rations.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Institute Network",
        description:
          "Branch institutes multiply across the districts — a campus for every major field.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Science at Full Priority",
        description:
          "Science moves to full priority: academies, prize funds, and the special institutes with their special stores.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Scientific Supremacy Drive",
        description:
          "A supremacy drive: maximal funding across every discipline, aimed at holding the laboratories the Republic still has.",
        gdpCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "dd.education.standards.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.standards",
        weight: 1,
      },
    ],
    title: "Unified Curriculum and Examinations Act",
    description: "One curriculum from the Baltic coast to the Ore Mountains, one examination day.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Standards",
        description:
          "Each school teaches its own programme; two graduates of the same grade may share nothing but the year.",
      },
      {
        name: "Model Programmes",
        description:
          "Model syllabi are published and recommended, and most schools adopt them for want of alternatives.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Unified Curriculum",
        description:
          "One curriculum and one examination bind every school from the coast to the Ore Mountains.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Standardization",
        description:
          "Inspectors enforce the unified syllabus lesson by lesson; deviation is a matter for the district council.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Uniformity",
        description:
          "Total uniformity: centrally set lessons, timetables, and texts, identical in every classroom of the Republic.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.education.choice.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "education.choice",
        weight: 1,
      },
    ],
    title: "School Assignment Act",
    description: "The district decides where a child learns; the family is informed.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "Assigned Schooling",
        description:
          "The district assigns each child a school and the family is informed; alternatives do not exist in law.",
      },
      {
        name: "Special Schools",
        description:
          "Special language and science schools open narrow selective tracks beside the district system.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Selective Admissions",
        description:
          "Competitive admission lets strong pupils test into schools beyond their district line.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Open Enrollment",
        description:
          "Families choose among state schools, places allocated by preference rather than address.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Full School Choice",
        description:
          "Full choice: funded alternatives to the district school, the mark following the pupil who leaves.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "dd.health.universalCare.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.universalCare",
        weight: 1,
      },
    ],
    title: "State Health Service Act",
    description: "The polyclinic and the works doctor — care assigned, not bought.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No State Service",
        description:
          "Care is bought, bartered, or begged; the doctor takes what the family can pay — if the doctor stayed.",
      },
      {
        name: "District Clinics",
        description:
          "District polyclinics provide basic consultation and dispensary care free at the point of use.",
        incomeCostFraction: 0.0071,
      },
      {
        name: "Polyclinic Network",
        description:
          "The polyclinic network is joined to hospitals and referrals in a single state service.",
        incomeCostFraction: 0.0133,
      },
      {
        name: "Universal State Service",
        description:
          "The universal service: free care for every citizen, with the works doctor embedded in the major plants.",
        incomeCostFraction: 0.0204,
      },
      {
        name: "Comprehensive Service",
        description:
          "A comprehensive service: full-spectrum guaranteed care from the village station to the specialist institute.",
        incomeCostFraction: 0.0286,
      },
    ],
  },
  {
    id: "dd.health.socialInsurance.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 1,
      },
    ],
    title: "Social Insurance and Pensions Act",
    description: "The unified social insurance — pension, sickness and accident under one card.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No State Pensions",
        description:
          "Old age is provided for by children, savings, or not at all; the state pays no pension.",
      },
      {
        name: "Categorical Pensions",
        description:
          "Pensions reach industrial workers and honoured categories; the village is largely excluded.",
        incomeCostFraction: 0.0163,
      },
      {
        name: "Unified Insurance",
        description:
          "The unified insurance: pension, sickness, and accident under one card, coverage widening.",
        incomeCostFraction: 0.0286,
      },
      {
        name: "Universal System",
        description:
          "The system becomes universal: pensions reach the countryside, and the cooperative farmer is written into the rolls.",
        incomeCostFraction: 0.0449,
      },
      {
        name: "Full Security Charter",
        description:
          "A full security charter: comprehensive old-age, invalidity, and survivor guarantees at rates a family can live on.",
        incomeCostFraction: 0.0633,
      },
    ],
    budgetKeyOverride: "statePensions",
    reformTitle: "Universal Pensions Act",
  },
  {
    id: "dd.health.prevention.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.prevention",
        weight: 1,
      },
    ],
    title: "Hygiene Inspectorate Act",
    description: "The hygiene inspectorate that vaccinates, inspects and quarantines.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Service",
        description:
          "Epidemics burn through unopposed; quarantine is whatever the village mayor improvises.",
      },
      {
        name: "Epidemic Stations",
        description:
          "Epidemic stations stand ready at the junctions and ports, tracing outbreaks before they travel.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Hygiene Inspectorate",
        description:
          "The hygiene inspectorate adds routine inspection and mass vaccination to the outbreak posts.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Full Hygiene Service",
        description:
          "The full hygiene service: universal vaccination campaigns, water and food controls, and quarantine powers used without hesitation.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Total Prevention State",
        description:
          "A total prevention state: the inspectorate reaches every settlement, and its decrees outrank the works director's plan.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "dd.health.outcomes.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.outcomes",
        weight: 1,
      },
    ],
    title: "Medical Outcomes and Specialists Act",
    description:
      "The university clinics where the Republic's medicine meets the world standard — or tries.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "Nobody measures what the clinics achieve; mortality is recorded, filed, and forgotten.",
      },
      {
        name: "Specialist Centers",
        description:
          "Specialist referral institutes in the district capitals take the cases the polyclinics cannot hold.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Outcomes Programme",
        description:
          "A specialist network with mortality targets — the plan's arithmetic applied to survival itself.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Excellence Network",
        description:
          "Flagship institutes per branch of medicine, staffed and equipped to the best standard the Republic can build.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "World-Standard Medicine",
        description:
          "World-standard medicine: maximal clinical investment, outcomes no delegation need apologize for.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "dd.health.responsibility.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.responsibility",
        weight: 1,
      },
    ],
    title: "Workplace Health and Fitness Act",
    description: "The sports badge and the works fitness break.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "The citizen's habits are his own affair; the state neither preaches nor provides.",
      },
      {
        name: "Hygiene Propaganda",
        description:
          "Hygiene propaganda in posters, wall newspapers, and works lectures — persuasion at pfennig cost.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Fitness Norms",
        description:
          "Physical-culture norms and the sports badge set fitness standards for youth and worker alike.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Sports Badge Campaigns",
        description:
          "Sports badge campaigns and sobriety drives target the bottle and the absenteeism it breeds.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Health Discipline",
        description:
          "Total health discipline: fitness norms and behavioral campaigns pressed through every collective in the Republic.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.health.providerChoice.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.providerChoice",
        weight: 1,
      },
    ],
    title: "Physician Practice Act",
    description: "The district assigns your polyclinic; a few private surgeries linger on.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "State Practice Only",
        description:
          "Every physician is a state employee at a state post; the assigned polyclinic is the only door.",
      },
      {
        name: "Residual Private Practice",
        description:
          "A residue of private surgeries and fee-paying clinics lingers on beside the state service.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Mixed Practice Rules",
        description:
          "Mixed practice rules: physician cooperatives and private surgeries licensed and regulated.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Broad Practice Choice",
        description:
          "Broad practice choice: private practice permitted alongside the state service, patients choosing their chair.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Open Medical Market",
        description:
          "An open medical market: free choice of provider, state and private practice competing for the patient.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.health.systemEfficiency.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "health.systemEfficiency",
        weight: 1,
      },
    ],
    title: "Health Service Efficiency Act",
    description: "Bed norms and supply ledgers — the plan's arithmetic applied to medicine.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "The service is unexamined: beds, stocks, and staff are whatever history left in place.",
      },
      {
        name: "Norms and Audits",
        description:
          "Bed norms and supply audits bring the plan's arithmetic to the hospital corridor.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Efficiency Programme",
        description:
          "Staffing norms and centralized procurement squeeze the waste the audits uncovered.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Service Rationalization",
        description:
          "Networks are consolidated by plan: duplicate wards merged, supply lines shortened, norms enforced.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Optimal Service Design",
        description:
          "Optimal service design: continuous administrative review, resources moved wherever the ledger says they serve best.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "dd.infrastructure.publicHousing.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 1,
      },
    ],
    title: "Housing Construction Programme Act",
    description:
      "A room in a shared flat amid the rubble — the waiting list is the true architect.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Housing Programme",
        description:
          "The state builds nothing; families crowd into what the bombs left, a room and a curtain per household.",
      },
      {
        name: "Emergency Repairs",
        description: "Emergency repairs make the damaged stock habitable, roof by roof.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Departmental Construction",
        description: "Ministries and works build departmental housing for their own people.",
        gdpCostFraction: 0.0086,
      },
      {
        name: "Mass Construction Drive",
        description:
          "A mass construction drive raises standardized blocks at scale, and the waiting lists finally begin to move.",
        gdpCostFraction: 0.0143,
      },
      {
        name: "Universal Housing Guarantee",
        description:
          "The universal guarantee: a separate flat for every family, delivered by the largest building programme the plan has carried.",
        gdpCostFraction: 0.0214,
      },
    ],
    budgetKeyOverride: "other",
    reformTitle: "Mass Housing Programme Act",
  },
  {
    id: "dd.infrastructure.transit.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.transit",
        weight: 1,
      },
    ],
    title: "Reichsbahn and Urban Transit Act",
    description:
      "The railway that lost its second track east — rebuilding what reparations rolled away.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme funds the network; the railway decays to the pace the timetable can survive.",
      },
      {
        name: "Network Maintenance",
        description:
          "Maintenance keeps the lines running: rails, ties, and rolling stock patched to schedule.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Reconstruction Programme",
        description:
          "War damage is repaired and the second tracks relaid — undoing what reparations lifted.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Expansion and Electrification",
        description:
          "Expansion and electrification: new lines, new stock, and the city railways rebuilt.",
        gdpCostFraction: 0.0143,
      },
      {
        name: "Total Network Buildout",
        description:
          "Total buildout: maximal investment in rail and urban transit, until the network runs ahead of the plan that fills it.",
        gdpCostFraction: 0.0207,
      },
    ],
  },
  {
    id: "dd.infrastructure.utilities.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.utilities",
        weight: 1,
      },
    ],
    title: "Electrification and Networks Act",
    description: "Power for the plan; the telephone can wait.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description:
          "The village burns kerosene and hauls water; the grid ends at the town limits.",
      },
      {
        name: "Urban Networks",
        description: "Cities are powered and piped, urban networks brought to standard.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Regional Grids",
        description:
          "Regional grids join the district networks, and the blackouts retreat to the countryside.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Republic Electrification",
        description:
          "Republic electrification carries power to the districts and water mains to the towns.",
        gdpCostFraction: 0.0071,
      },
      {
        name: "Total Connection",
        description:
          "Total connection: every settlement on the grid, every town piped — the bulb in the last village barn.",
        gdpCostFraction: 0.0107,
      },
    ],
  },
  {
    id: "dd.infrastructure.condition.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.condition",
        weight: 1,
      },
    ],
    title: "Public Works and Reconstruction Act",
    description: "Rebuilding what the war leveled and reparations carried off.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Ruins Left Standing",
        description: "The ruins stand as the war left them; bridges are planked, not rebuilt.",
      },
      {
        name: "Priority Reconstruction",
        description:
          "Priority reconstruction restores the named works — the key bridges, stations, and waterworks first.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Reconstruction Programme",
        description:
          "A scheduled programme rebuilds city by city, maintenance written into each year's estimates.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Full Renewal",
        description:
          "Full renewal: systematic modernization of everything the war touched and the reparations emptied.",
        gdpCostFraction: 0.0071,
      },
      {
        name: "Model Condition Standard",
        description:
          "A model condition standard, guaranteed across the Republic: inspection, repair, and replacement on a fixed cycle.",
        gdpCostFraction: 0.0107,
      },
    ],
  },
  {
    id: "dd.infrastructure.highways.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.highways",
        weight: 1,
      },
    ],
    title: "Roads and Autobahn Repair Act",
    description:
      "The inherited autobahn, patched and rationed for the freight the rails cannot carry.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Roads Programme",
        description: "No roads programme exists; the district roads dissolve into mud each spring.",
      },
      {
        name: "Trunk Repairs",
        description: "The trunk routes and the inherited autobahn are patched and kept passable.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Roads Programme",
        description:
          "District networks are improved: gravel to the county towns, asphalt where the traffic justifies it.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Paved Network Drive",
        description:
          "An all-weather paved drive connects the centers, and the lorry replaces the cart on state routes.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Total Road Grid",
        description:
          "A total road grid: comprehensive modern roads down to the district level, mud season notwithstanding.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "dd.infrastructure.ownership.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.ownership",
        weight: 1,
      },
    ],
    title: "Personal Property and Garden Plots Act",
    description:
      "The allotment garden and the little weekend hut — private ground the state indulges.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Ownership Programme",
        description:
          "Housing belongs to the state and is assigned by it; personal ownership of a dwelling is not contemplated.",
      },
      {
        name: "Garden Plots",
        description:
          "Garden plots and weekend cottages are permitted — a private half-hectare beside the cooperative fields.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Cooperative Housing",
        description:
          "Housing cooperatives are financed, letting groups of citizens build and hold flats jointly.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Ownership Support",
        description:
          "State credit backs private building, and the individual house regains legal standing.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Broad Ownership Charter",
        description:
          "A broad ownership charter: private construction and cooperative purchase actively promoted, with credit to match.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "dd.infrastructure.development.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.development",
        weight: 1,
      },
    ],
    title: "General Plans and Urban Design Act",
    description: "The national building programme: boulevards on paper, blocks in mud.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Planning",
        description: "Cities grow as industry drops them; no plan governs where the streets go.",
      },
      {
        name: "City General Plans",
        description:
          "Master general plans are drawn for the major cities, boulevards and squares approved in the capital.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Planning Institutes",
        description:
          "Professional planning institutes staff the work, and the general plan becomes a discipline.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Republic Planning Standard",
        description:
          "Every city of standing comes under a general plan; construction outside it requires a signature few obtain.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Total Design Authority",
        description:
          "Total design authority: comprehensive spatial command over every city and settlement, boulevard to last courtyard.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "dd.order.dueProcess.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.dueProcess",
        weight: 1,
      },
    ],
    title: "State Prosecutor Supervision Act",
    description: "The state prosecutor supervises legality — and answers to the same masters.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Supervision",
        description:
          "Detention is unreviewed; a citizen held by the service is a citizen filed away.",
      },
      {
        name: "Prosecutorial Review",
        description:
          "The state prosecutor formally supervises legality, reviewing arrests and terms on paper.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Procedural Code Enforced",
        description:
          "The procedural code gains teeth: counsel present, terms enforced, and review that occasionally releases.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Strong Process Rights",
        description:
          "Strong process rights: independent review with authority to overturn, and investigators who must answer for their files.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Full Rights Charter",
        description:
          "A full rights charter: comprehensive procedural guarantees, enforced against the organs as against anyone.",
        gdpCostFraction: 0.0032,
      },
    ],
    reformTitle: "Legality Restoration Act",
  },
  {
    id: "dd.order.legalAid.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.legalAid",
        weight: 1,
      },
    ],
    title: "Advocates Collegia Act",
    description: "The advocate speaks for the accused — briefly, and with care.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Defense Bar",
        description: "The accused stands alone; no bar exists to speak for him.",
      },
      {
        name: "Collegia Framework",
        description: "The advocates' collegia are chartered with licensed members and set fees.",
        incomeCostFraction: 0.0008,
      },
      {
        name: "Assigned Counsel",
        description:
          "Counsel is guaranteed at trial, assigned from the collegium where the accused cannot pay.",
        incomeCostFraction: 0.0018,
      },
      {
        name: "Broad Legal Aid",
        description:
          "Legal aid broadens across civil and criminal matters — the housing dispute as well as the dock.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Universal Legal Service",
        description:
          "A universal legal service: full public representation in any proceeding, free at the point of need.",
        incomeCostFraction: 0.0046,
      },
    ],
  },
  {
    id: "dd.order.communityTrust.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.communityTrust",
        weight: 1,
      },
    ],
    title: "People's Police Conduct Act",
    description: "The people's policeman's conduct book, and the complaint that may outrank it.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description:
          "The people's policeman's conduct is examined by no one below his commander, and rarely by him.",
      },
      {
        name: "Service Regulations",
        description: "Service regulations set conduct rules on paper, read aloud once and shelved.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Complaints Machinery",
        description:
          "A complaints machinery processes citizen grievances, and a docket number is at least a beginning.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Accountability Regime",
        description:
          "Inspections carry consequences: dismissals, demotions, and prosecutions for the worst of the service.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Service of the People",
        description:
          "A service of the people: policing measured by public confidence, with conduct boards the citizen can face without fear.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.order.safety.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.safety",
        weight: 1,
      },
    ],
    title: "Public Order Campaigns Act",
    description: "Campaigns against rowdyism and black-market trading.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "Street disorder goes unanswered; the black-market corner runs its own hours.",
      },
      {
        name: "Patrols and Posts",
        description:
          "Patrols and posts put the people's police on the street where the trouble is.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Order Campaigns",
        description:
          "Order campaigns target rowdyism and the black market, youth brigades marching beside the police.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Comprehensive Prevention",
        description:
          "Comprehensive prevention: volunteer patrols, street lighting, and the helper's armband on every evening street.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Total Public Order",
        description:
          "Total public order: maximal prevention apparatus, until the courtyard belongs to the house community again.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "dd.order.courts.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.courts",
        weight: 1,
      },
    ],
    title: "District Courts Act",
    description: "The district judge and the lay assessors beside him.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "Starved Courts",
        description: "Dockets pile up before empty benches; a hearing date is a rumor.",
      },
      {
        name: "Court Network",
        description:
          "The district courts are staffed: a judge and two lay assessors in every district.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Functioning Judiciary",
        description:
          "The judiciary functions: courts, assessors, and appeal review moving cases at a civilized pace.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Professional Judiciary",
        description:
          "Professional judges with legal training take the bench, and the docket keeps its calendar.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Model Court System",
        description:
          "A model court system: justice without queues, from the district session to the supreme court.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "dd.order.policeStrength.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.policeStrength",
        weight: 1,
      },
    ],
    title: "People's Police and Alert Units Act",
    description: "The beat officer and the barracked alert units behind him.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "Skeleton Forces",
        description:
          "Order is thinly held by skeleton forces; whole districts see a policeman monthly.",
      },
      {
        name: "Police Establishment",
        description: "City and district police establishments are funded and posted.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Full Police Network",
        description:
          "The network reaches full establishment strength, with posts in every settlement of size.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Police and Alert Units",
        description:
          "The alert units garrison the sensitive points — barracked formations standing behind the beat officer.",
        gdpCostFraction: 0.0086,
      },
      {
        name: "Saturation Enforcement",
        description:
          "Saturation enforcement: maximal manpower on the street and in the barracks, no district beyond a patrol's reach.",
        gdpCostFraction: 0.0129,
      },
    ],
  },
  {
    id: "dd.order.deterrence.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "order.deterrence",
        weight: 1,
      },
    ],
    title: "Penal System Act",
    description: "The old prisons refilled — sentencing severe, ceremonially judicial.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Penal Policy",
        description:
          "No penal policy exists beyond the sentence itself; the courts decide, the state merely locks the door.",
      },
      {
        name: "Prison System",
        description:
          "A conventional custodial system holds prisoners in the old prisons, and nothing more ambitious.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Labor Institutions",
        description:
          "Labor institutions put sentences to work — penal labor as correction and as output.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Expanded Penal Regime",
        description:
          "The expanded penal regime: a heavy apparatus of institutions, severe sentences ceremonially judicial.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Total Penal Economy",
        description:
          "The institutions as an industry: a total penal economy whose output appears in the plan beside the free economy's.",
        gdpCostFraction: 0.0086,
      },
    ],
    reformTitle: "Corrective System Reform Act",
  },
  {
    id: "dd.environment.conservation.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.conservation",
        weight: 1,
      },
    ],
    title: "Nature Reserves Act",
    description: "The nature reserves inherited and neglected.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Reserves",
        description:
          "Nature serves the plan without reservation; the inherited reserves are opened to the axe.",
      },
      {
        name: "Remnant Reserves",
        description: "A reduced reserve network survives — the remnants the decrees spared.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Reserve Restoration",
        description:
          "The reserves are rebuilt and staffed, the field stations back at their posts.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Protection Regime",
        description:
          "A protection regime sets binding limits on logging, draining, and despoliation inside the protected lands.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Total Stewardship",
        description:
          "Total stewardship: a sweeping conservation order across the Republic, and the plan must route around it.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "dd.environment.stewardship.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.stewardship",
        weight: 1,
      },
    ],
    title: "Land Improvement Act",
    description: "Drainage, dikes and the new fields the plan claims from the marsh.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "The fields and marshes go untended; the drained land re-floods and the dikes crumble.",
      },
      {
        name: "Drainage Works",
        description: "Drainage works and dikes reclaim the first fields from the marsh.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Improvement Programme",
        description:
          "The improvement programme: drainage, shelterbelts, and rotations remaking the farmland.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Land Improvement Drive",
        description:
          "The land improvement drive: irrigation and soil works at scale across the cooperatives.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Total Land Command",
        description:
          "Total land command: the maximal remaking of the landscape, every marsh and moor assigned its task.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "dd.environment.urbanAir.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.urbanAir",
        weight: 1,
      },
    ],
    title: "Urban Smoke and Sanitation Act",
    description: "The plan measures output in tons of lignite; the smoke is nobody's line item.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 0,
    levels: [
      {
        name: "No Controls",
        description: "The combine smokes as it must; the lignite haze is treated as weather.",
      },
      {
        name: "Sanitary Zones",
        description: "Sanitary buffer zones separate the worst plants from the nearest housing.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Emission Norms",
        description:
          "Emission norms arrive with inspectors, and the smokestack acquires a paper conscience.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Clean City Standard",
        description:
          "A binding clean-city standard forces filtration and relocation on the dirtiest works.",
        gdpCostFraction: 0.0016,
      },
      {
        name: "Healthy Cities Charter",
        description:
          "A healthy-cities charter: comprehensive urban environmental standards, enforced even against the favored combines.",
        gdpCostFraction: 0.0024,
      },
    ],
  },
  {
    id: "dd.environment.energySecurity.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.energySecurity",
        weight: 1,
      },
    ],
    title: "Power Stations Programme Act",
    description: "Lignite fields feeding new power stations — the Republic runs on brown coal.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description:
          "Generation stagnates at inherited capacity; new demand queues for old current.",
      },
      {
        name: "Station Repairs",
        description: "Existing stations are repaired and restored to nameplate output.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "New Stations",
        description:
          "New stations rise on the commission's schedule, fed by the brown-coal fields.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Great Constructions",
        description:
          "The great constructions: giant stations and their open-cast pits bending whole districts to the grid.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Energy Supremacy Drive",
        description:
          "An energy supremacy drive: maximal generation buildout, power to spare for any plan the center can write.",
        gdpCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "dd.environment.resourceDev.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.resourceDev",
        weight: 1,
      },
    ],
    title: "Lignite and Ore Extraction Act",
    description: "The open-cast lignite pits and the ore mountains worked around the clock.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description: "The pits idle; lignite and ore come up no faster than worn machinery allows.",
      },
      {
        name: "Basin Restoration",
        description: "War-damaged mines are restored and the flooded shafts pumped clear.",
        gdpCostFraction: 0.0014,
        gdpRevenueFraction: 0.0014,
      },
      {
        name: "Extraction Programme",
        description:
          "Mechanization and new cuts lift extraction across the lignite fields and ore mountains.",
        gdpCostFraction: 0.0029,
        gdpRevenueFraction: 0.0029,
      },
      {
        name: "Production Drive",
        description:
          "A production drive puts output targets at full priority, premiums for every ton above plan.",
        gdpCostFraction: 0.0043,
        gdpRevenueFraction: 0.0043,
      },
      {
        name: "Maximum Extraction",
        description:
          "Maximum extraction: all-out development of every field, the geology worked as hard as the miners.",
        gdpCostFraction: 0.0064,
        gdpRevenueFraction: 0.0057,
      },
    ],
  },
  {
    id: "dd.environment.affordability.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.affordability",
        weight: 1,
      },
    ],
    title: "Household Fuel Allocation Act",
    description: "Winter is a state matter: the briquette ration and the coal allocation.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Allocation",
        description:
          "Households are left to secure their own briquettes; winter is a private negotiation with the coal yard.",
      },
      {
        name: "Town Allocations",
        description:
          "Towns receive rationed allocations of coal and firewood through the district councils.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Allocation Programme",
        description:
          "A subsidized allocation programme carries household fuel at held prices across the network.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Guaranteed Supply",
        description:
          "Supply is guaranteed at fixed prices, the cellar filled before the first frost.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Universal Fuel Guarantee",
        description:
          "A universal fuel guarantee: a comprehensive energy floor beneath every household in the Republic.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "dd.environment.extraction.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "environment.extraction",
        weight: 1,
      },
    ],
    title: "Geological Survey and Licensing Act",
    description: "The survey brigades mapping what the ground owes the state.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Grounds Unsurveyed",
        description: "The ground goes unsurveyed; what it holds is guessed at, not known.",
      },
      {
        name: "Survey Expeditions",
        description: "Survey brigades map the districts, and the reserve registers begin to fill.",
        gdpCostFraction: 0.00043,
        gdpRevenueFraction: 0.0007,
      },
      {
        name: "Survey and Development",
        description: "Proven fields are opened by decree as the surveys certify them.",
        gdpCostFraction: 0.0007,
        gdpRevenueFraction: 0.0014,
      },
      {
        name: "Priority Development",
        description:
          "Priority development opens new fields at speed, the excavators a season behind the geologists.",
        gdpCostFraction: 0.0011,
        gdpRevenueFraction: 0.0021,
      },
      {
        name: "Maximum Access",
        description:
          "Maximum access: every district worked, every certified deposit assigned to a ministry and a plan line.",
        gdpCostFraction: 0.0016,
        gdpRevenueFraction: 0.0029,
      },
    ],
  },
  {
    id: "dd.society.integration.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.integration",
        weight: 1,
      },
    ],
    title: "Resettler Integration Act",
    description:
      "A quarter of the Republic arrived with a suitcase — homes, work and standing for the resettlers.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Resettler Policy",
        description:
          "The resettlers from the lost provinces hold no recognized standing; millions of newcomers are a census entry.",
      },
      {
        name: "Formal Equality",
        description:
          "Constitutional equality is declared for old resident and resettler alike, in text if not yet in practice.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Integration Programmes",
        description:
          "Integration programmes: housing, land, and work quotas easing the newcomers into the districts.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Substantive Equality",
        description:
          "Substantive equality: the resettler invested in — credits, cadre places, and the old distinctions retired.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Full Equality Charter",
        description:
          "A full equality charter: comprehensive enforcement of equal standing, with remedies a citizen can actually claim.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "dd.society.womensOpportunity.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.womensOpportunity",
        weight: 1,
      },
    ],
    title: "Women Workers and Creches Act",
    description: "The crane operator and the professor are women; so is everyone at the creche.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "The double burden is unrelieved: the shift, then the queue, then the stove, all on the same shoulders.",
      },
      {
        name: "Workplace Creches",
        description:
          "Enterprise creches take the children at the works gate for the length of the shift.",
        incomeCostFraction: 0.002,
      },
      {
        name: "Creches and Protections",
        description:
          "Nurseries are joined by maternity protections: paid leave, lighter duties, and the job held open.",
        incomeCostFraction: 0.0041,
      },
      {
        name: "Full Support Network",
        description:
          "A full support network makes childcare universally accessible, from works creche to district kindergarten.",
        incomeCostFraction: 0.0071,
      },
      {
        name: "Complete Opportunity System",
        description:
          "The complete system: childcare, protections, and advancement quotas — the state as co-parent in every household.",
        incomeCostFraction: 0.0102,
      },
    ],
  },
  {
    id: "dd.society.socialMobility.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.socialMobility",
        weight: 1,
      },
    ],
    title: "Workers' Advancement Act",
    description: "From the bench to the workers' faculty — the ladder the state built and guards.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "Origins decide destinies; the farmhand's son follows the plough, whatever his marks.",
      },
      {
        name: "Preparatory Courses",
        description: "Preparatory courses ready workers and farmers for the faculty examinations.",
        incomeCostFraction: 0.0015,
      },
      {
        name: "Advancement System",
        description:
          "Quotas, stipends, and evening study open the institutes to those already at the bench.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Cadre Elevator",
        description:
          "The cadre elevator: systematic promotion from below, the personnel offices ordered to find talent in the works.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Open Society Drive",
        description:
          "An open-society drive: maximal advancement machinery, until the biography matters less than the examination.",
        incomeCostFraction: 0.0077,
      },
    ],
  },
  {
    id: "dd.society.demography.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.demography",
        weight: 1,
      },
    ],
    title: "Family and Population Act",
    description: "Birth grants on one hand; the road west open on the other.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Population Policy",
        description:
          "The registers merely count; births, deaths, and departures westward are recorded, not managed.",
      },
      {
        name: "Motherhood Awards",
        description: "Motherhood awards and small grants honor the large family.",
        gdpCostFraction: 0.0014,
        gdpRevenueFraction: 0.0007,
      },
      {
        name: "Family Programmes",
        description: "Grants are joined by maternity homes and infant clinics in the districts.",
        gdpCostFraction: 0.0029,
        gdpRevenueFraction: 0.0014,
      },
      {
        name: "Pro-Natal Programme",
        description:
          "The pro-natal programme in full: awards, allowances, and the levy on the childless, all pulling one direction.",
        gdpCostFraction: 0.0043,
        gdpRevenueFraction: 0.0021,
      },
      {
        name: "Total Population Policy",
        description:
          "Total population policy: comprehensive demographic command, with targets for the cradle as for the blast furnace.",
        gdpCostFraction: 0.0064,
        gdpRevenueFraction: 0.0029,
      },
    ],
  },
  {
    id: "dd.society.civicLife.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.civicLife",
        weight: 1,
      },
    ],
    title: "Mass Organisations Act",
    description:
      "Every citizen belongs somewhere — the union, the youth league, the friendship society.",
    category: "society",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Organizations",
        description:
          "Public association is unorganized; citizens gather, if at all, without charter or roof.",
      },
      {
        name: "Official Societies",
        description:
          "Sanctioned societies are chartered — the anglers, the philatelists, the friends of nature.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Mass Organizations",
        description:
          "The mass organizations stand up in force: unions, youth league, and sport societies with dues and premises.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Civic Infrastructure",
        description:
          "Civic infrastructure at scale: houses of culture in the cities, village clubrooms in the countryside.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Total Civic Apparatus",
        description:
          "The total civic apparatus: every citizen enrolled somewhere, every evening organized, every hall lit.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "dd.society.familyStability.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.familyStability",
        weight: 1,
      },
    ],
    title: "State Family Aid Act",
    description: "The state grant arrives with the third child; the housing list teaches patience.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Aid",
        description:
          "Families manage on their own; the state's interest begins and ends at the registry office.",
      },
      {
        name: "Large-Family Grants",
        description:
          "Grants begin with the larger families, honoring the households the posters celebrate.",
        incomeCostFraction: 0.0041,
      },
      {
        name: "Family Aid System",
        description: "A family aid system adds single-mother allowances and hardship relief.",
        incomeCostFraction: 0.0082,
      },
      {
        name: "Expanded Family Support",
        description:
          "Support expands to universal child allowances, paid without regard to the family's shape.",
        incomeCostFraction: 0.0133,
      },
      {
        name: "Full Family Charter",
        description:
          "A full family charter: comprehensive family policy from allowances to housing priority, cradle to school bench.",
        incomeCostFraction: 0.0194,
      },
    ],
  },
  {
    id: "dd.society.tradition.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "society.tradition",
        weight: 1,
      },
    ],
    title: "National Heritage and Ceremonies Act",
    description: "New anthems over old bells — the Republic writing its own calendar.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description:
          "The past goes unattended; the anniversaries pass unmarked and the old bells ring for no one.",
      },
      {
        name: "State Observances",
        description:
          "State observances fill the new calendar: parades, anniversaries, and the appropriate salutes.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Ceremonies and Monuments",
        description:
          "Monuments, museums, and the approved canon fix the official memory in bronze and print.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Heritage Programme",
        description:
          "A heritage programme restores the palaces and puts folk ensembles on tour — the usable past, curated.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Total Memory Apparatus",
        description:
          "The total memory apparatus: maximal commemorative investment, the Republic writing its own calendar over the old one.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "dd.governance.participation.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.participation",
        weight: 1,
      },
    ],
    title: "National Front Elections Act",
    description: "Turnout approaches totality; the ballot lists one list.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Elections",
        description:
          "Deputies are appointed outright; the chamber assembles to applaud what was decided elsewhere.",
      },
      {
        name: "Single-List Elections",
        description:
          "Universal suffrage with a single list: the citizen votes, the list is already composed.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Organized Participation",
        description:
          "Participation is organized to totality — agitators at every door, and turnout that rounds to everyone.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Contested Chambers",
        description:
          "Multiple candidacies are permitted within the chambers, and a deputy may actually lose.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Full Participation Charter",
        description:
          "A full participation charter: open nomination and genuine contest, the chamber answerable to those who fill it.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.governance.openness.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.openness",
        weight: 1,
      },
    ],
    title: "Press Licensing and Information Act",
    description: "Nothing is printed without the office's paper allocation — and its approval.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "Censorship Regime",
        description:
          "The censor reads everything before the citizen reads anything; the unapproved page gets no paper.",
      },
      {
        name: "Official Gazettes",
        description:
          "Official gazettes publish the decrees and little else, but at least the decrees.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Documented Government",
        description:
          "Government is documented: records are kept, numbered, and some may even be consulted.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Open Government Standard",
        description:
          "Disclosure becomes the default, and the ministry must argue to keep a paper closed.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Radical Transparency",
        description:
          "Radical transparency: a comprehensive openness regime, the archives unlocked and the licensing office dark.",
        gdpCostFraction: 0.0013,
      },
    ],
    reformTitle: "Openness and Publicity Act",
  },
  {
    id: "dd.governance.localAutonomy.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.localAutonomy",
        weight: 1,
      },
    ],
    title: "District Administration Finance Act",
    description: "The district council's budget: real money, centrally counted.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Local Budgets",
        description:
          "Everything is financed from the center; the district council holds a rubber stamp and an empty cashbox.",
      },
      {
        name: "Delegated Estimates",
        description:
          "District councils execute delegated estimates — spending orders written in the capital.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Local Budget System",
        description:
          "District and county budgets take legal form, with revenues of their own to husband.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "District Autonomy",
        description:
          "District autonomy in finance: the districts manage real shares of revenue and set local priorities.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Devolved Republic",
        description:
          "A devolved republic: general revenue sharing, the center keeping accounts rather than keeping everything.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "dd.governance.integrity.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.integrity",
        weight: 1,
      },
    ],
    title: "State Control Commission Act",
    description: "The control commission inspects everyone — and reports to the very top.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Control Organs",
        description:
          "Abuse goes unexamined; the auditor does not exist and the ledger fears no one.",
      },
      {
        name: "Audit Directorate",
        description: "An audit directorate inspects accounts and reports what it dares.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "State Control",
        description:
          "The control commission conducts inspections with sanctions attached — the signature that ends careers.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Anticorruption Regime",
        description:
          "An anticorruption regime with independent investigation powers, reaching into the ministries themselves.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Glass-House Standard",
        description:
          "The glass-house standard: maximal integrity apparatus, every official's affairs open to inspection at any hour.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "dd.governance.administration.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.administration",
        weight: 1,
      },
    ],
    title: "Ministries and State Apparatus Act",
    description: "The branch ministries and their armies of clerks — thoroughness, doubled.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Improvised Administration",
        description:
          "Administration is improvised: rule by decree, telephone, and whoever answers.",
      },
      {
        name: "Ministerial System",
        description: "Branch ministries are established, each with its apparatus and its ledger.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Professional Apparatus",
        description:
          "A professional apparatus: trained cadres fill the organs, and files move by procedure rather than favor.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Full Administrative State",
        description:
          "The administrative state at full strength — staffed, regulated, and reaching every district.",
        gdpCostFraction: 0.0086,
      },
      {
        name: "Rationalized Apparatus",
        description:
          "A rationalized apparatus: modern management throughout, German thoroughness applied to itself.",
        gdpCostFraction: 0.0121,
      },
    ],
  },
  {
    id: "dd.governance.decisiveness.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.decisiveness",
        weight: 1,
      },
    ],
    title: "Council of Ministers Act",
    description: "Decisions come from one room — and one house on the square.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Fragmented Command",
        description:
          "The organs work at cross purposes; two ministries can occupy one question for a decade.",
      },
      {
        name: "Coordinating Council",
        description:
          "A coordinating council holds joint sittings and issues protocols the branches mostly follow.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Organized Center",
        description:
          "An organized center: the presidium and branch bureaus sort questions before they pile.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Unified Command",
        description:
          "Unified command — one room decides quickly, and the decision leaves the room the same day.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Decisive Executive",
        description:
          "The decisive executive: maximal central coherence, no question orphaned and no decree contradicting another.",
        gdpCostFraction: 0.0011,
      },
    ],
  },
  {
    id: "dd.governance.centralAuthority.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "governance.centralAuthority",
        weight: 1,
      },
    ],
    title: "Democratic Centralism Act",
    description: "The centre decides; the districts concur.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Weak Center",
        description:
          "The center's writ weakens with distance; the districts drift on their own headings.",
      },
      {
        name: "Central Enforcement",
        description:
          "Central enforcement puts inspectors and plenipotentiaries behind every decision.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Assured Supremacy",
        description:
          "Central law prevails reliably over district deviation, and everyone has stopped testing it.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Command Vertical",
        description:
          "The command vertical: the center's instruction absolute at every level of the apparatus.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Vertical",
        description:
          "The total vertical: maximal central authority, one signal from the capital reaching the last village council unaltered.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.defense.diplomacy.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.diplomacy",
        weight: 1,
      },
    ],
    title: "Foreign Ministry and Missions Act",
    description: "A ministry recognized by half the world — the fraternal half.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Skeleton Service",
        description:
          "The missions are shuttered and the service skeletal; the Republic speaks abroad rarely, and through its patron.",
      },
      {
        name: "Professional Service",
        description: "A professional service staffs the embassies the fraternal world will host.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Fraternal Diplomacy",
        description:
          "Fraternal diplomacy: full presence across the bloc, and campaigns for recognition beyond it.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Diplomatic Offensive",
        description:
          "The diplomatic offensive: summits, peace campaigns, and initiatives pressed on every neutral capital.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Great-Power Diplomacy",
        description:
          "Great-power diplomacy by proxy and persistence — no conference convenes without the Republic seeking its chair.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "dd.defense.institutions.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.institutions",
        weight: 1,
      },
    ],
    title: "Fraternal Relations and Economic Council Act",
    description: "The council seats and treaties binding the Republic to its friends.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Bloc Institutions",
        description: "The allies stand unorganized; fraternity is a toast, not a treaty.",
      },
      {
        name: "Bilateral Treaties",
        description:
          "Bilateral friendship treaties bind the Republic to each fraternal state in turn.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Bloc Institutions",
        description:
          "Bloc institutions joined in earnest: the economic council seat, coordinated plans, standing committees.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Integrated Bloc",
        description:
          "An integrated bloc: joint planning and joint commands, the fraternal economies meshed by design.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Order Underwriter",
        description:
          "The order's underwriter: the Republic carries a lead share of the bloc's institutions and their bills.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "dd.defense.softPower.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.softPower",
        weight: 1,
      },
    ],
    title: "International Voice Act",
    description:
      "The world service and the friendship societies — the Republic introducing itself.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Voice Abroad",
        description:
          "Silence on the airwaves: the Republic's case abroad goes unmade, and the other Germany speaks unanswered.",
      },
      {
        name: "External Broadcasting",
        description: "External broadcasting carries the Republic's voice in many tongues.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Voice and Friendship",
        description:
          "Broadcasting is joined by friendship societies in every country that will host one.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Cultural Offensive",
        description:
          "The cultural offensive: festivals, touring ensembles, and delegations — the orchestra as foreign policy.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Global Persuasion Drive",
        description:
          "A global persuasion drive: maximal cultural projection, on every frequency and every stage.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "dd.defense.security.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.security",
        weight: 1,
      },
    ],
    title: "State Security Service Act",
    description: "The service. One does not discuss the service.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Apparatus",
        description:
          "No apparatus opposes the foreign services; espionage proceeds as if invited, in both directions.",
      },
      {
        name: "Security Directorate",
        description:
          "A security directorate stands up counterintelligence against the foreign services.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Security Establishment",
        description:
          "The establishment in full: foreign and internal directorates, each with its floors and files.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Deep Security State",
        description:
          "The deep security state: pervasive vigilance, and a file that opens before its subject suspects it exists.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Total Vigilance",
        description:
          "Total vigilance: the maximal apparatus, watching everything — including, inevitably, itself.",
        gdpCostFraction: 0.0086,
      },
    ],
    reformTitle: "State Security Reorganization Act",
  },
  {
    id: "dd.defense.defenseIndustry.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.defenseIndustry",
        weight: 1,
      },
    ],
    title: "Defence Industry Directorate Act",
    description: "Repair works and licensed patterns — an arms industry on a short leash.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No War Industry",
        description: "No war industry exists; what the war left was dismantled and shipped east.",
      },
      {
        name: "Arsenal Base",
        description: "An arsenal base sustains repair works and licensed patterns.",
        gdpCostFraction: 0.005,
      },
      {
        name: "War Industry System",
        description:
          "The war industry system: a directorate over armament works, building to fraternal designs.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Full Military Industry",
        description:
          "Full military industry: optics, electronics, and vehicles at scale, the Republic's specialties within the bloc.",
        gdpCostFraction: 0.0157,
      },
      {
        name: "Total War Economy",
        description:
          "The total war economy: maximal industrial mobilization, the civilian plan bent to feed the military one.",
        gdpCostFraction: 0.0221,
      },
    ],
  },
  {
    id: "dd.defense.armedForces.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.armedForces",
        weight: 1,
      },
    ],
    title: "Garrisoned Police and Armed Forces Act",
    description: "The barracked police that drill like an army, awaiting the name.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Skeleton Forces",
        description: "A token establishment: skeleton formations under a police name.",
      },
      {
        name: "Barracked Units",
        description:
          "The barracked units: a professional core drilling with more than police equipment.",
        gdpCostFraction: 0.0179,
      },
      {
        name: "Garrisoned Establishment",
        description: "The garrisoned establishment: a substantial conscript force in all but name.",
        gdpCostFraction: 0.0286,
      },
      {
        name: "Standing Army",
        description:
          "The standing army: full formations, heavy equipment, and the name finally spoken aloud.",
        gdpCostFraction: 0.0443,
      },
      {
        name: "War-Footing Establishment",
        description:
          "The war-footing establishment: full mobilization strength held in peacetime, whatever it costs the plan.",
        gdpCostFraction: 0.0593,
      },
    ],
  },
  {
    id: "dd.defense.projection.primary",
    countryId: "DD",
    kind: "primary",
    targets: [
      {
        metricId: "defense.projection",
        weight: 1,
      },
    ],
    title: "Alliance Contribution Act",
    description: "What the Republic adds to the alliance that garrisons it.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Contribution",
        description:
          "No contribution is made; the Republic shelters under the alliance and adds nothing to it.",
      },
      {
        name: "Token Contingents",
        description: "Token contingents take their place in the alliance's rear areas.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Alliance Contribution",
        description: "The alliance contribution: full formations assigned to the joint command.",
        gdpCostFraction: 0.0064,
      },
      {
        name: "Forward Deployment Role",
        description:
          "The forward deployment role: the Republic's forces integral to the alliance's first echelon.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Full Alliance Army",
        description:
          "The full alliance army: maximal contribution, the Republic's divisions counted among the alliance's best.",
        gdpCostFraction: 0.0143,
      },
    ],
  },
  {
    id: "dd.sec.canalsFreight",
    countryId: "DD",
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
    title: "Waterways and Freight Corridors Act",
    description: "The Elbe barges and freight corridors carrying coal the rails cannot.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No canal or corridor programme exists; freight takes the routes the last century left it.",
      },
      {
        name: "Corridor Works",
        description: "Corridor works upgrade the choke points — locks widened, junctions doubled.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Canals and Corridors",
        description:
          "Canals and corridors together: the Elbe barges and freight arteries modernized.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Great Waterways Drive",
        description:
          "The great waterways drive: the river trade rebuilt sea to mountains, at whatever the dredgers cost.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Total Freight Grid",
        description:
          "A total freight grid: water, rail, and road corridors meshed into one planned circulation.",
        gdpCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "dd.sec.demobilizationResettlement",
    countryId: "DD",
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
    title: "Returnee Resettlement Act",
    description: "What the returning prisoner of war is owed: a trade, a room, a start.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Resettlement Scheme",
        description:
          "No resettlement scheme exists; the returning prisoner walks home to whatever remains of it.",
      },
      {
        name: "Release Grants",
        description: "Release grants pay the returnee a settlement sum and a rail warrant.",
        incomeCostFraction: 0.0015,
      },
      {
        name: "Training and Placement",
        description: "Training and placement channel the returnees into trades and works rosters.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Full Resettlement Programme",
        description:
          "The full programme: housing priority, credits, and reserved places for every returning man.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Generations Programme",
        description:
          "A generations programme: the returnee and his family carried from the border crossing to trade, flat, and pension.",
        incomeCostFraction: 0.0077,
      },
    ],
  },
  {
    id: "dd.sec.insuranceExtension",
    countryId: "DD",
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
    title: "Insurance Extension Act",
    description: "New categories added to the insurance rolls with each plan year.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Extension",
        description:
          "No extension is made; the insurance rolls stay frozen at the established categories.",
      },
      {
        name: "Category Extensions",
        description:
          "New categories are added with each plan year — the miners this cycle, the teachers the next.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Benefit Upratings",
        description:
          "Benefit upratings lift the established pensions toward the cost of actually living.",
        incomeCostFraction: 0.0061,
      },
      {
        name: "Broad Extension",
        description:
          "Broad extension carries insurance to the trades and cooperatives the rolls had skipped.",
        incomeCostFraction: 0.0102,
      },
      {
        name: "Universal Adequacy Drive",
        description:
          "A universal adequacy drive: every worker insured, and rates reviewed against real prices.",
        incomeCostFraction: 0.0153,
      },
    ],
    budgetKeyOverride: "statePensions",
  },
  {
    id: "dd.sec.atomicProgramme",
    countryId: "DD",
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
    title: "Uranium Mining Directorate Act",
    description: "The uranium mountains and the directorate whose ore leaves east.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Uranium Programme",
        description: "No uranium programme exists; the ore mountains keep their secret.",
      },
      {
        name: "Survey Brigades",
        description: "Survey brigades map the deposits under appropriately vague names.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Mining Directorate",
        description:
          "The mining directorate: a numbered administration, closed towns, and wages nobody itemizes.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Full Mining Complex",
        description:
          "The full mining complex: shafts, mills, and processing under one unmarked roof.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Maximum Ore Deliveries",
        description:
          "Maximum ore deliveries: the mountains worked around the clock, the trains leaving east on schedule.",
        gdpCostFraction: 0.0064,
      },
    ],
  },
  {
    id: "dd.sec.unionRepublicsStanding",
    countryId: "DD",
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
    title: "Minority Standing Act",
    description: "The Sorbian schools and signage of Lusatia — the Republic's protected minority.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Statutory Standing",
        description:
          "No statutory standing exists; the Sorbian villages keep their language at home and off the signs.",
      },
      {
        name: "Formal Standing",
        description:
          "Formal standing is written into statute — a right that reads well in both languages.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Standing Commission",
        description:
          "A standing commission hears minority grievances and occasionally resolves one.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Broad Enforcement",
        description:
          "Broad enforcement: Sorbian schools and signage policed by inspectors with authority.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Full Standing Charter",
        description:
          "A full standing charter: comprehensive minority rights, enforceable in the Republic's courts.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.ruralElectrification",
    countryId: "DD",
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
    title: "Rural Electrification Act",
    description: "The bulb in the village barn — the plan's most visible promise.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No rural programme exists; the village watches the transmission lines pass overhead unbroken.",
      },
      {
        name: "District Stations",
        description: "District stations bring the first current to the rural county towns.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Rural Networks",
        description: "Rural networks string the lines outward to the cooperative farms.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Village Modernization",
        description:
          "Village modernization: power, pumps, and mills electrified across the countryside.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Rural Renaissance Drive",
        description:
          "A rural renaissance drive: the full grid to the last village, and the kerosene lamp retired.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "dd.sec.machineTractorStations",
    countryId: "DD",
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
    title: "Machine-Tractor Stations Act",
    description: "The station's tractors plough the cooperative's fields — and report on them.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Station Network",
        description:
          "No station network exists; the cooperatives plough with what they own, which is little.",
      },
      {
        name: "District Stations",
        description: "District stations lease tractors and combines to the surrounding farms.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Station Network",
        description:
          "The station network covers the farmland, machinery and mechanics on state account.",
        incomeCostFraction: 0.0061,
      },
      {
        name: "Full Station System",
        description:
          "The full system: every agricultural district served, the sowing timed by the station's schedule.",
        incomeCostFraction: 0.0102,
      },
      {
        name: "Total Mechanization",
        description:
          "Total mechanization: machinery for every operation, and the horse retired to ceremony.",
        incomeCostFraction: 0.0153,
      },
    ],
    reformTitle: "Agricultural Machinery Transfer Act",
  },
  {
    id: "dd.sec.workersSettlements",
    countryId: "DD",
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
    title: "Workers' Settlements Act",
    description: "Turning the plant barracks into something like towns.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme touches the settlements; the barracks towns around the works stay barracks.",
      },
      {
        name: "Settlement Upgrading",
        description:
          "Settlement upgrading brings water taps, lighting, and paved lanes to the worst of them.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Settlements Programme",
        description:
          "A settlements programme rebuilds systematically: clubs, schools, and clinics beside the dormitories.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Comprehensive Redevelopment",
        description:
          "Comprehensive redevelopment turns the works settlements into towns without qualification.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Model Settlements Drive",
        description:
          "A model settlements drive: the works town made a showcase, with amenities the old cities envy.",
        gdpCostFraction: 0.0071,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "dd.sec.tradeUnionRelations",
    countryId: "DD",
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
    title: "Trade Union Labor Relations Act",
    description:
      "The union confederation's committees in every works — transmission belt and grievance desk.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the workplace; the directorate decides and the union, if present, watches.",
      },
      {
        name: "Union Committees",
        description: "Union committees are chartered in the enterprises with a consultative voice.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Relations Framework",
        description:
          "A relations framework: works agreements signed and grievance procedures that produce answers.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Strong Union Role",
        description:
          "A strong union role: the committee's consent required on norms, dismissals, and housing lists.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Workplace Democracy Charter",
        description:
          "A workplace democracy charter: the collective's voice binding on the directorate across the enterprise.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.higherEducationInstitutes",
    countryId: "DD",
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
    title: "Workers' and Peasants' Faculties Act",
    description: "The workers' faculties minting the new intelligentsia.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme exists; the universities admit the same families they always have.",
      },
      {
        name: "Faculty Places",
        description:
          "Funded faculty places open the workers' and peasants' faculties at the universities.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Faculties Expansion",
        description: "The faculties expand: preparatory years that turn machinists into students.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Expanded Stipends",
        description:
          "Expanded stipends put a living allowance behind every admitted worker-student.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Universal Higher Education Push",
        description:
          "A universal push: the new intelligentsia minted at scale, with places for all who qualify.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "dd.sec.hospitalConstruction",
    countryId: "DD",
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
    title: "Hospital Construction Act",
    description: "New wards for a service still working out of prewar buildings.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Building Programme",
        description:
          "No building programme exists; the service works out of prewar buildings and converted barracks.",
      },
      {
        name: "Repairs and Wards",
        description: "Repairs and new wards patch the worst gaps in the network.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Construction Programme",
        description:
          "A construction programme raises new hospitals on a planned schedule, district by district.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Regional Hospital Plan",
        description:
          "The regional hospital plan: a full modern hospital for every district capital.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Universal Bed Standard",
        description:
          "A universal bed standard: beds per thousand guaranteed everywhere, built to whatever schedule that demands.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "dd.sec.stateArbitration",
    countryId: "DD",
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
    title: "State Contract Arbitration Act",
    description: "The tribunals where one people's enterprise sues another.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Arbitration",
        description:
          "No arbitration exists; enterprise disputes rot in ministerial correspondence.",
      },
      {
        name: "Arbitration Tribunals",
        description: "Arbitration tribunals hear contract disputes between people's enterprises.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Arbitration System",
        description:
          "The arbitration system in full: standing tribunals with published rules and enforced awards.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Active Contract Policing",
        description:
          "Active contract policing: arbitration reaches into delivery discipline before disputes ripen.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Open Commerce Charter",
        description:
          "An open commerce charter: fast, binding commercial adjudication that even the ministries respect.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.internalPassportResidence",
    countryId: "DD",
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
    title: "Registration and Movement Act",
    description:
      "The residence register and the permits that map every move — except the one west.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Movement Frozen",
        description:
          "Movement is frozen: registration binds each citizen to an address, and the exit permit is a rumor.",
      },
      {
        name: "Registration Regime",
        description:
          "The registration regime stands, but its enforcement follows procedure rather than whim.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Relaxed Registration",
        description:
          "Registration is relaxed: transfers approved routinely, and the residence stamp loses some teeth.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Open Registration",
        description:
          "Open registration: the citizen moves and registers after the fact, not by prior permission.",
        gdpCostFraction: 0.0016,
      },
      {
        name: "Free Settlement",
        description:
          "Free settlement: residence is a notification, not a privilege, anywhere in the Republic.",
        gdpCostFraction: 0.0021,
      },
    ],
    reformTitle: "Residence Liberalization Act",
  },
  {
    id: "dd.sec.justiceAdministration",
    countryId: "DD",
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
    description: "Clerks, registries and the files that make a judgment findable.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme funds the courts' machinery; the registrar shares one typewriter with three judges.",
      },
      {
        name: "Court Administration",
        description:
          "Court administration is funded: clerks, premises, and files that can be found again.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Justice Administration",
        description:
          "The administration modernizes: registries, transcripts, and schedules kept to standard.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Expanded Access Programme",
        description:
          "An expanded access programme: sessions in the districts, and fees no barrier to filing.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Model Justice System",
        description:
          "A model justice system: the machinery beneath the gavel funded to run without queues or lost files.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.correctiveStandards",
    countryId: "DD",
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
    title: "Penal Institutions Standards Act",
    description: "Rules for the institutions — observed where the inspector happens to stand.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description:
          "No standards govern the institutions; the regime inside is whatever the commandant makes it.",
      },
      {
        name: "Regime Regulations",
        description:
          "Regime regulations set rules for rations, labor, and discipline — observed unevenly.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Inspected Institutions",
        description:
          "Inspected institutions: the prosecutor walks the blocks and his reports carry weight.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Reformed Corrections",
        description:
          "Reformed corrections: standards enforced, excesses prosecuted, the regime bound by its own rules.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Model Corrections System",
        description:
          "A model corrections system: institutions run to published standards an inspector can verify unannounced.",
        gdpCostFraction: 0.0026,
      },
    ],
    reformTitle: "Amnesty and Review Act",
  },
  {
    id: "dd.sec.criminalInvestigations",
    countryId: "DD",
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
    title: "Criminal Police Directorate Act",
    description: "The detectives chasing the black market the state pretends not to have.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Directorate",
        description:
          "No directorate exists; the ordinary thief is chased, if at all, by the beat officer.",
      },
      {
        name: "Investigation Bureaus",
        description: "Investigation bureaus staff the cities with detectives and case files.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Central Directorate",
        description: "A central directorate coordinates investigations across district lines.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "National Coordination",
        description:
          "National coordination: files, forensics, and informants pooled against the black market's organizers.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Saturation Coverage",
        description:
          "Saturation coverage: an investigative apparatus that closes cases faster than the underworld opens them.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.parksGreenBelts",
    countryId: "DD",
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
    title: "Parks and Green Belts Act",
    description: "The culture park — where the city breathes on its day off.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description: "No programme plants anything; the city's green is what survived the bombing.",
      },
      {
        name: "City Parks",
        description: "City parks are funded — the culture park, band shell included.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Parks and Belts",
        description: "Parks and green belts together ring the industrial districts.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Green Ring Programme",
        description: "The green ring programme: forest belts around every major city.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "Garden Cities Standard",
        description:
          "A garden cities standard: comprehensive greenery from courtyard to ring, maintained like the infrastructure it is.",
        gdpCostFraction: 0.0011,
      },
    ],
  },
  {
    id: "dd.sec.waterSewerageWorks",
    countryId: "DD",
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
    title: "Water and Sewerage Works Act",
    description: "Pipes and treatment works for cities patched faster than their sewers.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme exists; the standpipe serves the street and the sewer is a ditch.",
      },
      {
        name: "City Works",
        description: "City works extend mains and treatment to the larger cities first.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Works Programme",
        description:
          "A works programme carries pipes and pumping stations down the city list on schedule.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Clean Waters Drive",
        description:
          "The clean waters drive: treatment works at every outfall, rivers recovering by decree.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Universal Sanitation",
        description:
          "Universal sanitation: piped water and sewerage for every settlement, engineering the plan's oldest debt away.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "dd.sec.localAirDefense",
    countryId: "DD",
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
    title: "Air Protection Service Act",
    description: "Sirens tested at noon; cellars listed as shelters.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Organization",
        description: "No organization exists; the sirens of the last war rust on their poles.",
      },
      {
        name: "Warning Posts",
        description: "Warning posts and sirens are restored and manned.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Protection Service",
        description:
          "The air protection service drills the works and house communities in earnest.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Shelter and Continuity",
        description:
          "Shelter and continuity: cellars hardened, stocks cached, and evacuation routes rehearsed.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Total Preparedness",
        description:
          "Total preparedness: the whole civil apparatus drilled for the war after the last one.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "dd.sec.electoralCommissions",
    countryId: "DD",
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
    title: "Electoral Commissions Act",
    description: "The commissions certifying results known well before the count.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Commissions",
        description: "No commissions exist; results are announced by whoever holds the hall.",
      },
      {
        name: "Commission Network",
        description: "A commission network administers the vote with lists, urns, and protocols.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Republic Standards",
        description:
          "Republic standards fix procedure everywhere: one law for every polling place.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Enforcement Machinery",
        description:
          "Enforcement machinery audits the count and prosecutes the falsifiers it finds.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Guarantee Regime",
        description:
          "A full guarantee regime: commissions independent enough that the count decides the result.",
        gdpCostFraction: 0.001,
      },
    ],
  },
  {
    id: "dd.sec.ministerialReorganization",
    countryId: "DD",
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
    title: "Ministerial Reorganization Act",
    description: "Ministries merged, split and renamed as the plan's chart demands.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Authority",
        description:
          "No authority exists to prune the apparatus; ministries multiply by budgetary mitosis.",
      },
      {
        name: "Review Commissions",
        description: "Review commissions map the duplications and report where the fat sits.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Reorganization Authority",
        description:
          "Reorganization authority: the center may merge, split, and abolish by decree.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Sweeping Consolidation",
        description:
          "Sweeping consolidation: the org chart redrawn wholesale, and thousands of desks with it.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Continuous Reform Mandate",
        description:
          "A continuous reform mandate: the apparatus permanently under review, no chair guaranteed its floor.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "dd.sec.stateRadioTelevision",
    countryId: "DD",
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
    title: "State Radio and Television Act",
    description: "The loudspeaker on the square and the first flickering television sets.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No State Broadcasting",
        description:
          "No state broadcasting exists; the loudspeakers on the squares fall silent — and the western signal fills the air.",
      },
      {
        name: "Radio Network",
        description:
          "The radio network carries the wired speaker into flats and squares across the Republic.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Radio and Television",
        description:
          "Radio is joined by television: the first studios and transmitters answering the signal from the west.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Television Expansion",
        description: "Television expands across the districts, relay mast by relay mast.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Full Republic Media",
        description:
          "Full republic media: broadcasting to every settlement, on every set the works can produce.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "dd.sec.fraternalAssistance",
    countryId: "DD",
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
    title: "Fraternal Assistance Act",
    description: "Credits and specialists for friends — from a Republic still rebuilding itself.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Assistance Programmes",
        description:
          "No assistance programmes exist; the fraternal states are congratulated and left to it.",
      },
      {
        name: "Reconstruction Credits",
        description:
          "Reconstruction credits underwrite the friends' rebuilding, on terms nobody reads aloud.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Assistance Programmes",
        description:
          "Assistance programmes send specialists, blueprints, and machinery with the credits.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Bloc Development Drive",
        description:
          "The bloc development drive: whole plants delivered and assembled on fraternal soil.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Development Underwriting",
        description:
          "Development underwriting: the Republic carries a lead share of the bloc's development on its own ledger.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "dd.sec.collectiveSecurityTreaties",
    countryId: "DD",
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
    title: "Collective Security Treaties Act",
    description: "The mutual-assistance clauses that station friends on the Republic's soil.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Treaties",
        description:
          "No treaties bind the allies; each fraternal army answers only to its own capital.",
      },
      {
        name: "Bilateral Pacts",
        description: "Bilateral pacts pair the Republic with each ally separately.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Treaty System",
        description: "A treaty system knits the pacts into one framework with mutual obligations.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Integrated Commands",
        description:
          "Integrated commands: joint staffs, common doctrine, and the friends' garrisons formalized.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Global Alliance Web",
        description:
          "A global alliance web: collective security wherever the bloc's writ or friendship reaches.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.reservesVoluntaryDefense",
    countryId: "DD",
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
    title: "Society for Sport and Technology Act",
    description: "Every glider club and radio circle doubles as the army's waiting room.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reserve System",
        description: "No reserve system exists; the discharged man's skills demobilize with him.",
      },
      {
        name: "Reserve Registers",
        description: "Reserve registers track the discharged by specialty and district.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Sport and Technology Society",
        description:
          "The sport and technology society: glider clubs, radio circles, and rifle ranges as the army's anteroom.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Deep Reserve Structure",
        description:
          "A deep reserve structure: refresher training and mobilization assignments for the multitude.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Nation in Arms",
        description:
          "A nation in arms: every fit citizen registered, trained, and assigned against the day.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "dd.sec.stateMaterialReserves",
    countryId: "DD",
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
    title: "State Material Reserves Act",
    description: "Grain, coal and steel held back for the day the plan fears.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Reserves",
        description:
          "No reserves are held; the state buys its grain and coal in the same season it burns them.",
      },
      {
        name: "Critical Stocks",
        description:
          "Critical stocks of grain and fuel are laid in against failure of harvest or supply.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "State Reserves System",
        description:
          "The state reserves system: numbered depots, rotation schedules, and an administration sworn to silence.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Deep Reserves",
        description:
          "Deep reserves: metals, machines, and medicines stocked across the depots in earnest.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Total Material Security",
        description:
          "Total material security: reserves sized for the emergency nobody names, audited and refreshed on schedule.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "dd.sec.quarriesLocalMaterials",
    countryId: "DD",
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
    title: "Quarries and Local Materials Act",
    description: "Sand, gravel and brick clay — reconstruction's unglamorous appetite.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "Grounds Unworked",
        description:
          "The grounds go unworked; reconstruction hauls sand and brick clay from wherever it can requisition them.",
      },
      {
        name: "Local Licensing",
        description: "Local licensing opens district quarries under council supervision.",
        gdpCostFraction: 0.00021,
        gdpRevenueFraction: 0.00043,
      },
      {
        name: "Expanded Workings",
        description: "Expanded workings supply the building trusts from planned pits.",
        gdpCostFraction: 0.00036,
        gdpRevenueFraction: 0.0006,
      },
      {
        name: "Development Priority",
        description:
          "Development priority: local materials scaled up ahead of the building drives that need them.",
        gdpCostFraction: 0.0006,
        gdpRevenueFraction: 0.0009,
      },
      {
        name: "Full Multiple Use",
        description:
          "Full multiple use: every workable deposit mapped, licensed, and feeding the nearest building site.",
        gdpCostFraction: 0.0008,
        gdpRevenueFraction: 0.0012,
      },
    ],
  },
  {
    id: "dd.sec.communalTariffs",
    countryId: "DD",
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
    title: "Communal Tariffs Act",
    description: "Rent frozen where the war left it; the difference comes out of the budget.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Regulation",
        description:
          "No regulation touches the tariffs; rent and heat cost what the housing office says this month.",
      },
      {
        name: "Tariff Schedules",
        description:
          "Tariff schedules are published, and the housing office must at least cite them.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Tariff Restraint",
        description: "Tariff restraint holds increases below the growth of wages.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Subsidized Tariffs",
        description:
          "Subsidized tariffs: rent and utilities held at a token share of the household budget.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Token Tariffs",
        description:
          "Token tariffs: pfennig rents by law, the budget quietly paying the difference forever.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "dd.sec.schoolMealsBoarding",
    countryId: "DD",
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
    title: "School Meals and Boarding Act",
    description: "A hot breakfast at school — for many children, the surest meal of the day.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Provision",
        description:
          "No provision is made; the pupil learns on whatever breakfast the household could spare.",
      },
      {
        name: "Hot Breakfasts",
        description: "Hot breakfasts are served in the schools of the industrial districts.",
        incomeCostFraction: 0.0015,
      },
      {
        name: "Meals and Boarding",
        description:
          "Meals and boarding together: canteens in the schools, boarding places where the village has none.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Universal Free Provision",
        description:
          "Universal free provision: every pupil fed at every school, every distant child boarded.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Full Welfare in Schools",
        description:
          "Full welfare in schools: meals, boarding, clothing funds, and summer camps under one budget line.",
        incomeCostFraction: 0.0077,
      },
    ],
  },
  {
    id: "dd.sec.qualificationsDiplomas",
    countryId: "DD",
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
    title: "Qualifications and Diplomas Act",
    description: "What the diploma certifies, and which ministry will honour it.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Standards",
        description:
          "No standards govern the paper; a diploma certifies whatever its issuer intended.",
      },
      {
        name: "Model Standards",
        description: "Model standards are published for the trades and the institutes.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Diploma System",
        description:
          "The diploma system: unified certificates from trade school to institute, registered centrally.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Republic Qualifications",
        description:
          "Republic qualifications: one register of trades and degrees, honoured by every ministry.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Universal Standards",
        description:
          "Universal standards: every qualification examined, registered, and honoured identically across the Republic.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "dd.sec.specialLanguageSchools",
    countryId: "DD",
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
    title: "Special and Language Schools Act",
    description: "The mathematics school and the Russian school — narrow doors, long queues.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Special Schools",
        description: "No special schools exist; the gifted pupil is taught at the district's pace.",
      },
      {
        name: "Special Schools",
        description:
          "Special schools open in the capitals — the mathematics school, the Russian school, doors much envied.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Expanded Tracks",
        description: "Expanded tracks bring selective streams to the district capitals.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Broad Selective System",
        description:
          "A broad selective system: special schools in every region, entered by examination.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Full Choice Funding",
        description:
          "Full choice funding: selective and specialized schooling funded wherever families and talent demand it.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.maternityChildWelfare",
    countryId: "DD",
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
    title: "Maternity Homes and Child Welfare Act",
    description: "The maternity home, the mothers' consultation, the milk kitchen.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "No programmes exist; birth and infancy are managed at home, with luck as the attending physician.",
      },
      {
        name: "Maternity Homes",
        description: "Maternity homes take deliveries in the towns, midwives on state salary.",
        incomeCostFraction: 0.0026,
      },
      {
        name: "Mother and Child Service",
        description:
          "The mother-and-child service: milk kitchens, mothers' consultations, and home visits after every birth.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Family Services System",
        description:
          "The family services system: maternity care threaded into one network from registration to school age.",
        incomeCostFraction: 0.0082,
      },
      {
        name: "Universal Family Support",
        description:
          "Universal family support: every mother and infant under the service's eye, town and village alike.",
        incomeCostFraction: 0.0122,
      },
    ],
    budgetKeyOverride: "welfare",
  },
  {
    id: "dd.sec.equalLaborStanding",
    countryId: "DD",
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
    title: "Equal Labor Standing Act",
    description: "Equal pay is the law; the night shift and the double burden are the practice.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Standing Rules",
        description:
          "No standing rules exist; the wage book pays her less and no office will hear of it.",
      },
      {
        name: "Formal Equality",
        description:
          "Formal equality is written into the labour code, awaiting anyone to enforce it.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Equal Standing Enforced",
        description:
          "Equal standing is enforced: pay audits by the inspectorate, violations answered with fines.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Enforcement Powers",
        description:
          "Enforcement powers with teeth: advancement quotas and the night-shift exemptions honoured in practice.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Full Employment Equality",
        description:
          "Full employment equality: pay, promotion, and protection equalized across every trade and grade.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "dd.sec.foreignTradeOperations",
    countryId: "DD",
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
    title: "Foreign Trade Operations Act",
    description: "The monopoly's trading arms — and the inner trade nobody names.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Trade Apparatus",
        description:
          "No trade apparatus exists; the monopoly holds the border shut and trades almost nothing through it.",
      },
      {
        name: "Trade Missions",
        description:
          "Trade missions open in the friendly capitals, buying machines and selling optics.",
        gdpCostFraction: 0.00036,
        gdpRevenueFraction: 0.0007,
      },
      {
        name: "Trade Operations System",
        description:
          "The operations system: branch trading corporations, each holding its slice of the monopoly.",
        gdpCostFraction: 0.0007,
        gdpRevenueFraction: 0.0014,
      },
      {
        name: "Expanded Exchanges",
        description:
          "Expanded exchanges: trade agreements multiplied, including the inner-German trade nobody names.",
        gdpCostFraction: 0.0012,
        gdpRevenueFraction: 0.0021,
      },
      {
        name: "Global Trade Offensive",
        description:
          "A global trade offensive: the monopoly's arms on every market where hard currency can be won.",
        gdpCostFraction: 0.0018,
        gdpRevenueFraction: 0.0029,
      },
    ],
  },
  {
    id: "dd.sec.warInvalidsProvision",
    countryId: "DD",
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
    title: "War Invalids Provision Act",
    description:
      "A war's worth of the maimed, pensioned and fitted with what the workshops can make.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Provision",
        description:
          "No provision is made; the war's maimed beg at the stations the war sent them through.",
      },
      {
        name: "Invalid Pensions",
        description: "Invalid pensions pay the certified categories their monthly due.",
        incomeCostFraction: 0.0041,
      },
      {
        name: "Pensions and Prosthetics",
        description: "Pensions are joined by prosthetics workshops and sanatorium places.",
        incomeCostFraction: 0.0082,
      },
      {
        name: "Expanded Care System",
        description:
          "The expanded care system: retraining, invalid carriages, and housing priority for the invalided.",
        incomeCostFraction: 0.0133,
      },
      {
        name: "Full Veterans Guarantee",
        description:
          "A full veterans guarantee: comprehensive lifetime provision for the war's wounded, owed and finally paid.",
        incomeCostFraction: 0.0194,
      },
    ],
    budgetKeyOverride: "statePensions",
  },
  {
    id: "dd.sec.medicalResearchInstitutes",
    countryId: "DD",
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
    description: "The academy's medical institutes and their disease registers.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Institutes",
        description:
          "No institutes pursue the diseases; medicine treats what it inherited and studies nothing.",
      },
      {
        name: "Research Units",
        description: "Research units attach to the major hospitals, chasing the common killers.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Institute Network",
        description:
          "An institute network takes the diseases by specialty — oncology here, cardiology there.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Disease Missions",
        description:
          "Disease missions: campaign-style research drives against tuberculosis and the other great killers.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Conquest of Disease Drive",
        description:
          "The conquest-of-disease drive: maximal research investment until the mortality tables yield.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "dd.sec.departmentalClinics",
    countryId: "DD",
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
    title: "Works Polyclinics Act",
    description: "The works polyclinic beside the gate — medicine on the plant's own ledger.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the works clinics; each combine doctors its own behind its own gate.",
      },
      {
        name: "Works Networks",
        description:
          "Works networks are chartered openly — the railway's polyclinics, the miners' sanatoria.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Parallel Systems Rules",
        description:
          "Parallel systems rules bind the works networks to common standards and reporting.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Portable Attachments",
        description:
          "Portable attachments: the worker keeps his polyclinic rights when he changes combines.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Open Attachment Market",
        description:
          "An open attachment market: any citizen may register with any network, funds following the patient.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "dd.sec.laborDisciplineSobriety",
    countryId: "DD",
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
    title: "Labor Discipline Act",
    description:
      "The work norm on the board; raising it once brought the Republic into the street.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Campaigns",
        description:
          "No campaigns are waged; the norm-breaker and the shirker answer only to their foreman's patience.",
      },
      {
        name: "Discipline Rules",
        description: "Discipline rules tighten lateness and absence penalties in the code.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Norm Campaigns",
        description:
          "Norm campaigns: agitation, wall newspapers, and the brigade's ledger read aloud.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Works Courts Drive",
        description:
          "The works courts drive: the collective judges its own idlers, publicly and by procedure.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Total Discipline Regime",
        description:
          "A total discipline regime: comprehensive campaigns binding the working day to the norm book.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "dd.sec.newIndustrialCities",
    countryId: "DD",
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
    title: "New Industrial Cities Act",
    description: "A steel town first — the city named for the state it builds.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme exists; the new combines rise and their workers sleep in mud and canvas.",
      },
      {
        name: "Plant Settlements",
        description:
          "Plant settlements are laid out with streets, water, and a school beside the works.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "New Cities Programme",
        description:
          "The new cities programme: whole towns founded to plan around the new combines.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Second Generation",
        description:
          "The second generation: new cities built with the amenities the first generation lacked from the start.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Model Cities Drive",
        description:
          "A model cities drive: the industrial city as showcase — planned, green, and photographed often.",
        gdpCostFraction: 0.0086,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "dd.sec.urbanTransport",
    countryId: "DD",
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
    title: "Urban Transport Act",
    description: "The tram at dawn, patched and full.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "No programme funds the fleets; the prewar trams grind on until they cannot.",
      },
      {
        name: "Tram Networks",
        description: "Tram networks are restored and re-tracked in the major cities.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Tram and Trolleybus Fleets",
        description:
          "Tram and trolleybus fleets expand together, the depots building as fast as the lines.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Metropolitan Programme",
        description:
          "The metropolitan programme: high-capacity routes and the city railway modernized.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Transit Renaissance",
        description:
          "A transit renaissance: comprehensive urban transport, the fare kept at a groschen and the wait at minutes.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "dd.sec.securityApparatus",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "defense.institutions", weight: 0.6 },
      { metricId: "defense.projection", weight: 0.35 },
      { metricId: "governance.centralAuthority", weight: 0.3 },
    ],
    title: "Security Apparatus Appropriation",
    description:
      "The allocation carried by the security apparatus, voted without public particulars.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 0,
    budgetKeyOverride: "intelligence",
    levels: [
      {
        name: "Unfunded",
        description: "No allocation is carried. The apparatus keeps its files and mounts nothing.",
      },
      {
        name: "Nominal Provision",
        description:
          "A minimal allocation sustains the central apparatus and a few officers abroad.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Standing Service",
        description:
          "The apparatus works its established posts and keeps one network properly funded.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Expanded Service",
        description: "Posts multiply and several networks are carried at full funding together.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Unrestricted Vote",
        description:
          "The allocation is carried without particulars and the apparatus goes where it chooses.",
        gdpCostFraction: 0.005,
      },
    ],
  },
];
