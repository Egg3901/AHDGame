/**
 * RU political-legislation catalog — TRANSCRIBED from the reviewed catalog document
 * docs/superpowers/specs/2026-07-17-legislation-catalog-ru.md (the content SSOT;
 * local-only). Do not hand-edit content here: fix the document, then re-transcribe.
 * Derived display figures (absolute currency amounts) are intentionally not carried.
 */

import type { PoliticalLaw } from "../types";

export const RU_LAWS: PoliticalLaw[] = [
  {
    id: "ru.tax.incomeTax",
    countryId: "RU",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 9,
      waypoints: [
        {
          rate: 0,
          label: "No Direct Taxation",
        },
        {
          rate: 5,
          label: "Minimal Schedule",
        },
        {
          rate: 9,
          label: "Standard Workers' Schedule",
        },
        {
          rate: 18,
          label: "Elevated Schedule",
        },
        {
          rate: 30,
          label: "Confiscatory Schedule",
        },
      ],
    },
    title: "Income Tax on the Population Act",
    description:
      "The modest direct levy on wages — the state prefers to take its share at the shop counter, not the pay packet.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.tax.domesticCorporateTax",
    countryId: "RU",
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
    title: "Enterprise Profit Remittances Act",
    description:
      "The deductions from profits every state enterprise remits to the budget after the plan's retentions.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.tax.foreignCorporateTax",
    countryId: "RU",
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
          rate: 75,
          label: "Prohibitive Assessment",
        },
      ],
    },
    title: "Foreign Concessions Levy Act",
    description: "What foreign enterprise pays for the rare privilege of operating on Union soil.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.tax.payrollTax",
    countryId: "RU",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "payrollTax",
      minRate: 0,
      maxRate: 20,
      step: 0.5,
      baselineRate: 5,
      waypoints: [
        {
          rate: 0,
          label: "No Contributions",
        },
        {
          rate: 2.5,
          label: "Minimal Contribution",
        },
        {
          rate: 5,
          label: "Standard Contribution",
        },
        {
          rate: 10,
          label: "Expanded Contribution",
        },
        {
          rate: 16,
          label: "Comprehensive Contribution",
        },
      ],
    },
    title: "Social Insurance Contributions Act",
    description:
      "Enterprise contributions funding sickness benefit and the trade-union welfare apparatus.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.tax.salesTax",
    countryId: "RU",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType: "salesTax",
      minRate: 0,
      maxRate: 45,
      step: 1,
      baselineRate: 31,
      waypoints: [
        {
          rate: 0,
          label: "No Turnover Levy",
        },
        {
          rate: 12,
          label: "Light Turnover Levy",
        },
        {
          rate: 22,
          label: "Reduced Turnover Levy",
        },
        {
          rate: 31,
          label: "Standard Turnover Levy",
        },
        {
          rate: 40,
          label: "Maximum Extraction",
        },
      ],
    },
    title: "Turnover Tax Act",
    description:
      "The invisible levy inside every retail price — the budget's backbone, paid at the counter by everyone.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.tax.tariffs",
    countryId: "RU",
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
          label: "Monopoly Pricing Only",
        },
        {
          rate: 6,
          label: "Revenue Duties",
        },
        {
          rate: 12,
          label: "Protective Duties",
        },
        {
          rate: 20,
          label: "High Wall",
        },
        {
          rate: 28,
          label: "Closed Border",
        },
      ],
    },
    title: "Customs and Trade Monopoly Duties Act",
    description:
      "Explicit border duties layered atop the foreign-trade monopoly's price equalization; zero keeps the ledger inside the monopoly.",
    category: "economy",
    allowedScope: "national",
  },
  {
    id: "ru.economy.workerSecurity.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.workerSecurity",
        weight: 1,
      },
    ],
    title: "Labor Code and Employment Guarantee Act",
    description: "The labor book, the guaranteed job, and the rules binding worker to workplace.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Labor Code",
        description:
          "No labor code binds the enterprise: hours, wages, and dismissal are whatever the director's ledger requires.",
      },
      {
        name: "Basic Labor Code",
        description:
          "A basic code fixes the working day and safety minimums, enforced where an inspector happens to visit.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Employment Protections",
        description:
          "Dismissal requires cause and the factory committee's signature; the trade union countersigns what management decides.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Guaranteed Employment",
        description:
          "Every citizen is guaranteed a workplace — and bound to it, for the labor book follows the worker everywhere.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Total Labor Charter",
        description:
          "The full charter: guaranteed employment, codified norms, paid rest, and a grievance path through the union apparatus for every workplace in the Union.",
        gdpCostFraction: 0.0032,
      },
    ],
    reformTitle: "Labor Code Liberalization Act",
  },
  {
    id: "ru.economy.mobility.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.mobility",
        weight: 1,
      },
    ],
    title: "Social Assistance and Resettlement Act",
    description: "Aid reaches the listed categories — invalids, heroes' families — and few others.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Assistance",
        description:
          "Hardship is a private misfortune; the citizen in need petitions relatives, not the state.",
      },
      {
        name: "Categorical Assistance",
        description:
          "Aid flows only to the listed categories — invalids, heroes' families, orphans of the war — and the lists are short.",
        incomeCostFraction: 0.0041,
      },
      {
        name: "Broad Assistance",
        description:
          "Means-tested relief and resettlement grants reach beyond the categories, paid through the district soviets.",
        incomeCostFraction: 0.0082,
      },
      {
        name: "Opportunity Programmes",
        description:
          "Retraining courses and organized placement move the displaced into the plan's new construction sites and factories.",
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
    id: "ru.economy.householdIncome.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.householdIncome",
        weight: 1,
      },
    ],
    title: "State Retail Price Subsidies Act",
    description: "The celebrated retail price cuts, announced with fanfare and paid by the budget.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Price Programme",
        description:
          "Retail prices float on scarcity; the queue and the black market set what the wage is worth.",
      },
      {
        name: "Staple Subsidies",
        description:
          "Bread, groats, and essentials are held at fixed prices in state stores, whatever the cost to the budget.",
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
          "Recurring announced price cuts — the celebrated spring reductions — lower the state price list category by category.",
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
    id: "ru.economy.stability.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.stability",
        weight: 1,
      },
    ],
    title: "State Plan Discipline Act",
    description: "The planning commission (*Gosplan*) and the discipline that makes targets law.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Plan Authority",
        description:
          "No planning authority: enterprises produce what they can and barter for what they cannot.",
      },
      {
        name: "Planning Commission",
        description:
          "The planning commission drafts control figures and monitors fulfillment, but its targets remain advice.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Binding Plan Targets",
        description:
          "Plan targets carry the force of law; failure to fulfill is answered before the ministry and the procurator.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Full Plan Command",
        description:
          "The plan commands every balance — steel, grain, labor — and the commission arbitrates all claims between ministries.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Total Economic Command",
        description:
          "Total command: every input, output, and price in the Union is set centrally, and the market exists only in memory.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "ru.economy.productivity.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.productivity",
        weight: 1,
      },
    ],
    title: "Industrial Investment Programme Act",
    description: "The blast furnaces, machine works, and combines the plan feeds first.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No State Investment",
        description:
          "The state directs no investment; industry makes do with what survived the war and its own retained kopecks.",
      },
      {
        name: "Reconstruction Priorities",
        description:
          "Capital flows to the priority reconstructions — the named blast furnaces and power works on the commission's short list.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Sectoral Investment",
        description:
          "Branch programmes fund whole sectors by turn: metallurgy this cycle, machine-building the next.",
        gdpCostFraction: 0.0171,
      },
      {
        name: "General Plan Investment",
        description:
          "Heavy industry takes first claim on every ruble of accumulation; consumer goods wait at the end of the queue.",
        gdpCostFraction: 0.0257,
      },
      {
        name: "Total Industrial Mobilization",
        description:
          "Maximal accumulation: the highest investment share the household sector can bear, poured into plants, combines, and new capacity.",
        gdpCostFraction: 0.0357,
      },
    ],
  },
  {
    id: "ru.economy.fiscal.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.fiscal",
        weight: 1,
      },
    ],
    title: "State Bank and Budget Discipline Act",
    description: "The State Bank's ruble control — every enterprise account watched.",
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
          "The State Bank operates credit and cash plans, watching enterprise accounts through the branch network.",
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
          "Ruble control in full: every transfer between enterprises passes the Bank's ledger, and irregularities travel upward fast.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Fiscal Command",
        description:
          "A total fiscal command: continuous audit of every account in the Union, from the ministry down to the village cooperative.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.economy.competition.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "economy.competition",
        weight: 1,
      },
    ],
    title: "Producer Cooperatives Act",
    description: "The artisan cooperatives (*artels*) — the little market the plan tolerates.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Cooperative Sector",
        description:
          "All production is ministerial; the last artisan cooperatives are absorbed or dissolved.",
      },
      {
        name: "Licensed Cooperatives",
        description:
          "Artisan cooperatives are tolerated under license — the shoemakers and tinsmiths the ministries cannot be bothered to run.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Cooperative Framework",
        description:
          "The cooperative sector receives legal standing, allocated supplies, and credit through the cooperative bank.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Expanded Cooperation",
        description:
          "Cooperation expands into services and light goods, filling the gaps the plan admits it leaves.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Open Cooperative Economy",
        description:
          "A broad non-ministerial sector: cooperatives compete openly for materials and custom wherever the plan does not claim priority.",
        gdpCostFraction: 0.0021,
      },
    ],
    reformTitle: "Cooperative Enterprise Expansion Act",
  },
  {
    id: "ru.education.universalSchooling.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.universalSchooling",
        weight: 1,
      },
    ],
    title: "Ten-Year School Act",
    description: "From the literacy campaigns to a ten-year school in every district.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Universal Schooling",
        description:
          "Schooling is left to district means and family choice; the literacy of the village is nobody's plan target.",
      },
      {
        name: "Four-Year Foundation",
        description:
          "Four years of primary school are compulsory and free for every child, taught in the languages of the Union.",
        incomeCostFraction: 0.0092,
      },
      {
        name: "Seven-Year Standard",
        description:
          "The seven-year school becomes the universal standard, extending incomplete secondary education to town and village alike.",
        incomeCostFraction: 0.0173,
      },
      {
        name: "Ten-Year Expansion",
        description:
          "The ten-year school spreads district by district, with completion targets written into each republic's plan.",
        incomeCostFraction: 0.0265,
      },
      {
        name: "Universal Complete Secondary",
        description:
          "Ten years for every child, everywhere — full secondary education as a universal obligation and a guaranteed place.",
        incomeCostFraction: 0.0367,
      },
    ],
  },
  {
    id: "ru.education.teacherCorps.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.teacherCorps",
        weight: 1,
      },
    ],
    title: "Teachers and School Construction Act",
    description: "Pedagogical institutes and the schoolhouses rising with the plan.",
    category: "education",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "Districts staff their schools as best they can; the teacher shortage is answered with larger classes.",
      },
      {
        name: "Teacher Institutes",
        description:
          "Pedagogical institutes receive funded places and stipends to train the corps the schools are missing.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Teachers and Buildings",
        description:
          "Training is paired with a school construction programme — new buildings rising alongside the new graduates.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Corps Expansion",
        description:
          "The corps expands with salary uplifts, housing priority, and paid postings to the rural schools nobody volunteered for.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Elite Teaching Service",
        description:
          "An elite teaching service: institute expansion, model salaries, and prestige postings that make the classroom a career of standing.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "ru.education.adultSkills.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.adultSkills",
        weight: 1,
      },
    ],
    title: "Labor Reserves and Factory Schools Act",
    description: "The factory schools that turn village youth into machinists.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Training System",
        description:
          "Trades are learned at the bench from whoever will teach them; the enterprise trains only what it cannot poach.",
      },
      {
        name: "Apprentice Schools",
        description:
          "Factory apprentice schools attach training workshops to the major plants, feeding each enterprise its own recruits.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Trade Schools Network",
        description:
          "A trade school network organizes vocational training by branch, with unified programmes and certified trades.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Labor Reserves System",
        description:
          "The Labor Reserves system directs village youth into training and assigns graduates to the plan's priority sites.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Universal Retraining",
        description:
          "Universal retraining: any worker may be schooled into a new trade at state expense, and the system reaches every district.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "ru.education.attainment.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.attainment",
        weight: 1,
      },
    ],
    title: "Attainment and Advancement Act",
    description: "Whether the children of herders and miners finish what they start.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programmes",
        description:
          "Nobody measures who finishes school; the drop-out returns to the herd or the mine and the register closes.",
      },
      {
        name: "Completion Tracking",
        description:
          "Attainment is recorded and gaps are flagged — the first honest count of who completes what, and where.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Advancement Support",
        description:
          "Stipends, evening schools, and correspondence courses catch the pupils whom work or distance pulled out early.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Attainment Drive",
        description:
          "A funded completion drive: republics carry attainment targets, and the inspectorate follows the lagging districts.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Universal Attainment",
        description:
          "Universal attainment: every pupil is carried through the full ladder, with the state underwriting whatever support that takes.",
        gdpCostFraction: 0.0071,
      },
    ],
  },
  {
    id: "ru.education.research.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.research",
        weight: 1,
      },
    ],
    title: "Academy of Sciences Act",
    description:
      "The Academy's institutes — where the state keeps its finest minds, and watches them.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No State Science",
        description:
          "The state funds no science; the institutes empty as their people drift to wherever pays.",
      },
      {
        name: "Academy Restored",
        description:
          "The Academy's core institutes are restored and funded, with the classical disciplines back on state rations.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Institute Network",
        description:
          "Branch institutes multiply across the republics — an academy campus for every major field and region.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Science at Full Priority",
        description:
          "Science moves to full priority: academies, prize funds, and the closed research cities with their special stores.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Scientific Supremacy Drive",
        description:
          "A supremacy drive: maximal funding across every discipline, aimed squarely at overtaking the capitalist laboratories.",
        gdpCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "ru.education.standards.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "education.standards",
        weight: 1,
      },
    ],
    title: "Unified Curriculum and Examinations Act",
    description: "One curriculum from Minsk to Magadan, and the medal examinations atop it.",
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
          "One curriculum and one examination system bind every school from the capital to the smallest district.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Full Standardization",
        description:
          "Inspectors enforce the unified syllabus lesson by lesson, and deviation is a matter for the district committee.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Uniformity",
        description:
          "Total uniformity: centrally set lessons, timetables, and texts, identical in every classroom of the Union.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.education.choice.primary",
    countryId: "RU",
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
          "Families choose among state schools, with places allocated by preference rather than address.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Full School Choice",
        description:
          "Full choice: funded alternatives to the district school, with the ruble following the pupil who leaves.",
        gdpCostFraction: 0.0021,
      },
    ],
  },
  {
    id: "ru.health.universalCare.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.universalCare",
        weight: 1,
      },
    ],
    title: "State Health Service Act",
    description:
      "Free at the point of care: the district doctor, the polyclinic, the works clinic.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No State Service",
        description:
          "Care is bought, bartered, or begged; the feldsher takes what the family can pay.",
      },
      {
        name: "District Clinics",
        description:
          "District polyclinics provide basic consultation and dispensary care free at the point of use.",
        incomeCostFraction: 0.0071,
      },
      {
        name: "Service Network",
        description:
          "The polyclinic network is joined to hospitals, referrals, and district physicians into a single state service.",
        incomeCostFraction: 0.0133,
      },
      {
        name: "Universal State Service",
        description:
          "The universal service: free care for every citizen, with workplace medicine embedded in the major enterprises.",
        incomeCostFraction: 0.0204,
      },
      {
        name: "Comprehensive Service",
        description:
          "A comprehensive service: full-spectrum guaranteed care from the village feldsher post to the republican specialist institute.",
        incomeCostFraction: 0.0286,
      },
    ],
  },
  {
    id: "ru.health.socialInsurance.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.socialInsurance",
        weight: 1,
      },
    ],
    title: "State Pensions and Insurance Act",
    description:
      "A pension for the factory veteran; the collective farmer grows old on the farm's mercy.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No State Pensions",
        description:
          "Old age is provided for by children, savings, or not at all; the state pays no pension.",
      },
      {
        name: "Categorical Pensions",
        description:
          "Pensions reach industrial workers, war invalids, and honored categories; the collective farm village is excluded.",
        incomeCostFraction: 0.0163,
      },
      {
        name: "Broadened Pensions",
        description:
          "Coverage widens and rates rise, though the pension book still favors the city over the village.",
        incomeCostFraction: 0.0286,
      },
      {
        name: "Universal System",
        description:
          "The system becomes universal: pensions reach the countryside, and the kolkhoznik is written into the rolls at last.",
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
    id: "ru.health.prevention.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.prevention",
        weight: 1,
      },
    ],
    title: "Sanitary-Epidemiological Service Act",
    description: "The sanitary service that vaccinates, inspects, and quarantines by decree.",
    category: "health",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Service",
        description:
          "Epidemics burn through unopposed; quarantine is whatever the village elder improvises.",
      },
      {
        name: "Epidemic Stations",
        description:
          "Epidemic stations stand ready at the rail junctions and ports, tracing outbreaks before they travel.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Sanitary Inspectorate",
        description:
          "The sanitary inspectorate adds routine inspection and mass vaccination to the outbreak posts.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Full Sanitary Service",
        description:
          "The full sanitary service: universal vaccination campaigns, water and food controls, and quarantine powers used without hesitation.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Total Prevention State",
        description:
          "A total prevention state: the sanitary service reaches every settlement, and its decrees outrank the factory director's plan.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "ru.health.outcomes.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.outcomes",
        weight: 1,
      },
    ],
    title: "Medical Outcomes and Specialists Act",
    description: "The institutes where the Union's medicine meets the world standard — or tries.",
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
          "Specialist referral institutes in the republican capitals take the cases the districts cannot hold.",
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
          "Flagship institutes per branch of medicine, staffed and equipped to the best standard the Union can build.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "World-Standard Medicine",
        description:
          "World-standard medicine: maximal clinical investment, aimed at outcomes no delegation abroad need apologize for.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "ru.health.responsibility.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.responsibility",
        weight: 1,
      },
    ],
    title: "Personal Health Responsibility Act",
    description: "Ready for Labor and Defense: the badge, the norms, the morning exercises.",
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
          "Hygiene propaganda in posters, wall newspapers, and workplace lectures — persuasion at kopeck cost.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Fitness Norms",
        description:
          "Physical-culture norms and badges set fitness standards for youth and worker alike.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Temperance Campaigns",
        description:
          "Temperance campaigns target the bottle and the absenteeism it breeds, with the comrades' court in reserve.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Total Health Discipline",
        description:
          "Total health discipline: fitness norms, sobriety drives, and behavioral campaigns pressed through every collective in the Union.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.health.providerChoice.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "health.providerChoice",
        weight: 1,
      },
    ],
    title: "Physician Practice Act",
    description: "The district assigns your doctor; the idea of choosing one is foreign.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "State Practice Only",
        description:
          "Every physician is a state employee at a state post; the assigned district doctor is the only doctor.",
      },
      {
        name: "Paid Polyclinics",
        description:
          "Fee-paying state polyclinics open beside the free network, for those who will pay to skip the queue.",
        gdpCostFraction: 0.0003,
      },
      {
        name: "Cooperative Practice",
        description:
          "Physician cooperatives are licensed to practice, the first legal medicine outside the ministry.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Mixed Practice",
        description:
          "Private practice is permitted alongside state service, and the patient may take a fee-paying chair.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Open Medical Market",
        description:
          "An open medical market: free choice of provider, with state and private practice competing for the patient.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.health.systemEfficiency.primary",
    countryId: "RU",
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
          "Optimal service design: continuous administrative review of every clinic, with resources moved wherever the ledger says they serve best.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "ru.infrastructure.publicHousing.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.publicHousing",
        weight: 1,
      },
    ],
    title: "State Housing Construction Act",
    description: "The communal apartment and the factory barracks — a room, rarely a home.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Housing Programme",
        description:
          "The state builds nothing; families crowd into what stands, a corner and a curtain per household.",
      },
      {
        name: "Enterprise Barracks",
        description:
          "Enterprises house their own workers in barracks and dormitories beside the plant gates.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Departmental Construction",
        description:
          "Ministries build departmental housing for their own staff — apartments as an instrument of retention.",
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
          "The universal guarantee: a separate flat for every family, delivered by the largest construction programme the plan has ever carried.",
        gdpCostFraction: 0.0214,
      },
    ],
    budgetKeyOverride: "other",
    reformTitle: "Mass Housing Programme Act",
  },
  {
    id: "ru.infrastructure.transit.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.transit",
        weight: 1,
      },
    ],
    title: "Railways and Metro Act",
    description: "The railways carry the plan; the metro carries the message.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme funds the network; the railways decay to the pace the timetable can survive.",
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
          "War damage is repaired and stock renewed, and the trunk lines return to prewar throughput.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Expansion and Electrification",
        description:
          "Expansion and electrification: new lines eastward, and metro palaces descending under the great cities.",
        gdpCostFraction: 0.0143,
      },
      {
        name: "Total Network Buildout",
        description:
          "Total buildout: maximal investment in rail, metro, and rolling stock, until the network runs ahead of the plan that fills it.",
        gdpCostFraction: 0.0207,
      },
    ],
  },
  {
    id: "ru.infrastructure.utilities.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.utilities",
        weight: 1,
      },
    ],
    title: "Electrification Act",
    description: "Communism, as the founders quipped, is power plus the grid to carry it.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description:
          "The village burns kerosene and hauls water; the grid ends at the city limits.",
      },
      {
        name: "Urban Networks",
        description: "Cities are powered and piped, with urban networks brought to standard.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Regional Grids",
        description:
          "Regional grids join the oblast networks, and the blackouts retreat to the countryside.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Union Electrification",
        description:
          "Union electrification carries power to the districts and water mains to the towns.",
        gdpCostFraction: 0.0071,
      },
      {
        name: "Total Connection",
        description:
          "Total connection: every settlement on the grid, every town piped — the bulb in the last hut on the last road.",
        gdpCostFraction: 0.0107,
      },
    ],
  },
  {
    id: "ru.infrastructure.condition.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.condition",
        weight: 1,
      },
    ],
    title: "Public Works and Reconstruction Act",
    description: "Rebuilding what the war leveled, city by city, bridge by bridge.",
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
          "A scheduled programme rebuilds city by city, with maintenance written into each year's estimates.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Full Renewal",
        description:
          "Full renewal: systematic modernization of everything the war touched and much it did not.",
        gdpCostFraction: 0.0071,
      },
      {
        name: "Model Condition Standard",
        description:
          "A model condition standard, guaranteed Union-wide: inspection, repair, and replacement on a fixed cycle.",
        gdpCostFraction: 0.0107,
      },
    ],
  },
  {
    id: "ru.infrastructure.highways.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.highways",
        weight: 1,
      },
    ],
    title: "Roads Programme Act",
    description: "The rasputitsa — the roadless season — still commands the countryside.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Roads Programme",
        description:
          "No roads programme exists; the rasputitsa closes the countryside twice a year, as it always has.",
      },
      {
        name: "Trunk Roads",
        description:
          "The trunk routes between key cities are surfaced and kept passable through the seasons.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Roads Programme",
        description:
          "Oblast networks are improved: gravel to the district centers, asphalt where the traffic justifies it.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Paved Union Drive",
        description:
          "An all-weather paved drive connects the major centers, and the truck replaces the cart on state routes.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Total Road Grid",
        description:
          "A total road grid: comprehensive modern highways down to the district level, mud season notwithstanding.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "ru.infrastructure.ownership.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.ownership",
        weight: 1,
      },
    ],
    title: "Personal Property and Dacha Act",
    description: "One does not own a flat; one is assigned it, and is grateful.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "No Ownership Programme",
        description:
          "Housing belongs to the state and is assigned by it; personal ownership of a dwelling is not contemplated.",
      },
      {
        name: "Garden Plots",
        description:
          "Garden plots and modest dachas are permitted — a private hectare of cabbage beside the collective fields.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Cooperative Housing",
        description:
          "Housing cooperatives are financed, letting groups of citizens build and hold apartments jointly.",
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
    id: "ru.infrastructure.development.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "infrastructure.development",
        weight: 1,
      },
    ],
    title: "General Plans and Urban Design Act",
    description: "The general plan: boulevards on paper, approved in the capital.",
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
          "Professional planning institutes staff the work, and the general plan becomes a discipline rather than a drawing.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Union Planning Standard",
        description:
          "Every city of standing comes under a general plan, and construction outside it requires a signature few obtain.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Total Design Authority",
        description:
          "Total design authority: comprehensive spatial command over every city and settlement, from the metro line to the last courtyard.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "ru.order.dueProcess.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.dueProcess",
        weight: 1,
      },
    ],
    title: "Procuracy Supervision Act",
    description: "The procurator supervises legality — and answers to the same masters.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Supervision",
        description:
          "Detention is unreviewed; a citizen held by the organs is a citizen filed away.",
      },
      {
        name: "Procuracy Review",
        description:
          "The procuracy formally supervises legality, reviewing arrests and terms on paper.",
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
    id: "ru.order.legalAid.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.legalAid",
        weight: 1,
      },
    ],
    title: "Advocates Collegia Act",
    description: "The advocate speaks for the accused, within the limits everyone understands.",
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
          "Counsel is guaranteed at trial, assigned from the collegium at state expense where the accused cannot pay.",
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
    id: "ru.order.communityTrust.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.communityTrust",
        weight: 1,
      },
    ],
    title: "Militia Conduct and Public Standing Act",
    description: "The militiaman's conduct book, and what a complaint against him is worth.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Standards",
        description:
          "The militiaman's conduct is examined by no one below his commander, and rarely by him.",
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
    id: "ru.order.safety.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.safety",
        weight: 1,
      },
    ],
    title: "Public Order Campaigns Act",
    description: "Campaigns against hooliganism, and the volunteer brigades that wage them.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "Street disorder goes unanswered; the drunk and the hooligan own the courtyard after dark.",
      },
      {
        name: "Patrols and Posts",
        description: "Patrols and posts put the militia on the street where the trouble is.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Order Campaigns",
        description:
          "Order campaigns target hooliganism directly, with youth brigades marching beside the militia.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Comprehensive Prevention",
        description:
          "Comprehensive prevention: volunteer patrols, street lighting, and the druzhinnik's red armband on every evening street.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Total Public Order",
        description:
          "Total public order: maximal prevention apparatus, until the courtyard belongs to the house committee again.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "ru.order.courts.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.courts",
        weight: 1,
      },
    ],
    title: "People's Courts Act",
    description: "The people's judge, the two lay assessors, and the docket before them.",
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
          "The people's courts are staffed: a judge and two lay assessors in every district.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Functioning Judiciary",
        description:
          "The judiciary functions: courts, assessors, and cassation review moving cases at a civilized pace.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Professional Judiciary",
        description:
          "Professional judges with legal training take the bench, and the docket keeps to its calendar.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Model Court System",
        description:
          "A model court system: justice without queues, from the village session to the republican supreme court.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "ru.order.policeStrength.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.policeStrength",
        weight: 1,
      },
    ],
    title: "Militia and Internal Troops Act",
    description: "The militia on the corner and the internal troops in the garrison behind him.",
    category: "order",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "Skeleton Forces",
        description:
          "Order is thinly held by skeleton forces; whole districts see a militiaman monthly.",
      },
      {
        name: "Militia Establishment",
        description: "City and district militia establishments are funded and posted.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Full Militia Network",
        description:
          "The network reaches full establishment strength, with posts in every settlement of size.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Militia and Internal Troops",
        description:
          "Internal troops garrison the sensitive points, a gendarmerie standing behind the street militia.",
        gdpCostFraction: 0.0086,
      },
      {
        name: "Saturation Enforcement",
        description:
          "Saturation enforcement: maximal manpower on the street and in the garrison, and no district beyond the reach of a patrol.",
        gdpCostFraction: 0.0129,
      },
    ],
  },
  {
    id: "ru.order.deterrence.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "order.deterrence",
        weight: 1,
      },
    ],
    title: "Corrective Labor System Act",
    description:
      "The camp system — an archipelago of labor and punishment the state prefers not to discuss.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Penal Policy",
        description:
          "No penal policy exists beyond the sentence itself; the courts decide, the state merely locks the door.",
      },
      {
        name: "Prison System",
        description:
          "A conventional custodial system holds prisoners in prisons, and nothing more ambitious.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Labor Colonies",
        description:
          "Labor colonies put sentences to work — penal labor as correction and as output.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Camp Complex",
        description:
          "The camp complex in full: a vast corrective-labor apparatus with its own ministries of timber and ore.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Total Penal Economy",
        description:
          "The camps as an industry: a total penal economy whose output figures appear in the plan beside the free economy's.",
        gdpCostFraction: 0.0086,
      },
    ],
    reformTitle: "Corrective System Reform Act",
  },
  {
    id: "ru.environment.conservation.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.conservation",
        weight: 1,
      },
    ],
    title: "Nature Reserves Act",
    description: "The scientific reserves (*zapovedniki*), lately thinned by decree.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Reserves",
        description:
          "Nature serves the plan without reservation; the last protected hectares are opened to the axe.",
      },
      {
        name: "Remnant Reserves",
        description:
          "A reduced reserve network survives — the remnant zapovedniki the decrees spared.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Reserve Restoration",
        description:
          "The reserves are rebuilt and staffed, with the scientific stations back at their posts.",
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
          "Total stewardship: a sweeping conservation order across the Union, and the plan must route around it.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "ru.environment.stewardship.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.stewardship",
        weight: 1,
      },
    ],
    title: "Afforestation and Land Improvement Act",
    description: "The great plan to remake the steppe with trees, ponds, and decree.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description: "The steppe blows away untended; the dust storms answer to no ministry.",
      },
      {
        name: "Shelterbelt Plantings",
        description:
          "Shelterbelt plantings raise windbreaks across the plains, hedging the grain against the wind.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Transformation Programme",
        description:
          "The transformation programme in full: belts, farm ponds, and grass rotations remaking the dry lands.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Land Improvement Drive",
        description:
          "Irrigation canals and soil works at scale — land improvement as a headline construction front.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Total Land Command",
        description:
          "Total land command: the maximal remaking of nature, with rivers, soils, and forests all assigned their tasks.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "ru.environment.urbanAir.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.urbanAir",
        weight: 1,
      },
    ],
    title: "Urban Smoke and Sanitation Act",
    description: "The plan measures output in tons; the smoke is nobody's line item.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 0,
    levels: [
      {
        name: "No Controls",
        description:
          "The combine smokes as it must; no line item in the plan measures what the city breathes.",
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
          "A healthy-cities charter: comprehensive urban environmental standards, enforced against even the favored ministries.",
        gdpCostFraction: 0.0024,
      },
    ],
  },
  {
    id: "ru.environment.energySecurity.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.energySecurity",
        weight: 1,
      },
    ],
    title: "Power Stations Programme Act",
    description: "The great construction projects: dams to bend rivers, stations to feed the plan.",
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
        description: "New thermal and hydro stations rise on the commission's schedule.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Great Constructions",
        description:
          "The great constructions: giant dams and cascades of stations bending whole rivers to the grid.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Energy Supremacy Drive",
        description:
          "An energy supremacy drive: maximal generation buildout, with power to spare for any plan the center can write.",
        gdpCostFraction: 0.0086,
      },
    ],
  },
  {
    id: "ru.environment.resourceDev.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.resourceDev",
        weight: 1,
      },
    ],
    title: "Coal and Ore Extraction Act",
    description: "The coal basins and ore fields feeding the furnaces of the plan.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Programme",
        description: "The basins idle; coal and ore come up no faster than worn machinery allows.",
      },
      {
        name: "Basin Restoration",
        description: "War-damaged mines are restored and the flooded shafts pumped clear.",
        gdpCostFraction: 0.0014,
        gdpRevenueFraction: 0.0014,
      },
      {
        name: "Extraction Programme",
        description: "Mechanization and new shafts lift extraction across the established basins.",
        gdpCostFraction: 0.0029,
        gdpRevenueFraction: 0.0029,
      },
      {
        name: "Production Drive",
        description:
          "A production drive puts output targets at full priority, with premiums for every ton above plan.",
        gdpCostFraction: 0.0043,
        gdpRevenueFraction: 0.0043,
      },
      {
        name: "Maximum Extraction",
        description:
          "Maximum extraction: all-out development of every basin, the geology worked as hard as the miners.",
        gdpCostFraction: 0.0064,
        gdpRevenueFraction: 0.0057,
      },
    ],
  },
  {
    id: "ru.environment.affordability.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.affordability",
        weight: 1,
      },
    ],
    title: "Household Fuel Allocation Act",
    description: "Winter is a state matter: the coal ration and the wood allocation.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Allocation",
        description:
          "Households are left to secure their own coal and wood; winter is a private negotiation with the forest.",
      },
      {
        name: "Town Allocations",
        description:
          "Towns receive rationed allocations of coal and firewood through the local soviets.",
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
          "Supply is guaranteed at fixed prices, and the fuel shed is filled before the first frost.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Universal Fuel Guarantee",
        description:
          "A universal fuel guarantee: a comprehensive energy floor beneath every household in the Union.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
  {
    id: "ru.environment.extraction.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "environment.extraction",
        weight: 1,
      },
    ],
    title: "Geological Survey and Licensing Act",
    description: "The survey expeditions mapping what the ground owes the state.",
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
        description:
          "Geological expeditions map the provinces, and the reserve registers begin to fill.",
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
          "Priority development opens new provinces at speed, the drillers following a season behind the geologists.",
        gdpCostFraction: 0.0011,
        gdpRevenueFraction: 0.0021,
      },
      {
        name: "Maximum Access",
        description:
          "Maximum access: every province worked, every certified deposit assigned to a ministry and a plan line.",
        gdpCostFraction: 0.0016,
        gdpRevenueFraction: 0.0029,
      },
    ],
  },
  {
    id: "ru.society.integration.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.integration",
        weight: 1,
      },
    ],
    title: "Nationalities Policy Act",
    description:
      "Equality of peoples, proclaimed in the constitution — administered by the center.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Nationalities Policy",
        description:
          "The peoples of the Union hold no recognized standing in law; nationality is a census entry and nothing more.",
      },
      {
        name: "Formal Equality",
        description:
          "Constitutional equality is declared for every nationality, in text if not yet in practice.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Friendship of Peoples",
        description:
          "The friendship of peoples: national forms — theaters, costumes, alphabets — curated, funded, and policed.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Substantive Equality",
        description:
          "Substantive equality: national languages taught, national cadres promoted, and the republics staffed from their own.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Full Equality Charter",
        description:
          "A full equality charter: comprehensive enforcement of national rights, with remedies a citizen can actually claim.",
        gdpCostFraction: 0.0032,
      },
    ],
  },
  {
    id: "ru.society.womensOpportunity.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.womensOpportunity",
        weight: 1,
      },
    ],
    title: "Women Workers and Creches Act",
    description: "The tractor driver and the professor are women; so is everyone at the creche.",
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
          "Enterprise creches take the children at the factory gate for the length of the shift.",
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
          "A full support network makes childcare universally accessible, from factory creche to district kindergarten.",
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
    id: "ru.society.socialMobility.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.socialMobility",
        weight: 1,
      },
    ],
    title: "Workers' Advancement Act",
    description: "From the bench to the institute — the ladder the state built and guards.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description: "Origins decide destinies; the herder's son herds, whatever his marks.",
      },
      {
        name: "Preparatory Courses",
        description:
          "Preparatory courses ready workers and peasants for the institute examinations.",
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
          "The cadre elevator: systematic promotion from below, with the personnel departments ordered to find talent in the shops.",
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
    id: "ru.society.demography.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.demography",
        weight: 1,
      },
    ],
    title: "Family and Population Act",
    description: "Mother-heroine medals on one hand; the tax on the childless in the other.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Population Policy",
        description: "The registers merely count; births and deaths are recorded, not managed.",
      },
      {
        name: "Motherhood Awards",
        description: "Motherhood medals and small grants honor the large family.",
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
          "The pro-natal programme in full: awards, allowances, and the levy on the childless, all pulling the same direction.",
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
    id: "ru.society.civicLife.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.civicLife",
        weight: 1,
      },
    ],
    title: "Trade Unions and Voluntary Societies Act",
    description: "Every citizen belongs somewhere — the union, the league, the society of friends.",
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
          "Sanctioned societies are chartered — the hunters, the philatelists, the friends of the fleet.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Mass Organizations",
        description:
          "The mass organizations stand up in force: unions, youth leagues, and sport societies with dues and premises.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Civic Infrastructure",
        description:
          "Civic infrastructure at scale: palaces of culture in the cities, huts of reading in the villages.",
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
    id: "ru.society.familyStability.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.familyStability",
        weight: 1,
      },
    ],
    title: "State Family Aid Act",
    description: "The state grant arrives with the fourth child; the queue teaches patience.",
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
          "Grants begin at the fourth child, honoring the large family the posters celebrate.",
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
    id: "ru.society.tradition.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "society.tradition",
        weight: 1,
      },
    ],
    title: "State Ceremonies and Heritage Act",
    description: "The parade, the pantheon, and the carefully edited past.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programmes",
        description:
          "The past goes unattended; anniversaries pass unmarked and the monuments weather.",
      },
      {
        name: "State Observances",
        description:
          "State observances fill the calendar: parades, anniversaries, and the appropriate salutes.",
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
          "A heritage programme restores the palaces and estates and puts folk ensembles on tour.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Total Memory Apparatus",
        description:
          "The total memory apparatus: maximal commemorative investment, with the past edited, gilded, and on permanent display.",
        gdpCostFraction: 0.0026,
      },
    ],
  },
  {
    id: "ru.governance.participation.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.participation",
        weight: 1,
      },
    ],
    title: "Soviets Elections Act",
    description: "Turnout approaches totality; the ballot lists one name.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Elections",
        description:
          "Deputies are appointed outright; the soviet assembles to applaud what was decided elsewhere.",
      },
      {
        name: "Single-List Elections",
        description:
          "Universal suffrage with a single list: the citizen votes, the name is already chosen.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Organized Participation",
        description:
          "Participation is organized to totality — agitators at every door, and turnout that rounds to everyone.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Contested Soviets",
        description:
          "Multiple candidacies are permitted in the soviets, and a deputy may actually lose.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Full Participation Charter",
        description:
          "A full participation charter: open nomination and genuine contest, the soviet answerable to those who fill it.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.governance.openness.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.openness",
        weight: 1,
      },
    ],
    title: "State Information and Publications Act",
    description: "Nothing is printed that the censorship office (*Glavlit*) has not passed.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 0,
    levels: [
      {
        name: "Censorship Regime",
        description:
          "The censor reads everything before the citizen reads anything; the unpassed page does not exist.",
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
          "Radical transparency: a comprehensive openness regime, with the archives unlocked and the censor's office dark.",
        gdpCostFraction: 0.0013,
      },
    ],
    reformTitle: "Openness and Publicity Act",
  },
  {
    id: "ru.governance.localAutonomy.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.localAutonomy",
        weight: 1,
      },
    ],
    title: "Local Soviets Finance Act",
    description: "The local soviet's budget: real money, spent as the center instructs.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Local Budgets",
        description:
          "Everything is financed from the center; the local soviet holds a rubber stamp and an empty cashbox.",
      },
      {
        name: "Delegated Estimates",
        description:
          "Local soviets execute delegated estimates — spending orders written in the capital.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Local Budget System",
        description:
          "Oblast and district budgets take legal form, with revenues of their own to mismanage or husband.",
        gdpCostFraction: 0.0057,
      },
      {
        name: "Republican Autonomy",
        description:
          "Republican autonomy in finance: the republics manage real shares of revenue and set local priorities.",
        gdpCostFraction: 0.0093,
      },
      {
        name: "Devolved Federation",
        description:
          "A devolved federation: general revenue sharing, with the center keeping accounts rather than keeping everything.",
        gdpCostFraction: 0.0136,
      },
    ],
  },
  {
    id: "ru.governance.integrity.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.integrity",
        weight: 1,
      },
    ],
    title: "State Control Ministry Act",
    description: "The control ministry inspects everyone — and reports to the very top.",
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
          "State control conducts inspections with sanctions attached — the signature that ends careers.",
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
    id: "ru.governance.administration.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.administration",
        weight: 1,
      },
    ],
    title: "Ministries and State Apparatus Act",
    description: "The branch ministries and their armies of clerks, running everything.",
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
          "A rationalized apparatus: modern management methods throughout, the clerks counted and the counting clerked.",
        gdpCostFraction: 0.0121,
      },
    ],
  },
  {
    id: "ru.governance.decisiveness.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.decisiveness",
        weight: 1,
      },
    ],
    title: "Council of Ministers Act",
    description: "Decisions come from one room, and they do not linger there.",
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
          "The decisive executive: maximal central coherence, with no question orphaned and no decree contradicting another.",
        gdpCostFraction: 0.0011,
      },
    ],
  },
  {
    id: "ru.governance.centralAuthority.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "governance.centralAuthority",
        weight: 1,
      },
    ],
    title: "Union Supremacy Act",
    description: "Moscow decides; the republics concur, promptly and unanimously.",
    category: "governance",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Weak Center",
        description:
          "The center's writ weakens with distance; the republics drift on their own headings.",
      },
      {
        name: "Union Enforcement",
        description:
          "Union enforcement puts inspectors and plenipotentiaries behind every central decision.",
        gdpCostFraction: 0.00043,
      },
      {
        name: "Assured Supremacy",
        description:
          "Union law prevails reliably over republican deviation, and everyone has stopped testing it.",
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
          "The total vertical: maximal central authority, one signal from the capital reaching the last village soviet unaltered.",
        gdpCostFraction: 0.0016,
      },
    ],
  },
  {
    id: "ru.defense.diplomacy.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.diplomacy",
        weight: 1,
      },
    ],
    title: "Foreign Ministry and Missions Act",
    description: "The ministry that speaks for the Union — carefully, and with instructions.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "Skeleton Service",
        description:
          "The missions are shuttered and the service skeletal; the Union speaks abroad rarely, and through intermediaries.",
      },
      {
        name: "Professional Service",
        description: "A professional service staffs the embassies and carries the treaty work.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Global Diplomacy",
        description:
          "Global diplomacy: worldwide presence, and the chairmanship of the fraternal bloc's councils.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Diplomatic Offensive",
        description:
          "The diplomatic offensive: summits, peace campaigns, and initiatives launched faster than the adversary can answer.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Great-Power Diplomacy",
        description:
          "Great-power diplomacy at maximal reach — no conference convenes without the Union's chair filled.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "ru.defense.institutions.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.institutions",
        weight: 1,
      },
    ],
    title: "Fraternal Relations and Economic Council Act",
    description: "The councils and treaties binding the fraternal states to the center.",
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
          "Bilateral friendship treaties bind the fraternal states one signature at a time.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Bloc Institutions",
        description:
          "Bloc institutions rise: the economic council, coordinated plans, and standing committees.",
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
          "The order's underwriter: the Union finances the bloc outright, and the institutions answer to its chair.",
        gdpCostFraction: 0.0043,
      },
    ],
  },
  {
    id: "ru.defense.softPower.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.softPower",
        weight: 1,
      },
    ],
    title: "International Voice Act",
    description: "The world service, the peace congresses, and the touring ensembles.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Voice Abroad",
        description: "Silence on the airwaves: the Union's case abroad goes unmade.",
      },
      {
        name: "External Broadcasting",
        description: "External broadcasting carries the world service in many tongues.",
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
          "The cultural offensive: festivals, touring ensembles, and delegations — the ballet as foreign policy.",
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
    id: "ru.defense.security.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.security",
        weight: 1,
      },
    ],
    title: "State Security Organs Act",
    description: "The organs. One does not discuss the organs.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Apparatus",
        description: "No apparatus opposes the foreign services; espionage proceeds as if invited.",
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
    reformTitle: "State Security Committee Act",
  },
  {
    id: "ru.defense.defenseIndustry.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.defenseIndustry",
        weight: 1,
      },
    ],
    title: "Defense Industry Ministries Act",
    description: "The numbered plants and design bureaus arming the largest army on earth.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No War Industry",
        description: "No war industry exists; arms are bought abroad or improvised at the bench.",
      },
      {
        name: "Arsenal Base",
        description: "An arsenal base sustains the core armament works.",
        gdpCostFraction: 0.005,
      },
      {
        name: "War Industry System",
        description:
          "The war industry system: branch ministries for aviation, armament, and shipbuilding, each with numbered plants.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Full Military Industry",
        description:
          "Full military industry: design bureaus racing, jets and armor in series production.",
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
    id: "ru.defense.armedForces.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.armedForces",
        weight: 1,
      },
    ],
    title: "Soviet Army and Navy Act",
    description: "Millions of conscripts from Kaliningrad to Kamchatka — the army the war built.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "Skeleton Forces",
        description: "A token establishment: skeleton divisions and mothballed fleets.",
      },
      {
        name: "Regular Forces",
        description: "A professional core only — regular forces without the conscript mass.",
        gdpCostFraction: 0.0179,
      },
      {
        name: "Strong Standing Forces",
        description: "A substantial conscript army holds the frontiers and the garrisons.",
        gdpCostFraction: 0.0286,
      },
      {
        name: "Mass Conscript Army",
        description:
          "The mass army: millions under arms, with garrisons standing in the fraternal republics.",
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
    id: "ru.defense.projection.primary",
    countryId: "RU",
    kind: "primary",
    targets: [
      {
        metricId: "defense.projection",
        weight: 1,
      },
    ],
    title: "Strategic Weapons Programme Act",
    description: "The device, the bombers, and the rockets on their drawing boards.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Strategic Forces",
        description: "No strategic forces exist; the Union deters nothing and reaches nowhere.",
      },
      {
        name: "Strategic Foundations",
        description: "The foundations: first devices tested, long-range aviation on the fields.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Deterrent Programme",
        description: "The deterrent programme drives the weapons complex at full speed.",
        gdpCostFraction: 0.0064,
      },
      {
        name: "Full Deterrent",
        description: "A full deterrent: a credible strategic arm the adversary must plan around.",
        gdpCostFraction: 0.01,
      },
      {
        name: "Great-Power Arsenal",
        description:
          "The great-power arsenal: maximal strategic force across every delivery arm the bureaus can build.",
        gdpCostFraction: 0.0143,
      },
    ],
  },
  {
    id: "ru.sec.canalsFreight",
    countryId: "RU",
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
    title: "Canals and Freight Corridors Act",
    description: "The great canals and freight corridors, dug at whatever cost the plan allows.",
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
          "Canals and corridors together: new waterways cut and the freight arteries modernized.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Great Waterways Drive",
        description:
          "The great waterways drive: rivers joined sea to sea, at whatever the excavators cost.",
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
    id: "ru.sec.demobilizationResettlement",
    countryId: "RU",
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
    title: "Demobilization Resettlement Act",
    description: "What the returning soldier is owed: a trade, a bunk, and a place in the plan.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Resettlement Scheme",
        description:
          "No resettlement scheme exists; the discharged soldier walks home to whatever remains of it.",
      },
      {
        name: "Release Grants",
        description: "Release grants pay the veteran a demobilization sum and a rail warrant.",
        incomeCostFraction: 0.0015,
      },
      {
        name: "Training and Placement",
        description:
          "Training and placement channel the demobilized into trades and enterprise rosters.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Full Resettlement Programme",
        description:
          "The full programme: housing priority, credits, and reserved places for every returning soldier.",
        incomeCostFraction: 0.0051,
      },
      {
        name: "Generations Programme",
        description:
          "A generations programme: the veteran and his family carried from discharge to trade, flat, and pension.",
        incomeCostFraction: 0.0077,
      },
    ],
  },
  {
    id: "ru.sec.insuranceExtension",
    countryId: "RU",
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
    description: "New categories added to the pension rolls, decree by decree.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Extension",
        description:
          "No extension is made; the pension rolls stay frozen at the established categories.",
      },
      {
        name: "Category Extensions",
        description:
          "New categories are added decree by decree — the miners this cycle, the teachers the next.",
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
          "Broad extension carries insurance to the trades and the artels the rolls had skipped.",
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
    id: "ru.sec.atomicProgramme",
    countryId: "RU",
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
    title: "Atomic Programme Act",
    description: "The closed cities and the directorate whose name appears on no map.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 3,
    levels: [
      {
        name: "No Atomic Programme",
        description: "No atomic programme exists; the physicists publish and are politely ignored.",
      },
      {
        name: "Research Institutes",
        description: "Research institutes take up the atomic problem under academic cover.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Atomic Directorate",
        description:
          "The atomic directorate: a numbered administration, closed cities, and a budget no one itemizes.",
        gdpCostFraction: 0.0029,
      },
      {
        name: "Full Atomic Complex",
        description:
          "The full complex: mining, separation, assembly, and testing under one unmarked roof.",
        gdpCostFraction: 0.0043,
      },
      {
        name: "Atomic Age Leadership",
        description:
          "Atomic-age leadership: maximal investment in the device and everything downstream of it.",
        gdpCostFraction: 0.0064,
      },
    ],
  },
  {
    id: "ru.sec.unionRepublicsStanding",
    countryId: "RU",
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
    title: "Union Republics Standing Act",
    description: "What a citizen of the republics may claim in law, in any language of the Union.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Statutory Standing",
        description:
          "No statutory standing exists; the republic citizen's claims stop at the oblast line.",
      },
      {
        name: "Formal Standing",
        description:
          "Formal standing is written into statute — a right that reads well in every language.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Standing Commission",
        description:
          "A standing commission hears national grievances and occasionally resolves one.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Broad Enforcement",
        description:
          "Broad enforcement: language rights and cadre quotas policed by inspectors with authority.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Full Standing Charter",
        description:
          "A full standing charter: comprehensive rights for the republics' citizens, enforceable in the republics' courts.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "ru.sec.ruralElectrification",
    countryId: "RU",
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
    description: "The bulb in the village hut — the plan's most visible promise.",
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
        description: "District stations bring the first current to the rural raion centers.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Rural Networks",
        description:
          "Rural networks string the lines outward from the district stations to the collective farms.",
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
    id: "ru.sec.machineTractorStations",
    countryId: "RU",
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
    description:
      "The tractors belong to the station, the station to the state, the harvest to the procurement plan.",
    category: "economy",
    allowedScope: "both",
    baselineLevel: 3,
    levels: [
      {
        name: "No Station Network",
        description:
          "No station network exists; the collective farms plough with what they own, which is little.",
      },
      {
        name: "District Stations",
        description: "District stations lease tractors and combines to the surrounding farms.",
        incomeCostFraction: 0.0031,
      },
      {
        name: "Station Network",
        description:
          "The station network covers the grain belt, machinery and mechanics on state account.",
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
    id: "ru.sec.workersSettlements",
    countryId: "RU",
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
    description: "Turning the barracks settlements around the plants into something like towns.",
    category: "infrastructure",
    allowedScope: "both",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme touches the settlements; the barracks towns around the plants stay barracks.",
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
          "Comprehensive redevelopment turns the barracks towns into towns without qualification.",
        gdpCostFraction: 0.005,
      },
      {
        name: "Model Settlements Drive",
        description:
          "A model settlements drive: the factory settlement made a showcase, with amenities the old cities envy.",
        gdpCostFraction: 0.0071,
      },
    ],
    budgetKeyOverride: "other",
  },
  {
    id: "ru.sec.tradeUnionRelations",
    countryId: "RU",
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
      "The union committee signs what the director drafts — but it holds the sanatorium passes.",
    category: "economy",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the workplace; management decides and the union, if present, watches.",
      },
      {
        name: "Union Committees",
        description: "Union committees are chartered in the enterprises with a consultative voice.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Relations Framework",
        description:
          "A relations framework: collective agreements signed and grievance procedures that produce answers.",
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
          "A workplace democracy charter: the collective's voice binding on management across the enterprise.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "ru.sec.higherEducationInstitutes",
    countryId: "RU",
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
    title: "Higher Education Institutes Act",
    description: "The engineering institutes minting the cadres the ministries devour.",
    category: "education",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No expansion programme exists; the institutes admit what they can seat and turn the rest away.",
      },
      {
        name: "Institute Places",
        description:
          "Funded institute places grow with each intake, the ministries bidding for graduates.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Institutes Expansion",
        description:
          "The expansion in earnest: new institutes opened, faculties doubled, and dormitories built beside them.",
        gdpCostFraction: 0.0021,
      },
      {
        name: "Expanded Stipends",
        description: "Expanded stipends put a living allowance behind every admitted student.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Universal Higher Education Push",
        description:
          "A universal push: higher education open at scale, with places and stipends for all who qualify.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "ru.sec.hospitalConstruction",
    countryId: "RU",
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
          "No building programme exists; the service works out of prewar wards and converted barracks.",
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
        description: "The regional hospital plan: a full modern hospital for every oblast center.",
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
    id: "ru.sec.stateArbitration",
    countryId: "RU",
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
    title: "State Arbitration Act",
    description: "The tribunals where one state enterprise sues another, and the state wins.",
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
        description: "Arbitration tribunals hear contract disputes between state enterprises.",
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
    id: "ru.sec.internalPassportResidence",
    countryId: "RU",
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
    title: "Internal Passport and Residence Act",
    description:
      "The residence permit (*propiska*) decides who may live where; the villager has no passport at all.",
    category: "society",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "Movement Frozen",
        description:
          "Movement is frozen: the passport regime binds each citizen to a registered address, and the village to itself.",
      },
      {
        name: "Passport Regime",
        description:
          "The passport regime stands, but its enforcement follows procedure rather than whim.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Relaxed Registration",
        description:
          "Registration is relaxed: transfers approved routinely, and the propiska loses some teeth.",
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
          "Free settlement: residence is a notification, not a privilege, anywhere in the Union.",
        gdpCostFraction: 0.0021,
      },
    ],
    reformTitle: "Residence Liberalization Act",
  },
  {
    id: "ru.sec.justiceAdministration",
    countryId: "RU",
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
    description: "Clerks, stenographers, and the machinery beneath the gavel.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme funds the courts' machinery; the stenographer shares one typewriter with three judges.",
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
    id: "ru.sec.correctiveStandards",
    countryId: "RU",
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
    title: "Corrective Institutions Standards Act",
    description: "Rules for the camps — observed where the inspector happens to stand.",
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
          "Inspected institutions: the procuracy walks the camps and its reports carry weight.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Reformed Corrections",
        description:
          "Reformed corrections: standards enforced, excesses prosecuted, and the regime bound by its own rules.",
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
    id: "ru.sec.criminalInvestigations",
    countryId: "RU",
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
    title: "Criminal Investigations Directorate Act",
    description: "The detectives who chase the thieves-in-law the state pretends not to have.",
    category: "order",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Directorate",
        description:
          "No directorate exists; the ordinary thief is chased, if at all, by the beat militiaman.",
      },
      {
        name: "Investigation Bureaus",
        description: "Investigation bureaus staff the cities with detectives and case files.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Union Directorate",
        description: "A union directorate coordinates investigations across republic lines.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "National Coordination",
        description:
          "National coordination: files, forensics, and informants pooled against the organized underworld.",
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
    id: "ru.sec.parksGreenBelts",
    countryId: "RU",
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
    description: "The park of culture and rest — where the city breathes on its day off.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme plants anything; the city's green is what survived construction.",
      },
      {
        name: "City Parks",
        description: "City parks are funded — the park of culture and rest, band shell included.",
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
    id: "ru.sec.waterSewerageWorks",
    countryId: "RU",
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
    description: "Pipes and treatment works for cities that doubled faster than their sewers.",
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
    id: "ru.sec.localAirDefense",
    countryId: "RU",
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
    title: "Local Air Defense Act",
    description: "Sirens, cellars, and drills for the war after the last one.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
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
        name: "Local Defense Organization",
        description:
          "The local defense organization drills the factories and house committees in earnest.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Shelter and Continuity",
        description:
          "Shelter and continuity: basements hardened, stocks cached, and evacuation routes rehearsed.",
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
    id: "ru.sec.electoralCommissions",
    countryId: "RU",
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
        name: "Union Standards",
        description: "Union standards fix procedure everywhere: one law for every polling place.",
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
    id: "ru.sec.ministerialReorganization",
    countryId: "RU",
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
    description: "Ministries merged, split, and merged again — the org chart as politics.",
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
    id: "ru.sec.stateRadioTelevision",
    countryId: "RU",
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
        description: "No state broadcasting exists; the loudspeakers on the squares fall silent.",
      },
      {
        name: "Radio Network",
        description:
          "The radio network carries the wired speaker into apartments and squares across the Union.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Radio and Television",
        description:
          "Radio is joined by television: the first studios and transmitters in the great cities.",
        gdpCostFraction: 0.0014,
      },
      {
        name: "Television Expansion",
        description: "Television expands across the republics, relay mast by relay mast.",
        gdpCostFraction: 0.0025,
      },
      {
        name: "Full Union Media",
        description:
          "Full union media: broadcasting to every settlement, on every set the factories can produce.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "ru.sec.fraternalAssistance",
    countryId: "RU",
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
    description: "Credits, advisers, and blueprints for the fraternal republics abroad.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Assistance Programmes",
        description:
          "No assistance programmes exist; the fraternal republics abroad are congratulated and left to it.",
      },
      {
        name: "Reconstruction Credits",
        description:
          "Reconstruction credits underwrite the allies' rebuilding, on terms nobody reads aloud.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Assistance Programmes",
        description:
          "Assistance programmes send advisers, blueprints, and machinery with the credits.",
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
          "Development underwriting: the Union carries the bloc's industrialization on its own ledger.",
        gdpCostFraction: 0.0036,
      },
    ],
  },
  {
    id: "ru.sec.collectiveSecurityTreaties",
    countryId: "RU",
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
    description:
      "Friendship treaties with the fraternal states — and the garrisons that anchor them.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Treaties",
        description:
          "No treaties bind the allies; each fraternal army answers only to its own capital.",
      },
      {
        name: "Bilateral Pacts",
        description: "Bilateral pacts pair the Union with each ally separately.",
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
          "Integrated commands: joint staffs, common doctrine, and exercises on each other's soil.",
        gdpCostFraction: 0.0012,
      },
      {
        name: "Global Alliance Web",
        description:
          "A global alliance web: collective security wherever the Union's writ or friendship reaches.",
        gdpCostFraction: 0.0018,
      },
    ],
  },
  {
    id: "ru.sec.reservesVoluntaryDefense",
    countryId: "RU",
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
    title: "Reserves and Voluntary Defense Act",
    description: "Every parachute club and radio circle doubles as the army's waiting room.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reserve System",
        description:
          "No reserve system exists; the discharged soldier's skills demobilize with him.",
      },
      {
        name: "Reserve Registers",
        description: "Reserve registers track the discharged by specialty and district.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Voluntary Defense Society",
        description:
          "The voluntary defense society: parachute clubs, radio circles, and rifle ranges as the army's anteroom.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Deep Reserve Structure",
        description:
          "A deep reserve structure: refresher training and mobilization assignments for millions.",
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
    id: "ru.sec.stateMaterialReserves",
    countryId: "RU",
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
    description: "Grain, metal, and fuel in numbered depots, against the day nobody names.",
    category: "environment",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Reserves",
        description:
          "No reserves are held; the state buys its grain and fuel in the same season it burns them.",
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
    id: "ru.sec.quarriesLocalMaterials",
    countryId: "RU",
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
    description: "Sand, stone, and gravel — the plan's least glamorous ledger.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
    levels: [
      {
        name: "Grounds Unworked",
        description:
          "The grounds go unworked; construction hauls sand and stone from wherever it can requisition them.",
      },
      {
        name: "Local Licensing",
        description: "Local licensing opens district quarries under soviet supervision.",
        gdpCostFraction: 0.00021,
        gdpRevenueFraction: 0.00043,
      },
      {
        name: "Expanded Workings",
        description: "Expanded workings supply the construction trusts from planned pits.",
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
          "Full multiple use: every workable deposit mapped, licensed, and feeding the nearest construction front.",
        gdpCostFraction: 0.0008,
        gdpRevenueFraction: 0.0012,
      },
    ],
  },
  {
    id: "ru.sec.communalTariffs",
    countryId: "RU",
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
    description: "Rent and heat cost kopecks; the difference comes out of the budget.",
    category: "environment",
    allowedScope: "both",
    baselineLevel: 1,
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
          "Token tariffs: kopeck rents by law, with the budget quietly paying the difference forever.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "ru.sec.schoolMealsBoarding",
    countryId: "RU",
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
    description: "A hot breakfast at school, and a boarding place where the village has no school.",
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
    id: "ru.sec.qualificationsDiplomas",
    countryId: "RU",
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
    description: "What the diploma certifies, from the trade school to the candidate's degree.",
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
        name: "Union Qualifications",
        description:
          "Union qualifications: one register of trades and degrees, valid from Minsk to Magadan.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Universal Standards",
        description:
          "Universal standards: every qualification examined, registered, and honored identically across the Union.",
        gdpCostFraction: 0.0013,
      },
    ],
  },
  {
    id: "ru.sec.specialLanguageSchools",
    countryId: "RU",
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
    description: "The mathematics school and the English school — narrow doors, much envied.",
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
          "Special schools open in the capitals — the mathematics school, the English school, doors much envied.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Expanded Tracks",
        description: "Expanded tracks bring selective streams to the oblast centers.",
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
    id: "ru.sec.maternityChildWelfare",
    countryId: "RU",
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
    description: "The maternity home, the milk kitchen, and the consultation clinic.",
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
          "The mother-and-child service: milk kitchens, consultation clinics, and home visits after every birth.",
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
    id: "ru.sec.equalLaborStanding",
    countryId: "RU",
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
          "Formal equality is written into the labor code, awaiting anyone to enforce it.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Equal Standing Enforced",
        description:
          "Equal standing is enforced: pay audits by the inspectorate, and violations answered with fines.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Enforcement Powers",
        description:
          "Enforcement powers with teeth: quotas for advancement and the night-shift exemptions honored in practice.",
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
    id: "ru.sec.foreignTradeOperations",
    countryId: "RU",
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
    description: "The monopoly's trading arms, buying machines and selling grain.",
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
          "Trade missions open in the friendly capitals, buying machines and selling grain.",
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
          "Expanded exchanges: trade agreements multiplied, and the port cranes finally busy.",
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
    id: "ru.sec.warInvalidsProvision",
    countryId: "RU",
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
    description: "A war's worth of the maimed, owed more than the budget cares to remember.",
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
          "The expanded care system: retraining, motorized carriages, and housing priority for the invalided.",
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
    id: "ru.sec.medicalResearchInstitutes",
    countryId: "RU",
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
    description: "The academy's medical institutes, chasing what still kills the Soviet citizen.",
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
    id: "ru.sec.departmentalClinics",
    countryId: "RU",
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
    title: "Departmental Clinics Act",
    description:
      "The railway has its clinics, the ministry its polyclinic — rank chooses your doctor.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Framework",
        description:
          "No framework governs the closed clinics; each ministry doctors its own behind its own doors.",
      },
      {
        name: "Departmental Networks",
        description:
          "Departmental networks are chartered openly — the railway's clinics, the miners' sanatoria.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Parallel Systems Rules",
        description:
          "Parallel systems rules bind the departmental networks to common standards and reporting.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "Portable Attachments",
        description:
          "Portable attachments: the worker keeps his clinic rights when he changes ministries.",
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
    id: "ru.sec.laborDisciplineSobriety",
    countryId: "RU",
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
    title: "Labor Discipline and Sobriety Act",
    description: "The wall newspaper names the drunkard; the comrades' court does the rest.",
    category: "health",
    allowedScope: "national",
    baselineLevel: 1,
    levels: [
      {
        name: "No Campaigns",
        description:
          "No campaigns are waged; the drunkard and the shirker answer only to their foreman's patience.",
      },
      {
        name: "Discipline Rules",
        description: "Discipline rules tighten lateness and absence penalties in the code.",
        gdpCostFraction: 0.00021,
      },
      {
        name: "Sobriety Campaigns",
        description:
          "Sobriety campaigns: agitation, restricted sales hours, and the wall newspaper's mockery.",
        gdpCostFraction: 0.00036,
      },
      {
        name: "Comrades' Courts Drive",
        description:
          "The comrades' courts drive: the collective judges its own idlers and drinkers, publicly.",
        gdpCostFraction: 0.0006,
      },
      {
        name: "Total Discipline Regime",
        description:
          "A total discipline regime: comprehensive campaigns binding the working day to the sober clock.",
        gdpCostFraction: 0.0009,
      },
    ],
  },
  {
    id: "ru.sec.newIndustrialCities",
    countryId: "RU",
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
    description: "A steel plant first, then a city around it, in that order.",
    category: "infrastructure",
    allowedScope: "national",
    baselineLevel: 2,
    levels: [
      {
        name: "No Programme",
        description:
          "No programme exists; the new plants rise and their workers sleep in mud and canvas.",
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
    id: "ru.sec.urbanTransport",
    countryId: "RU",
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
    description: "The tram at dawn, packed to the doors, carrying the plan to work.",
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
          "The metropolitan programme: high-capacity routes and the first metro extensions beyond the capitals.",
        gdpCostFraction: 0.0036,
      },
      {
        name: "Transit Renaissance",
        description:
          "A transit renaissance: comprehensive urban transport, the fare kept at a kopeck and the wait at minutes.",
        gdpCostFraction: 0.0054,
      },
    ],
  },
  {
    id: "ru.sec.stateSecurityOrgans",
    countryId: "RU",
    kind: "secondary",
    targets: [
      { metricId: "defense.institutions", weight: 0.6 },
      { metricId: "defense.projection", weight: 0.35 },
      { metricId: "governance.centralAuthority", weight: 0.3 },
    ],
    title: "State Security Organs Appropriation",
    description: "The allocation carried by the security organs, voted without public particulars.",
    category: "defense",
    allowedScope: "national",
    baselineLevel: 0,
    budgetKeyOverride: "intelligence",
    levels: [
      {
        name: "Unfunded",
        description: "No allocation is carried. The organs hold their files and mount nothing.",
      },
      {
        name: "Nominal Provision",
        description: "A minimal allocation keeps the central apparatus and a few residencies.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "Standing Service",
        description:
          "The organs work their established residencies and keep one network properly funded.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Expanded Service",
        description:
          "Residencies multiply and several networks are carried at full funding together.",
        gdpCostFraction: 0.003,
      },
      {
        name: "Unrestricted Vote",
        description:
          "The allocation is carried without particulars and the organs go where they choose.",
        gdpCostFraction: 0.005,
      },
    ],
  },
];
