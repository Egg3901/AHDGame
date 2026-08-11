import {
  FAMILY_SLUGS,
  POLITICAL_METRIC_CATEGORIES,
  REQUIRED_CATEGORY_LEANS,
  type PoliticalMetricCategoryId,
  type PoliticalMetricFamily,
  type PoliticalMetricId,
} from "./types";

/**
 * Per-family authored content, keyed by slug in FAMILY_SLUGS order (lean comes
 * from position). Transcribed verbatim from the approved design catalog
 * (docs/superpowers/specs/assets/2026-07-16-metrics-mock-data.js FAMILIES).
 */
interface FamilyContent {
  description: string;
  pos: string[];
  neg: string[];
  indicators: { early: string[]; modern: string[] };
  reformName?: string;
}

const CONTENT: {
  [C in PoliticalMetricCategoryId]: Record<(typeof FAMILY_SLUGS)[C][number], FamilyContent>;
} = {
  economy: {
    workerSecurity: {
      description:
        "Job security, collective bargaining reach, and protection against arbitrary dismissal.",
      pos: ["Collective bargaining protections", "Full-employment hiring programs"],
      neg: ["Manufacturing layoffs", "Anti-union statutes in key regions"],
      indicators: {
        early: [
          "Union membership share",
          "Strike settlement rate",
          "Dismissal protections",
          "Unemployment insurance reach",
        ],
        modern: [
          "Union membership share",
          "Gig-work coverage",
          "Dismissal protections",
          "Wage-theft enforcement",
        ],
      },
    },
    mobility: {
      description:
        "Movement out of poverty and narrowing of income gaps between groups and regions.",
      pos: ["Rural assistance programs", "Veterans' benefit uptake"],
      neg: ["Depressed mining regions", "Urban slum persistence"],
      indicators: {
        early: [
          "Poverty headcount",
          "Regional income spread",
          "Relief caseloads",
          "Farm income parity",
        ],
        modern: [
          "Poverty headcount",
          "Intergenerational mobility",
          "Regional income spread",
          "Benefit adequacy",
        ],
      },
    },
    householdIncome: {
      description: "Purchasing power of the typical household after prices.",
      pos: ["Postwar wage settlements", "Consumer goods expansion"],
      neg: ["Food price pressure", "Housing cost growth"],
      indicators: {
        early: [
          "Median wage index",
          "Food basket cost",
          "Household durables ownership",
          "Rent burden",
        ],
        modern: [
          "Median wage index",
          "Cost-of-living index",
          "Household savings rate",
          "Rent burden",
        ],
      },
    },
    stability: {
      description: "Price stability and the predictability of the macroeconomic environment.",
      pos: ["Stable commodity contracts", "Credible budget framework"],
      neg: ["Import price shocks", "Credit expansion pressure"],
      indicators: {
        early: [
          "Consumer price index",
          "Currency reserve cover",
          "Budget balance",
          "Output volatility",
        ],
        modern: [
          "Consumer price index",
          "Policy rate credibility",
          "Debt service ratio",
          "Output volatility",
        ],
      },
    },
    productivity: {
      description:
        "Output per worker, capital deepening, and the rate of new enterprise formation.",
      pos: ["Machine-tool modernization", "Industrial R&D expansion"],
      neg: ["Aging plant stock", "Skilled labor shortages"],
      indicators: {
        early: [
          "Output per worker",
          "Fixed investment share",
          "New plant registrations",
          "Capacity utilisation",
        ],
        modern: [
          "Output per worker",
          "ICT capital share",
          "Business formation rate",
          "Capacity utilisation",
        ],
      },
    },
    fiscal: {
      description: "Sustainability of public finances and efficiency of the tax burden.",
      pos: ["Postwar debt rundown", "Broadened revenue base"],
      neg: ["Defense budget pressure", "Subsidy commitments"],
      indicators: {
        early: [
          "Debt-to-output ratio",
          "Marginal tax drag",
          "Budget execution",
          "Arrears incidence",
        ],
        modern: ["Debt-to-output ratio", "Tax gap", "Structural balance", "Arrears incidence"],
      },
    },
    competition: {
      description: "Ease of market entry, competitive pressure, and regulatory adaptability.",
      pos: ["Licensing simplification", "Entry of new producers"],
      neg: ["Cartel concentration", "Price control rigidity"],
      indicators: {
        early: [
          "Entry licensing time",
          "Producer concentration",
          "Price control coverage",
          "Trade openness",
        ],
        modern: [
          "Entry licensing time",
          "Market concentration",
          "Regulatory burden index",
          "Trade openness",
        ],
      },
    },
  },
  education: {
    universalSchooling: {
      description: "Reach and fairness of free public schooling across regions and groups.",
      pos: ["School construction program", "Rural teacher postings"],
      neg: ["Segregated and unequal districts", "Overcrowded urban classrooms"],
      indicators: {
        early: ["Enrolment rate", "Class size", "Rural school coverage", "Free meal provision"],
        modern: [
          "Enrolment rate",
          "Funding equity index",
          "Early-years coverage",
          "Attainment gap",
        ],
      },
    },
    teacherCorps: {
      description: "Public investment in schools and the strength of the teaching profession.",
      pos: ["Teacher training colleges", "Pay settlement for teachers"],
      neg: ["Teacher shortages", "Deferred school maintenance"],
      indicators: {
        early: [
          "Teachers per pupil",
          "Teacher college output",
          "School capital budget",
          "Textbook availability",
        ],
        modern: [
          "Teachers per pupil",
          "Teacher retention",
          "School capital budget",
          "Digital equipment stock",
        ],
      },
    },
    adultSkills: {
      description: "Vocational routes and retraining capacity for the adult workforce.",
      pos: ["Apprenticeship expansion", "Night-school enrolment"],
      neg: ["Employer training cutbacks", "Mismatch with new industries"],
      indicators: {
        early: [
          "Apprenticeship places",
          "Trade certification rate",
          "Night-school enrolment",
          "Employer training spend",
        ],
        modern: [
          "Apprenticeship places",
          "Reskilling completion",
          "Adult numeracy",
          "Employer training spend",
        ],
      },
    },
    attainment: {
      description: "Completed schooling and basic literacy across the population.",
      pos: ["Literacy campaigns", "Secondary completion growth"],
      neg: ["Early leaving in poor regions", "War-cohort education gaps"],
      indicators: {
        early: ["Adult literacy", "Secondary completion", "Years of schooling", "Exam pass rate"],
        modern: [
          "Adult literacy",
          "Tertiary attainment",
          "Years of schooling",
          "Assessment scores",
        ],
      },
    },
    research: {
      description: "Research capacity, university quality, and scientific standing.",
      pos: ["Physics and rocketry programs", "Research institute funding"],
      neg: ["Brain drain to industry", "Equipment import limits"],
      indicators: {
        early: [
          "Research staff count",
          "Institute budget share",
          "Patent and paper output",
          "Doctoral graduations",
        ],
        modern: [
          "R&D share of output",
          "Citation impact",
          "University rankings",
          "Doctoral graduations",
        ],
      },
    },
    standards: {
      description: "Rigor of examinations, curricula, and accountability for results.",
      pos: ["Standardised examination reform", "Inspection regime"],
      neg: ["Grade drift complaints", "Curriculum disputes"],
      indicators: {
        early: [
          "Exam rigour index",
          "Inspection coverage",
          "Failure-rate integrity",
          "Curriculum stability",
        ],
        modern: [
          "Exam rigour index",
          "School accountability scores",
          "Grade integrity",
          "Curriculum stability",
        ],
      },
    },
    choice: {
      description: "Alternatives to assigned schooling and merit-based selection routes.",
      pos: ["Selective school expansion", "Scholarship endowments"],
      neg: ["Capacity limits at top schools", "Access disputes"],
      indicators: {
        early: [
          "Selective school places",
          "Scholarship coverage",
          "Private enrolment share",
          "Transfer mobility",
        ],
        modern: [
          "Choice program uptake",
          "Scholarship coverage",
          "Independent enrolment share",
          "Transfer mobility",
        ],
      },
    },
  },
  health: {
    universalCare: {
      description: "Reach of publicly guaranteed care regardless of income.",
      pos: ["Expanded rural clinic coverage", "Increased physician training"],
      neg: ["Hospital staffing shortage", "Regional inequality"],
      indicators: {
        early: [
          "Clinic coverage",
          "Physician density",
          "Free treatment share",
          "Infant care access",
        ],
        modern: ["Coverage rate", "Waiting times", "Out-of-pocket share", "Rural access"],
      },
    },
    socialInsurance: {
      description: "Adequacy of pensions, sickness, and unemployment protection.",
      pos: ["Pension uprating", "Widows' and invalids' provision"],
      neg: ["Contribution shortfalls", "Coverage gaps for casual workers"],
      indicators: {
        early: [
          "Pension replacement rate",
          "Sickness benefit coverage",
          "Claims processing time",
          "Contribution compliance",
        ],
        modern: [
          "Pension replacement rate",
          "Benefit adequacy index",
          "Claims processing time",
          "Coverage of informal work",
        ],
      },
    },
    prevention: {
      description: "Vaccination, sanitation, and community health infrastructure.",
      pos: ["Vaccination campaign", "Sanitary inspection corps"],
      neg: ["Rising treatment costs", "Understaffed district services"],
      indicators: {
        early: ["Vaccination rate", "TB incidence", "Sanitation coverage", "Maternal visit rate"],
        modern: [
          "Vaccination rate",
          "Screening uptake",
          "Health visitor coverage",
          "Outbreak response time",
        ],
      },
    },
    outcomes: {
      description: "Life expectancy, infant mortality, and headline health results.",
      pos: ["Falling infant mortality", "Antibiotic availability"],
      neg: ["Industrial disease burden", "Tobacco-related illness"],
      indicators: {
        early: [
          "Life expectancy",
          "Infant mortality",
          "Epidemic incidence",
          "Occupational injury rate",
        ],
        modern: [
          "Life expectancy",
          "Infant mortality",
          "Chronic disease burden",
          "Avoidable mortality",
        ],
      },
    },
    responsibility: {
      description: "Targeting of benefits and individual contribution to health costs.",
      pos: ["Means-tested targeting reform", "Occupational health checks"],
      neg: ["Charge disputes", "Administrative complexity"],
      indicators: {
        early: [
          "Charge compliance",
          "Targeting accuracy",
          "Fitness-for-work rate",
          "Fraud incidence",
        ],
        modern: [
          "Cost-sharing balance",
          "Targeting accuracy",
          "Work capability rate",
          "Fraud incidence",
        ],
      },
    },
    providerChoice: {
      description: "Room for provider variety, specialist access, and patient selection.",
      pos: ["Specialist clinic growth", "Consultant autonomy settlement"],
      neg: ["Waiting lists for referral", "Uneven specialist geography"],
      indicators: {
        early: [
          "Specialist access time",
          "Provider variety index",
          "Referral freedom",
          "Private bed share",
        ],
        modern: [
          "Specialist access time",
          "Provider choice uptake",
          "Referral freedom",
          "Independent sector share",
        ],
      },
    },
    systemEfficiency: {
      description: "Cost per outcome and the pace of innovation in delivery.",
      pos: ["Hospital throughput gains", "Pharmaceutical innovation"],
      neg: ["Estate maintenance backlog", "Administrative overhead growth"],
      indicators: {
        early: [
          "Cost per treated case",
          "Bed turnover",
          "Admin overhead share",
          "Drug availability",
        ],
        modern: [
          "Cost per outcome",
          "Day-case rate",
          "Admin overhead share",
          "Innovation adoption",
        ],
      },
    },
  },
  infrastructure: {
    publicHousing: {
      description: "Publicly provided housing and protection of tenants.",
      pos: ["Mass housing construction drive", "Rent control enforcement"],
      neg: ["Waiting list growth", "Prefab quality defects"],
      indicators: {
        early: [
          "Units completed per year",
          "Waiting list length",
          "Rent burden of tenants",
          "Overcrowding rate",
        ],
        modern: [
          "Social housing stock",
          "Waiting list length",
          "Rent burden of tenants",
          "Homelessness rate",
        ],
      },
    },
    transit: {
      description: "Coverage and quality of railways and urban public transport.",
      pos: ["Electrification of trunk lines", "New metro construction"],
      neg: ["Deferred track maintenance", "Rolling stock age"],
      indicators: {
        early: ["Route coverage", "On-time performance", "Fleet age", "Fare affordability"],
        modern: ["Route coverage", "On-time performance", "Fleet age", "Ridership per capita"],
      },
    },
    utilities: {
      description: "Household access to essential utility and communication services.",
      pos: ["Rural electrification program", "Exchange capacity expansion"],
      neg: ["Rural connection backlog", "Storm damage repair costs"],
      indicators: {
        early: [
          "Electricity access",
          "Telephone access",
          "Postal reliability",
          "Water and sanitation",
          "Radio availability",
        ],
        modern: [
          "Broadband availability",
          "Mobile coverage",
          "Connection affordability",
          "Network reliability",
          "Rural digital access",
        ],
      },
    },
    condition: {
      description: "Physical state and dependability of core infrastructure.",
      pos: ["Bridge renewal program", "Grid redundancy investment"],
      neg: ["War-era asset fatigue", "Flood damage backlog"],
      indicators: {
        early: [
          "Asset condition index",
          "Outage frequency",
          "Repair backlog",
          "Bridge sufficiency",
        ],
        modern: [
          "Asset condition index",
          "Outage frequency",
          "Repair backlog",
          "Resilience rating",
        ],
      },
    },
    highways: {
      description: "Road capacity and the efficiency of goods movement.",
      pos: ["Trunk road construction", "Freight terminal modernisation"],
      neg: ["Urban congestion growth", "Fuel cost pressure on hauliers"],
      indicators: {
        early: ["Paved mileage", "Freight ton-miles", "Congestion delay", "Port throughput"],
        modern: [
          "Network capacity",
          "Freight ton-miles",
          "Congestion delay",
          "Intermodal throughput",
        ],
      },
    },
    ownership: {
      description: "Routes to owning a home and private building activity.",
      pos: ["Mortgage guarantee expansion", "Private starts growth"],
      neg: ["Land price inflation", "Materials shortage"],
      indicators: {
        early: ["Ownership rate", "Private starts", "Mortgage access", "Plot allocation rate"],
        modern: ["Ownership rate", "Private starts", "Mortgage affordability", "First-buyer age"],
      },
    },
    development: {
      description: "Ease of building and flexibility of land-use rules.",
      pos: ["Permit process streamlining", "Industrial zone releases"],
      neg: ["Planning appeal backlogs", "Green-belt disputes"],
      indicators: {
        early: [
          "Permit approval time",
          "Zoned land release",
          "Appeal backlog",
          "Construction cost index",
        ],
        modern: [
          "Permit approval time",
          "Zoning flexibility index",
          "Appeal backlog",
          "Construction cost index",
        ],
      },
    },
  },
  order: {
    dueProcess: {
      description: "Procedural rights, humane detention, and rehabilitation over punishment.",
      pos: ["Case review commissions", "Probation service expansion"],
      neg: ["Detention overcrowding", "Coerced confession complaints"],
      indicators: {
        early: [
          "Case review rate",
          "Detention conditions",
          "Probation coverage",
          "Reoffending after release",
        ],
        modern: [
          "Wrongful conviction remedies",
          "Detention conditions",
          "Probation coverage",
          "Reoffending after release",
        ],
      },
      reformName: "Legal Equality and Due Process",
    },
    legalAid: {
      description: "Whether ordinary citizens can obtain counsel and redress.",
      pos: ["Legal aid scheme funding", "Complaint office network"],
      neg: ["Counsel shortages outside cities", "Fee threshold disputes"],
      indicators: {
        early: [
          "Aid caseload coverage",
          "Counsel availability",
          "Petition resolution rate",
          "Court fee burden",
        ],
        modern: [
          "Aid caseload coverage",
          "Counsel availability",
          "Redress success rate",
          "Court fee burden",
        ],
      },
    },
    communityTrust: {
      description: "Public confidence in the police and reporting willingness.",
      pos: ["Foot patrol restoration", "Complaint handling reform"],
      neg: ["High-profile misconduct cases", "Uneven enforcement patterns"],
      indicators: {
        early: [
          "Confidence surveys",
          "Crime reporting rate",
          "Complaint substantiation",
          "Patrol visibility",
        ],
        modern: [
          "Confidence surveys",
          "Crime reporting rate",
          "Complaint substantiation",
          "Stop disparity index",
        ],
      },
    },
    safety: {
      description: "Headline crime levels and everyday safety.",
      pos: ["Falling street crime", "Juvenile diversion programs"],
      neg: ["Black-market activity", "Urban theft rise"],
      indicators: {
        early: [
          "Recorded crime rate",
          "Homicide rate",
          "Clearance rate",
          "Night-safety perception",
        ],
        modern: ["Recorded crime rate", "Homicide rate", "Clearance rate", "Victimisation surveys"],
      },
    },
    courts: {
      description: "Speed and capacity of the court system.",
      pos: ["Judicial appointments round", "Procedure simplification"],
      neg: ["Case backlog growth", "Courtroom shortage"],
      indicators: {
        early: ["Case backlog", "Time to trial", "Judges per capita", "Appeal turnaround"],
        modern: ["Case backlog", "Time to trial", "Digital filing rate", "Appeal turnaround"],
      },
    },
    policeStrength: {
      description: "Staffing, equipment, and operational capability of law enforcement.",
      pos: ["Recruitment above establishment", "Radio and vehicle modernisation"],
      neg: ["Rural coverage gaps", "Training bottlenecks"],
      indicators: {
        early: [
          "Officers per capita",
          "Response time",
          "Equipment modernity",
          "Detective clearance",
        ],
        modern: [
          "Officers per capita",
          "Response time",
          "Forensic capacity",
          "Detective clearance",
        ],
      },
    },
    deterrence: {
      description: "Severity and certainty of punishment as deterrent.",
      pos: ["Sentencing guideline tightening", "High-visibility enforcement"],
      neg: ["Prison capacity strain", "Deterrence effect disputes"],
      indicators: {
        early: [
          "Custody rate",
          "Sentence length index",
          "Recidivism of released",
          "Enforcement certainty",
        ],
        modern: [
          "Custody rate",
          "Sentence length index",
          "Recidivism of released",
          "Enforcement certainty",
        ],
      },
      reformName: "Sentencing Policy and Public Deterrence",
    },
  },
  environment: {
    conservation: {
      description: "Limits on industrial pollution and protection of nature.",
      pos: ["Smoke abatement ordinances", "River basin cleanup"],
      neg: ["Industrial effluent violations", "Smog episodes"],
      indicators: {
        early: [
          "Smoke density index",
          "River quality",
          "Protected area share",
          "Violation enforcement",
        ],
        modern: ["Emissions index", "River quality", "Protected area share", "Air quality days"],
      },
    },
    stewardship: {
      description: "Management of public lands, parks, and water systems.",
      pos: ["Reservoir construction", "Park service expansion"],
      neg: ["Erosion in new farmland", "Drought stress"],
      indicators: {
        early: [
          "Reservoir capacity",
          "Park visitation access",
          "Irrigated acreage",
          "Soil condition",
        ],
        modern: ["Water security index", "Park condition", "Wetland extent", "Soil condition"],
      },
    },
    urbanAir: {
      description: "Air, noise, and sanitation in cities.",
      pos: ["Smokeless fuel zones", "Green space requirements"],
      neg: ["Coal heating prevalence", "Vehicle exhaust growth"],
      indicators: {
        early: [
          "Smog days",
          "Urban green space",
          "Refuse collection coverage",
          "Respiratory illness rate",
        ],
        modern: [
          "Particulate levels",
          "Urban green space",
          "Noise exposure",
          "Respiratory illness rate",
        ],
      },
    },
    energySecurity: {
      description: "Reliability of energy supply and resilience of the grid.",
      pos: ["Generating capacity additions", "Strategic fuel stocks"],
      neg: ["Peak-load strain", "Fuel transport bottlenecks"],
      indicators: {
        early: ["Reserve margin", "Outage hours", "Fuel stock days", "Import dependence"],
        modern: ["Reserve margin", "Outage hours", "Storage capacity", "Import dependence"],
      },
    },
    resourceDev: {
      description: "Development of domestic energy and mineral resources.",
      pos: ["New field development", "Extraction technology gains"],
      neg: ["Declining seam productivity", "Remote logistics costs"],
      indicators: {
        early: [
          "Coal output",
          "Oil and gas output",
          "Mineral self-sufficiency",
          "Exploration activity",
        ],
        modern: [
          "Energy output",
          "Critical mineral supply",
          "Self-sufficiency ratio",
          "Exploration activity",
        ],
      },
    },
    affordability: {
      description: "Cost of energy to households and industry.",
      pos: ["Household tariff restraint", "Distribution efficiency gains"],
      neg: ["Winter price spikes", "Cross-subsidy distortions"],
      indicators: {
        early: [
          "Household fuel burden",
          "Industrial energy cost",
          "Queue and shortage incidence",
          "Tariff stability",
        ],
        modern: [
          "Household fuel burden",
          "Industrial energy cost",
          "Market price stability",
          "Fuel poverty rate",
        ],
      },
    },
    extraction: {
      description: "Freedom to extract and develop with light regulatory burden.",
      pos: ["Licensing round acceleration", "Royalty relief"],
      neg: ["Land access disputes", "Environmental review delays"],
      indicators: {
        early: ["Licence issuance time", "Royalty burden", "Review backlog", "Output vs quota"],
        modern: [
          "Licence issuance time",
          "Regulatory cost index",
          "Review backlog",
          "Investment attraction",
        ],
      },
    },
  },
  society: {
    integration: {
      description: "Equal standing of minority groups and integration in public life.",
      pos: ["Desegregation litigation wins", "Anti-discrimination enforcement"],
      neg: ["Segregationist resistance", "Housing discrimination"],
      indicators: {
        early: [
          "Integration of institutions",
          "Discrimination complaints",
          "Minority office-holding",
          "Mixed-area housing",
        ],
        modern: [
          "Discrimination gap indices",
          "Representation levels",
          "Hate incident rate",
          "Segregation index",
        ],
      },
    },
    womensOpportunity: {
      description: "Women's access to work and support for families.",
      pos: ["Nursery place expansion", "Maternity provision"],
      neg: ["Wage gap persistence", "Marriage-bar practices"],
      indicators: {
        early: ["Female employment rate", "Nursery coverage", "Maternity provision", "Pay gap"],
        modern: [
          "Female employment rate",
          "Childcare affordability",
          "Parental leave adequacy",
          "Pay gap",
        ],
      },
    },
    socialMobility: {
      description: "Ability to rise regardless of birth circumstances.",
      pos: ["Scholarship ladders", "Promotion from the shop floor"],
      neg: ["Elite closure of professions", "Regional opportunity gaps"],
      indicators: {
        early: [
          "Occupational mobility",
          "First-generation attainment",
          "Elite entry openness",
          "Regional opportunity index",
        ],
        modern: [
          "Occupational mobility",
          "First-generation attainment",
          "Income rank persistence",
          "Regional opportunity index",
        ],
      },
    },
    demography: {
      description: "Population growth, age balance, and demographic stability.",
      pos: ["Postwar baby boom", "Falling infant mortality"],
      neg: ["Rural depopulation", "War-cohort gender imbalance"],
      indicators: {
        early: ["Birth rate", "Dependency ratio", "Net migration", "Rural retention"],
        modern: ["Birth rate", "Dependency ratio", "Net migration", "Median age"],
      },
    },
    civicLife: {
      description: "Vitality of associations, clubs, and organised civic life.",
      pos: ["Membership organisation growth", "Community hall construction"],
      neg: ["Urban anonymity trend", "Volunteer leader shortage"],
      indicators: {
        early: [
          "Association membership",
          "Volunteer hours",
          "Local branch density",
          "Civic event attendance",
        ],
        modern: [
          "Association membership",
          "Volunteer hours",
          "Charitable giving",
          "Civic event attendance",
        ],
      },
      reformName: "Civic Associations and Volunteer Life",
    },
    familyStability: {
      description: "Marriage, family formation, and household stability.",
      pos: ["Family allowance support", "Housing for young families"],
      neg: ["Divorce rate rise", "Delayed family formation"],
      indicators: {
        early: [
          "Marriage rate",
          "Divorce rate",
          "Two-parent household share",
          "Family allowance reach",
        ],
        modern: [
          "Family formation rate",
          "Household stability",
          "Child wellbeing index",
          "Family support reach",
        ],
      },
    },
    tradition: {
      description: "Standing of traditional institutions and shared national identity.",
      pos: ["National ceremony participation", "Institutional membership strength"],
      neg: ["Secularisation trend", "Generational value shifts"],
      indicators: {
        early: [
          "Institution membership",
          "Ceremony participation",
          "National identity surveys",
          "Youth affiliation",
        ],
        modern: [
          "Institution membership",
          "National identity surveys",
          "Trust in tradition",
          "Youth affiliation",
        ],
      },
      reformName: "Federation Cohesion and National Identity",
    },
  },
  governance: {
    participation: {
      description: "Breadth and reality of popular participation in politics.",
      pos: ["Registration drive success", "Workplace council activity"],
      neg: ["Ballot access barriers", "Nomination control from above"],
      indicators: {
        early: ["Registration rate", "Turnout", "Contested seat share", "Council participation"],
        modern: ["Registration rate", "Turnout", "Contested seat share", "Participation equality"],
      },
      reformName: "Labor and Regional Political Participation",
    },
    openness: {
      description: "Freedom of the press and openness of official information.",
      pos: ["Investigative press strength", "Publication of state statistics"],
      neg: ["Official secrecy practices", "Censorship of criticism"],
      indicators: {
        early: [
          "Censorship incidence",
          "Press plurality",
          "Statistical disclosure",
          "Foreign media access",
        ],
        modern: [
          "Press freedom index",
          "FOI responsiveness",
          "Media plurality",
          "Journalist safety",
        ],
      },
      reformName: "Civil Liberties and Media Freedom",
    },
    localAutonomy: {
      description: "Real decision-making power at regional and local levels.",
      pos: ["Municipal revenue powers", "Regional plan discretion"],
      neg: ["Central override of localities", "Unfunded mandates"],
      indicators: {
        early: [
          "Local budget share",
          "Central override incidence",
          "Local staffing",
          "Regional discretion index",
        ],
        modern: [
          "Local budget share",
          "Devolved competencies",
          "Local fiscal capacity",
          "Regional discretion index",
        ],
      },
      reformName: "Regional and Municipal Autonomy",
    },
    integrity: {
      description: "Honesty and basic competence of the state machine.",
      pos: ["Audit office strengthening", "Procurement inspection"],
      neg: ["Patronage appointments", "Bribery in permits"],
      indicators: {
        early: [
          "Audit coverage",
          "Prosecution of officials",
          "Procurement irregularities",
          "Service delivery reliability",
        ],
        modern: [
          "Corruption perception",
          "Audit coverage",
          "Procurement transparency",
          "Service delivery reliability",
        ],
      },
    },
    administration: {
      description: "Efficiency of administration and predictability of rules.",
      pos: ["Civil service professionalisation", "Clear directive chains"],
      neg: ["Duplicated ministries", "Paperwork burden"],
      indicators: {
        early: [
          "Processing times",
          "Rule consistency",
          "Staff professionalism",
          "Directive execution rate",
        ],
        modern: [
          "Processing times",
          "Digital service coverage",
          "Rule consistency",
          "Regulatory predictability",
        ],
      },
      reformName: "Professional Civil Service and Rule of Law",
    },
    decisiveness: {
      description: "Ability of the executive to decide and act quickly.",
      pos: ["Unified leadership line", "Rapid decree implementation"],
      neg: ["Succession uncertainty", "Factional deadlock"],
      indicators: {
        early: [
          "Decision turnaround",
          "Leadership tenure",
          "Policy reversal rate",
          "Crisis response speed",
        ],
        modern: [
          "Decision turnaround",
          "Government stability",
          "Policy reversal rate",
          "Crisis response speed",
        ],
      },
      reformName: "Government Stability and Decision Capacity",
    },
    centralAuthority: {
      description: "Strength and discipline of central governing institutions.",
      pos: ["Institutional legitimacy", "Disciplined governing majority"],
      neg: ["Authority challenges", "Enforcement gaps in periphery"],
      indicators: {
        early: [
          "Directive compliance",
          "Institutional continuity",
          "Discipline incidence",
          "Peripheral enforcement",
        ],
        modern: [
          "Institutional trust",
          "Constitutional stability",
          "Enforcement uniformity",
          "Governing coherence",
        ],
      },
      reformName: "Central Executive Authority and Government Discipline",
    },
  },
  defense: {
    diplomacy: {
      description: "Diplomatic engagement, alliance-building, and arms restraint.",
      pos: ["Armistice negotiations", "New embassy openings"],
      neg: ["Bloc confrontation hardening", "Arms race pressure"],
      indicators: {
        early: [
          "Treaty engagements",
          "Alliance breadth",
          "Disarmament talks activity",
          "Diplomatic staffing",
        ],
        modern: [
          "Treaty engagements",
          "Alliance health",
          "Arms control participation",
          "Mediation role",
        ],
      },
    },
    institutions: {
      description: "Standing in international bodies and development assistance.",
      pos: ["UN agency leadership", "Reconstruction aid programs"],
      neg: ["Contribution arrears", "Aid effectiveness disputes"],
      indicators: {
        early: [
          "Institution memberships",
          "Aid volume",
          "Votes with majority",
          "Agency leadership posts",
        ],
        modern: [
          "Institution memberships",
          "Aid volume",
          "Multilateral influence",
          "Agency leadership posts",
        ],
      },
    },
    softPower: {
      description: "Attraction of the country's culture, science, and model abroad.",
      pos: ["Broadcasting reach abroad", "Cultural exchange missions"],
      neg: ["Hostile propaganda pressure", "Defection embarrassments"],
      indicators: {
        early: [
          "Foreign broadcast reach",
          "Cultural missions",
          "Student exchange inflow",
          "Press sentiment abroad",
        ],
        modern: [
          "Global favorability",
          "Cultural exports",
          "Student exchange inflow",
          "Media reach",
        ],
      },
    },
    security: {
      description: "Protection against espionage, subversion, and direct threats.",
      pos: ["Counter-espionage successes", "Border control modernisation"],
      neg: ["Spy ring revelations", "Infiltration incidents"],
      indicators: {
        early: [
          "Counter-intel case rate",
          "Border incident rate",
          "Critical site protection",
          "Warning system coverage",
        ],
        modern: [
          "Counter-intel case rate",
          "Cyber defense posture",
          "Critical site protection",
          "Warning system coverage",
        ],
      },
    },
    defenseIndustry: {
      description: "Capability of defense production and military technology.",
      pos: ["Jet and rocket programs", "Design bureau output"],
      neg: ["Cost overruns", "Skilled engineer shortage"],
      indicators: {
        early: [
          "Design program milestones",
          "Production line output",
          "Test success rate",
          "Engineer staffing",
        ],
        modern: [
          "R&D milestones",
          "Production capacity",
          "Test success rate",
          "Export competitiveness",
        ],
      },
    },
    armedForces: {
      description: "Manpower, training, and readiness of the armed forces.",
      pos: ["Postwar force modernisation", "Training tempo increase"],
      neg: ["Demobilisation friction", "Equipment maintenance backlog"],
      indicators: {
        early: [
          "Active strength",
          "Readiness rating",
          "Training hours",
          "Equipment serviceability",
        ],
        modern: [
          "Active strength",
          "Readiness rating",
          "Exercise performance",
          "Equipment serviceability",
        ],
      },
      reformName: "Federal Armed Forces Strength and Readiness",
    },
    projection: {
      description: "Ability to project power and deter rivals at distance.",
      pos: ["Thermonuclear program progress", "Overseas basing network"],
      neg: ["Rival capability growth", "Overstretch of commitments"],
      indicators: {
        early: [
          "Strategic weapon stockpile",
          "Bomber and missile reach",
          "Basing network",
          "Sphere stability",
        ],
        modern: [
          "Deterrent credibility",
          "Global basing/reach",
          "Rapid deployment capacity",
          "Sphere stability",
        ],
      },
      reformName: "Strategic Deterrent and Collective Security",
    },
  },
};

export const FAMILIES_BY_CATEGORY = Object.fromEntries(
  POLITICAL_METRIC_CATEGORIES.map((cat) => [
    cat.id,
    FAMILY_SLUGS[cat.id].map((slug, i): PoliticalMetricFamily => {
      const c = CONTENT[cat.id][slug as keyof (typeof CONTENT)[typeof cat.id]] as FamilyContent;
      return {
        id: `${cat.id}.${slug}` as PoliticalMetricId,
        categoryId: cat.id,
        slug,
        lean: REQUIRED_CATEGORY_LEANS[i],
        description: c.description,
        pos: c.pos,
        neg: c.neg,
        indicators: c.indicators,
        ...(c.reformName ? { reformName: c.reformName } : {}),
        higherIsBetter: true,
        activeFromYear: 1953,
        activeToYear: null,
      };
    }),
  ])
) as Record<PoliticalMetricCategoryId, PoliticalMetricFamily[]>;

export const POLITICAL_METRIC_FAMILIES: PoliticalMetricFamily[] =
  POLITICAL_METRIC_CATEGORIES.flatMap((cat) => FAMILIES_BY_CATEGORY[cat.id]);

const FAMILY_BY_ID = new Map(POLITICAL_METRIC_FAMILIES.map((f) => [f.id, f]));

export function getFamily(id: PoliticalMetricId): PoliticalMetricFamily {
  const f = FAMILY_BY_ID.get(id);
  if (!f) throw new Error(`Unknown political metric id: ${id}`);
  return f;
}

/**
 * Whether a family exists as a political axis in the given year. Windows are
 * inclusive at both ends; a null activeToYear means "never retires". Default
 * authoring is always-active — most of these axes are era-independent, so a
 * window is authored only where a family genuinely did not exist yet.
 */
export function isFamilyActive(family: PoliticalMetricFamily, year: number): boolean {
  if (year < family.activeFromYear) return false;
  if (family.activeToYear != null && year > family.activeToYear) return false;
  return true;
}
