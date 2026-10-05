import type { PrimaryMetricDefinition } from "./catalog";
import type { ObservationStatus } from "./rules/openingObservation";

const PLAYER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "01": "The share of people in the labor force who are looking for work. Hiring, layoffs, available jobs, and the ease of matching workers with employers all shape this rate.",
  "02": "The annual income available to a typical household after taxes and transfers, adjusted for local prices. It represents what households can actually afford in constant 1991 money.",
  "03": "The share of households whose resources fall below the national poverty threshold. Earnings, household size, prices, taxes, and income support all affect it.",
  "04": "How unevenly income is distributed across households. It reflects wage differences, taxes, transfers, and regional income gaps, but does not by itself measure opportunity.",
  "05": "The annual change in inflation-adjusted national output. A sustained trend matters more than a brief rebound after a downturn.",
  "06": "The annual change in how much the economy produces per hour worked. Skills, equipment, infrastructure, research, and technology adoption can all improve it.",
  "07": "The pace and predictability of consumer-price changes. Low, stable inflation is generally healthiest; deflation or rapidly rising prices can both cause harm.",
  "08": "The difference between exports and imports as a share of the economy. A surplus or deficit can be sustainable or risky depending on its size, cause, and duration.",
  "09": "The government's revenue minus spending and interest costs as a share of the economy. Positive values are surpluses and negative values are deficits.",
  "10": "Total public debt compared with annual economic output. Interest costs, repayment dates, growth, and the government's fiscal balance determine how burdensome that debt becomes.",
  "11": "The share of each student cohort that completes secondary education. Attendance, school capacity, teachers, and dropout prevention influence the result.",
  "12": "How well students master the knowledge and skills expected at the end of secondary education. Country-specific examinations are translated into a comparable 1991-era index.",
  "13": "The practical skills available across the working-age population. Literacy, vocational education, apprenticeships, retraining, and employer skill shortages contribute to it.",
  "14": "The share of eligible young adults enrolled in university or comparable higher education. Affordability, admissions, completion prospects, and available places all matter.",
  "15": "The country's ability to perform useful research and turn it into knowledge, technology, and productive activity. Researchers, laboratories, quality, and institutional capacity are considered together.",
  "16": "The share of people who are both enrolled in health coverage and able to reach real medical services. Formal eligibility alone is not enough when providers are unavailable.",
  "17": "How affordable medical care is for ordinary households after premiums, fees, medicine costs, and income are considered.",
  "18": "How long patients wait for needed treatment. Staffing, beds, clinics, referrals, and accumulated backlogs determine the delay.",
  "19": "Deaths that timely and effective health care could reasonably have prevented. Primary care, treatment access, and chronic-disease management are major drivers.",
  "20": "The average number of years a person would live under current age-specific death rates. Health care, safety, living conditions, and the environment move it slowly over time.",
  "21": "How readily people can obtain appropriate mental-health care. Provider capacity, waiting times, geographic reach, and unmet need all contribute.",
  "22": "The safety, availability, and quality of care for older people. Staffing, service capacity, family burden, and population aging affect the result.",
  "23": "The country's ability to detect and respond to public-health emergencies. It reflects trained staff, laboratories, surveillance, stockpiles, exercises, and regional coverage.",
  "24": "The pressure that rent or mortgage payments place on household income. Higher values mean housing consumes more of a typical household's resources.",
  "25": "The annual growth of the usable housing stock. Completed homes matter most, while permits, construction capacity, vacancies, and land availability shape future supply.",
  "26": "The condition and safety of roads and bridges. Maintenance backlogs, completed repairs, pavement quality, and structural risks are reflected in the score.",
  "27": "How many people can reach useful public transport and rely on it. Coverage, frequency, reliability, travel time, and ridership all matter.",
  "28": "The share of households with affordable, reliable communications access appropriate to the era. Rural coverage, speed, uptime, and price are included.",
  "29": "How reliably households receive safe drinking water. Treatment compliance, contamination, outages, and aging infrastructure determine the score.",
  "30": "The share of time electricity service remains available. Generation reserves, transmission capacity, maintenance, and outages all affect reliability.",
  "31": "Reported violent offenses per 100,000 residents. The measure combines comparable violent-crime categories while preserving regional differences.",
  "32": "Reported property and other nonviolent offenses per 100,000 residents. It is kept separate from violent crime so the two trends remain visible.",
  "33": "The number of incarcerated people per 100,000 residents. Sentencing, detention, diversion, crime, and prison capacity can all change it, so there is no universally ideal maximum or minimum.",
  "34": "The share of released people who reoffend within the tracked period. Rehabilitation, employment, housing, and support after release influence the result.",
  "35": "The quality of the air people actually breathe. Industrial and transport pollution, weather, and population exposure are combined into the score.",
  "36": "Annual greenhouse-gas emissions per resident. Power generation, transport, industry, agriculture, and imported emissions all contribute.",
  "37": "The share of electricity generated from renewable sources. Installed capacity, storage, curtailment, and actual generation determine the result.",
  "38": "How well communities can withstand and recover from climate and natural disasters. Hazard exposure, protective works, preparedness, and response capacity are considered together.",
  "39": "The share of land under effective habitat protection. The condition and management of protected areas matter alongside their acreage.",
  "40": "How much opportunity people have to improve their economic position across their lives and between generations. Education, regional opportunity, and access to work all contribute.",
  "41": "The number of people without stable housing per 10,000 residents. It includes sheltered and unsheltered homelessness under each country's consistent definition.",
  "42": "The share of households that cannot reliably obtain enough nutritious food. Food prices, household income, benefits, and local access shape the rate.",
  "43": "The strength of trust and cooperation across social groups and communities. Inclusion, segregation, unrest, and regional differences influence it.",
  "44": "Participation in community life outside elections, including volunteering, local groups, associations, and civic activity.",
  "45": "How equally people of different genders can access work, earnings, education, safety, and public representation.",
  "46": "How successfully newcomers can participate in work and community life. Language access, housing, legal protection, opportunity, and belonging all matter.",
  "47": "How easily the public can understand and scrutinize government. Disclosure, audits, information access, and publication of budgets and decisions contribute to it.",
  "48": "The risk that public power is used for private gain. Procurement problems, audit findings, enforcement, and verified cases inform the score; improved detection can initially reveal more misconduct.",
  "49": "Public confidence that institutions are competent, fair, and credible. Services, scandals, fiscal management, and rights protections shape it over time.",
  "50": "The strength of due process, privacy, protest, and speech protections in both law and practice.",
  "51": "The share of eligible voters who participate in an election. Registration, ballot access, competitiveness, and public engagement affect turnout.",
  "52": "The ability of journalists and news organizations to report independently and safely, without censorship or improper control.",
  "53": "How exposed the public is to false or deliberately misleading information. Media literacy, polarization, trust, and distribution channels all influence the score.",
  "54": "The annual change in population after births, deaths, international migration, and movement between regions are counted.",
  "55": "The average number of children a woman would have under current age-specific birth rates. Family costs, housing, work, care access, and household formation can influence it.",
  "56": "The number of children and older residents for every 100 working-age residents. It indicates the demographic load carried by the potential workforce.",
  "57": "The armed forces' ability to deploy and sustain capable units. Training, personnel, equipment availability, maintenance, logistics, and funding all matter.",
  "58": "The country's exposure to fuel-supply disruption. Import dependence, reserves, source diversity, storage, and emergency supply determine the risk band.",
};

const OWNER_LABELS: Readonly<Record<string, string>> = {
  labor: "Labor market",
  households: "Household finances",
  economy: "National economy",
  prices: "Consumer prices",
  trade: "Trade and industry",
  ledger: "National Treasury",
  schools: "Schools and secondary education",
  higher_education: "Higher education",
  research: "Research system",
  health: "Health system",
  cohorts: "Population and demographics",
  care: "Care services",
  public_health: "Public health system",
  housing: "Housing system",
  roads: "Road network",
  transit: "Public transport",
  communications: "Communications infrastructure",
  water: "Water services",
  grid: "Electricity grid",
  justice: "Justice system",
  environment: "Environmental conditions",
  energy: "Energy system",
  resilience: "Emergency resilience",
  land: "Land and conservation",
  society: "Social conditions",
  governance: "Public administration",
  perception: "Public opinion",
  rights: "Rights and liberties",
  elections: "Election system",
  media: "Media environment",
  defense: "Defense system",
};

const AGGREGATION_LABELS: Readonly<Record<string, string>> = {
  ratio: "Built from the underlying people or events, so larger regions carry their proper weight.",
  recompute: "Recalculated from the underlying national and regional records.",
  national: "Measured directly at the national level rather than averaged from regions.",
  weighted: "Combined using the population and service weights relevant to this measure.",
  asset_weighted: "Combined according to the amount of infrastructure in each region.",
  population_weighted: "Combined according to each region's population.",
  hazard_adjusted: "Combined after accounting for each region's exposure to hazards.",
  area_weighted: "Combined according to each region's land area.",
  eligible_weighted: "Combined according to the population eligible for this measure.",
};

export function playerMetricDescription(metric: PrimaryMetricDefinition): string {
  return PLAYER_DESCRIPTIONS[metric.id] ?? metric.description;
}

export function metricOwnerLabel(owner: string): string {
  return OWNER_LABELS[owner] ?? owner.replaceAll("_", " ");
}

export function metricRefreshLabel(refresh: string): string {
  switch (refresh) {
    case "1":
      return "Every turn";
    case "12":
      return "Every quarter (12 turns)";
    case "48":
      return "Every year (48 turns)";
    case "cohort":
      return "When a tracked cohort reaches its reporting point";
    case "election":
      return "After each election";
    default:
      return "When new source data is available";
  }
}

export function metricAggregationLabel(aggregation: string): string {
  return AGGREGATION_LABELS[aggregation] ?? "Combined from the relevant underlying records.";
}

export function metricDataBasis(status: ObservationStatus, nationalRollup: boolean): string {
  if (nationalRollup) return "Current regional observations combined into a national figure";
  switch (status) {
    case "observed":
      return "Era-adjusted historical observation";
    case "derived":
      return "Calculated from related game records";
    case "proxy":
      return "Game-calibrated estimate";
    case "unavailable":
      return "No verified observation available";
  }
}

export function metricQualityLabel(status: ObservationStatus): string {
  switch (status) {
    case "observed":
      return "Sourced baseline";
    case "derived":
      return "Derived from owned data";
    case "proxy":
      return "Provisional estimate";
    case "unavailable":
      return "Unavailable";
  }
}

export function metricQualityExplanation(status: ObservationStatus): string {
  switch (status) {
    case "observed":
      return "This opening value comes from era-adjusted historical game data. Its responsible system updates it during play.";
    case "derived":
      return "This value is calculated from underlying game systems rather than written directly by a law or action.";
    case "proxy":
      return "This is a clearly labeled game-calibrated estimate until a stronger owned observation is available.";
    case "unavailable":
      return "The responsible system has not yet produced enough data to report this value.";
  }
}

/** Test seam ensuring every frozen v2 primary has authored player copy. */
export const playerMetricDescriptionIds = Object.freeze(Object.keys(PLAYER_DESCRIPTIONS));
