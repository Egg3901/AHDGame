import type { Layer1Config } from "./stateDemographics";
import { shiftRegionPositions, type PositionsBlock } from "./regionalPositions";

/**
 * Deep South (AL MS SC LA GA AR), 1991. White presidential Republicanism is now the
 * default and Gingrich-era tax and defense conservatism overlays what is left of rural
 * populism. The state means still look competitive only because a quarter to a third of
 * the electorate is Black, so the white value sits well right of them.
 */
const DEEP_SOUTH_1991: PositionsBlock = {
  race: {
    white: { economicLean: 0.9, socialLean: 1.2 }, // presidential Republicanism is the white default; the social axis has barely moved
    black: { economicLean: -4.9, socialLean: -1.6 }, // a third of the electorate in MS and SC, and the most Democratic bloc in the country
    hispanic: { economicLean: -3.6, socialLean: -1.6 }, // a small Gulf Coast and Delta population
  },
  education: {
    no_college: { economicLean: 2.3, socialLean: 2 }, // already Republican here; the northern Reagan Democrat lag does not apply
    college: { economicLean: -2.5, socialLean: -2.7 }, // the Atlanta and research-corridor professional class
    graduate: { economicLean: -3.4, socialLean: -3.9 }, // a nationally rather than regionally coded stratum
  },
  wealth: {
    low: { economicLean: -3.7, socialLean: -0.1 }, // the poorest electorate in the country, disproportionately Black
    middle: { economicLean: -0.5, socialLean: 0.8 }, // small-metro chamber conservatism plus church attendance
    high: { economicLean: 1.5, socialLean: 0.7 }, // Sunbelt developer, banking and energy capital
  },
  ideology: {
    evangelicals: { economicLean: 2.2, socialLean: 3.7 }, // Christian Coalition high tide, fully fused with the Republican coalition
    patriots: { economicLean: 2.2, socialLean: 2.9 }, // Gulf War patriotism over the country's densest base network
    gunowners: { economicLean: 2, socialLean: 2.5 }, // the assault-weapons fight is about to make this an organized bloc
    progressives: { economicLean: -4.9, socialLean: -4.9 }, // the biracial civil-rights coalition, a regional minority
    environmentalists: { economicLean: -4.1, socialLean: -3.9 }, // coastal and river politics without a partisan home
    libertarians: { economicLean: 4, socialLean: 0.7 }, // anti-regulation business conservatism
  },
};

/**
 * Border and peripheral South (VA NC TN FL TX OK KY MO WV MD DE), 1991. A region
 * splitting in two: TX, OK and VA continue right while Appalachia has NOT yet flipped.
 * Clinton takes WV by 16 and KY by 4 on economics that are still New Deal.
 */
const BORDER_1991: PositionsBlock = {
  race: {
    white: { economicLean: 0.6, socialLean: 0.9 }, // TX, OK and VA keep moving right while Appalachia stays economically Democratic
    black: { economicLean: -5, socialLean: -1.7 }, // urban Black electorates from Baltimore to Memphis
    hispanic: { economicLean: -3.6, socialLean: -1.7 }, // south Texas: Democratic, Catholic and socially traditional
  },
  education: {
    no_college: { economicLean: 1.8, socialLean: 1.6 }, // WV and KY non-college whites are still economically Democratic in 1992
    college: { economicLean: -2.5, socialLean: -2.7 }, // the Northern Virginia and Research Triangle professional class
    graduate: { economicLean: -3.3, socialLean: -4 }, // federal, university and defense-lab payrolls
  },
  wealth: {
    low: { economicLean: -3.8, socialLean: -0.4 }, // coalfield and Ozark poverty, the last New Deal bloc in the region
    middle: { economicLean: -0.4, socialLean: 0.4 }, // county-seat merchants and the military middle class
    high: { economicLean: 1.5, socialLean: 0.5 }, // energy, tobacco and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 2.4, socialLean: 3.9 }, // Southern Baptist mobilization at its organizational peak
    patriots: { economicLean: 2.4, socialLean: 2.9 }, // Norfolk, Fort Bragg and the Gulf War homecoming
    gunowners: { economicLean: 2.4, socialLean: 2.5 }, // coalfield and Piedmont gun culture, newly partisan
    progressives: { economicLean: -5, socialLean: -5 }, // civil-rights and labor organizations, a shrinking minority
    environmentalists: { economicLean: -4.2, socialLean: -4 }, // strip-mining and river politics
    libertarians: { economicLean: 4.3, socialLean: 0.4 }, // anti-tax business conservatism
  },
};

/**
 * Industrial Northeast (MA RI CT NY NJ PA), 1991. Deindustrialization has broken union
 * density without producing an economic left turn, while the Catholic ethnic bloc's
 * social conservatism is finally eroding. Perot collects the anti-incumbent anger.
 */
const MID_ATLANTIC_1991: PositionsBlock = {
  race: {
    white: { economicLean: 0.6, socialLean: -0.6 }, // the Yankee inversion reaches the Mid-Atlantic: net socially liberal for the first time
    black: { economicLean: -4.8, socialLean: -2 }, // the Democratic coalition's urban core
    hispanic: { economicLean: -3.6, socialLean: -1.8 }, // Puerto Rican and Dominican New York and New Jersey
  },
  education: {
    no_college: { economicLean: 2, socialLean: 0.6 }, // not yet the 2016 inversion: college is left, but non-college is not a right bloc
    college: { economicLean: -1.9, socialLean: -2.7 }, // the suburban professional class, now reliably Democratic
    graduate: { economicLean: -3.5, socialLean: -4.3 }, // the academic and media professions, the era's liberal pole
  },
  wealth: {
    low: { economicLean: -3.7, socialLean: -1.1 }, // the post-industrial urban poor
    middle: { economicLean: 0, socialLean: -0.6 }, // post-industrial suburban professionals, not chamber-of-commerce traditionalists
    high: { economicLean: 2.3, socialLean: -0.9 }, // finance capital: economically right, socially indifferent
  },
  ideology: {
    evangelicals: { economicLean: 3.1, socialLean: 3.9 }, // a smaller share and less likely to define a state mean
    patriots: { economicLean: 3.1, socialLean: 3.1 }, // ethnic Catholic Cold War patriotism after the Cold War
    gunowners: { economicLean: 3.1, socialLean: 2.7 }, // sporting clubs against an urban crime politics
    progressives: { economicLean: -5, socialLean: -5 }, // the reform-Democratic and public-employee left
    environmentalists: { economicLean: -4.3, socialLean: -4.3 }, // a mass constituency by now, and Democratic
    libertarians: { economicLean: 4.9, socialLean: -0.9 }, // a thin anti-tax minority
  },
};

/**
 * Great Lakes (OH IN IL MI WI MN IA), 1991. Union economics still bind enough of the
 * region for Clinton; the culture war here is evangelical against everyone else, not
 * college against non-college.
 */
const GREAT_LAKES_1991: PositionsBlock = {
  race: {
    white: { economicLean: 0.9, socialLean: -0.4 }, // union economics still bind IL, MI, WI and MN enough for Clinton; Indiana stays out
    black: { economicLean: -5, socialLean: -2 }, // Detroit, Cleveland, Chicago and Milwaukee
    hispanic: { economicLean: -3.6, socialLean: -1.8 }, // Chicago and the northern Indiana steel towns
  },
  education: {
    no_college: { economicLean: 2.7, socialLean: 1.2 }, // the group Perot takes 20% from: left of the region on economics, right of it on culture
    college: { economicLean: -2, socialLean: -2.9 }, // the suburban professional tier, socially liberalizing
    graduate: { economicLean: -3.2, socialLean: -4.3 }, // Big Ten faculty and the research economy
  },
  wealth: {
    low: { economicLean: -3.7, socialLean: -1.2 }, // the plant-closure electorate of the 1980s
    middle: { economicLean: 0.3, socialLean: -0.4 }, // the union homeowner turned suburban fiscal conservative
    high: { economicLean: 2.1, socialLean: -0.7 }, // manufacturing capital in retreat
  },
  ideology: {
    evangelicals: { economicLean: 3, socialLean: 3.6 }, // a mobilized bloc across the rural tier, not yet dominant
    patriots: { economicLean: 2.8, socialLean: 2.8 }, // Legion halls and a heavily drafted generation
    gunowners: { economicLean: 2.8, socialLean: 2.4 }, // the northern hunting belt, now politically organized
    progressives: { economicLean: -4.9, socialLean: -5 }, // the DFL and campus left
    environmentalists: { economicLean: -3.9, socialLean: -4.2 }, // Great Lakes cleanup politics
    libertarians: { economicLean: 4.8, socialLean: -0.5 }, // small-business anti-regulation opinion
  },
};

/**
 * Plains (ND SD NE KS), 1991. The 1982-86 farm crisis left durable anti-Washington
 * economics rather than agrarian populism. Perot runs strong, which is anti-system
 * rather than a left turn.
 */
const PLAINS_1991: PositionsBlock = {
  race: {
    white: { economicLean: 3.1, socialLean: 1.2 }, // the Republican floor, hardened by the farm crisis into anti-Washington economics
    black: { economicLean: -4.4, socialLean: -1.8 }, // small urban populations in Omaha, Wichita and Sioux Falls
    hispanic: { economicLean: -3, socialLean: -1.4 }, // meatpacking labor arriving in the small towns
  },
  education: {
    no_college: { economicLean: 3.3, socialLean: 1.6 }, // no union structure to pull the farm and small-town workforce left
    college: { economicLean: -1.3, socialLean: -2.3 }, // land-grant graduates in agriculture and county business
    graduate: { economicLean: -2.6, socialLean: -3.7 }, // extension and university staff
  },
  wealth: {
    low: { economicLean: -2.8, socialLean: -0.6 }, // farm-crisis debt and small-town decline
    middle: { economicLean: 1.3, socialLean: 0.8 }, // the merchant and farm-owner middle class
    high: { economicLean: 2.7, socialLean: 0.3 }, // grain, land and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 3.9, socialLean: 4.4 }, // Christian Coalition country alongside the South
    patriots: { economicLean: 3.7, socialLean: 3.4 }, // missile fields and airbases
    gunowners: { economicLean: 3.7, socialLean: 3 }, // universal rural ownership fused with national gun politics
    progressives: { economicLean: -4.4, socialLean: -4.6 }, // the surviving Farmers Union left
    environmentalists: { economicLean: -3.4, socialLean: -3.6 }, // soil and aquifer conservation
    libertarians: { economicLean: 5, socialLean: 0.3 }, // anti-federal constitutionalism
  },
};

/**
 * Mountain West and Alaska (MT ID WY CO UT NV AZ NM AK), 1991. Peak economic right:
 * public-lands, gun and property-rights politics fully fused. Front Range and Santa Fe
 * exceptions exist but are not yet regional.
 */
const MOUNTAIN_1991: PositionsBlock = {
  race: {
    white: { economicLean: 2.8, socialLean: 0.7 }, // public lands, guns and property rights fully fused into the era's economic right pole
    black: { economicLean: -4.5, socialLean: -1.8 }, // small urban populations in Denver, Phoenix and Las Vegas
    hispanic: { economicLean: -2.9, socialLean: -1 }, // New Mexico Hispanos and Arizona and Nevada service labor
  },
  education: {
    no_college: { economicLean: 2.7, socialLean: 1.1 }, // extraction and service labor with the unions mostly gone
    college: { economicLean: -1.7, socialLean: -2.5 }, // the professional tier of Denver, Salt Lake, Phoenix and Boise
    graduate: { economicLean: -2.9, socialLean: -3.8 }, // the national laboratories and state universities
  },
  wealth: {
    low: { economicLean: -3.2, socialLean: -0.7 }, // reservation and service-sector poverty
    middle: { economicLean: 0.9, socialLean: 0.3 }, // suburban fiscal conservatism plus Amendment 2 era social politics
    high: { economicLean: 2.5, socialLean: 0.1 }, // energy, mining and real-estate capital
  },
  ideology: {
    evangelicals: { economicLean: 3.2, socialLean: 3.8 }, // the LDS corridor plus Rocky Mountain fundamentalism
    patriots: { economicLean: 3.2, socialLean: 3.2 }, // the defense installations and a heavy veteran share
    gunowners: { economicLean: 3.4, socialLean: 2.8 }, // the region where federal firearms politics is most explosive
    progressives: { economicLean: -4.8, socialLean: -4.9 }, // a Denver, Boulder and Santa Fe minority
    environmentalists: { economicLean: -4, socialLean: -4.1 }, // wilderness and water politics against the property-rights movement
    libertarians: { economicLean: 4.7, socialLean: 0 }, // the movement's geographic heartland
  },
};

/**
 * Pacific coast (CA OR WA), 1991. The defense drawdown pushes economics left off the
 * 1979 tax-revolt peak while social liberalism deepens: the first era a regional white
 * group goes net socially liberal.
 */
const PACIFIC_1991: PositionsBlock = {
  race: {
    white: { economicLean: 1.6, socialLean: -1.8 }, // the defense drawdown moves economics left while social liberalism deepens
    black: { economicLean: -4.5, socialLean: -2.3 }, // Los Angeles, Oakland and Seattle after the 1992 unrest
    hispanic: { economicLean: -3.3, socialLean: -2.1 }, // a fast-growing electorate, still under-registered before Proposition 187
  },
  education: {
    no_college: { economicLean: 2.5, socialLean: -0.3 }, // aerospace layoffs and inland timber, economically squeezed
    college: { economicLean: -1.9, socialLean: -3.3 }, // the coastal professional class, now reliably Democratic
    graduate: { economicLean: -3.5, socialLean: -4.7 }, // the University of California system and the software economy
  },
  wealth: {
    low: { economicLean: -3.4, socialLean: -1.4 }, // inner-city and farmworker poverty
    middle: { economicLean: 0.9, socialLean: -1.7 }, // post-industrial suburban professionals rather than tax-revolt homeowners
    high: { economicLean: 2.7, socialLean: -1.7 }, // entertainment, aerospace and early technology capital
  },
  ideology: {
    evangelicals: { economicLean: 3.4, socialLean: 3.4 }, // Orange County and Central Valley congregations against a liberal coast
    patriots: { economicLean: 3.4, socialLean: 2.4 }, // a shrinking defense economy
    gunowners: { economicLean: 3.4, socialLean: 2 }, // inland gun culture against coastal restriction
    progressives: { economicLean: -5, socialLean: -5 }, // the environmental and civil-rights left at its strongest
    environmentalists: { economicLean: -4.4, socialLean: -4.6 }, // the coast's defining political identity outside the cities
    libertarians: { economicLean: 4.9, socialLean: -1.5 }, // technology-boom individualism
  },
};

/**
 * Yankee New England (VT NH ME), 1991. The inversion is on. Vermont is now the most
 * socially liberal white electorate in the country and Maine gives Perot 30%, while
 * New Hampshire's anti-tax identity survives the change around it.
 */
const YANKEE_1991: PositionsBlock = {
  race: {
    white: { economicLean: -0.3, socialLean: -0.9 }, // the completed Yankee inversion: VT, ME and the region's whites are now socially liberal
    black: { economicLean: -4.4, socialLean: -1.8 }, // a very small population concentrated in the mill cities
    hispanic: { economicLean: -3.4, socialLean: -1.8 }, // small and concentrated in the same mill cities
  },
  education: {
    no_college: { economicLean: 1.3, socialLean: 0.3 }, // mill and quarry labor without a union structure, Perot's best audience
    college: { economicLean: -2.5, socialLean: -2.7 }, // the region's professional class, the most socially liberal in the file
    graduate: { economicLean: -4, socialLean: -4.2 }, // the New England college faculties
  },
  wealth: {
    low: { economicLean: -3.7, socialLean: -1 }, // rural hill poverty
    middle: { economicLean: -0.1, socialLean: -0.9 }, // the anti-tax small-town middle class, still New Hampshire's spine
    high: { economicLean: 2.1, socialLean: -1.1 }, // Boston-adjacent finance and second-home capital
  },
  ideology: {
    evangelicals: { economicLean: 2.2, socialLean: 3.7 }, // a small old-stock Protestant remnant
    patriots: { economicLean: 2.4, socialLean: 2.9 }, // town veterans' posts
    gunowners: { economicLean: 2.6, socialLean: 2.5 }, // deer season as civic ritual, only lightly partisan
    progressives: { economicLean: -5, socialLean: -4.9 }, // the Vermont left that will produce Dean and Sanders
    environmentalists: { economicLean: -4.7, socialLean: -4.2 }, // land-use and forest politics, electorally decisive
    libertarians: { economicLean: 4.4, socialLean: -1 }, // Live Free or Die constitutionalism
  },
};

/**
 * Hawaii, 1991. The ILWU legacy machine still sets the state's economics; a safe
 * Democratic state on both axes.
 */
const ISLANDS_1991: PositionsBlock = {
  race: {
    white: { economicLean: -3.1, socialLean: -0.9 }, // military and mainland-transplant households inside a Democratic state
    black: { economicLean: -4.8, socialLean: -2.1 }, // a small military-linked population
    hispanic: { economicLean: -3.6, socialLean: -1.9 }, // Filipino and Puerto Rican plantation descendants
  },
  education: {
    no_college: { economicLean: -0.9, socialLean: 0 }, // the hotel and dock workforce, the machine's base
    college: { economicLean: -3.2, socialLean: -2.9 }, // state civil service and the university
    graduate: { economicLean: -4.3, socialLean: -4.2 }, // a small professional stratum
  },
  wealth: {
    low: { economicLean: -4.2, socialLean: -1.4 }, // service-sector and camp-housing poverty
    middle: { economicLean: -2.5, socialLean: -1 }, // the civil-service and small-business class the ILWU machine built
    high: { economicLean: 0.6, socialLean: -1.3 }, // tourism and Japanese investment capital
  },
  ideology: {
    evangelicals: { economicLean: 1.3, socialLean: 3.3 }, // missionary-descended congregations, a minority
    patriots: { economicLean: 1.1, socialLean: 2.3 }, // Pearl Harbor and a heavy military presence
    gunowners: { economicLean: 1.1, socialLean: 1.9 }, // outer-island hunting, a minor identity
    progressives: { economicLean: -5, socialLean: -5 }, // the ILWU political machine
    environmentalists: { economicLean: -4.8, socialLean: -4.2 }, // reef and land conservation against resort development
    libertarians: { economicLean: 3.7, socialLean: -1.2 }, // small-trader independence, marginal
  },
};

/**
 * District of Columbia, 1991. Clinton takes it by 80 points. The economic left pole
 * of the series and the largest Black electorate share in the country.
 */
const CAPITAL_1991: PositionsBlock = {
  race: {
    white: { economicLean: -5, socialLean: -2.6 }, // federal professionals and gentrifiers in a Black-majority city
    black: { economicLean: -5, socialLean: -1.7 }, // the most Democratic electorate in the country
    hispanic: { economicLean: -4.9, socialLean: -2.1 }, // a growing Salvadoran population in Columbia Heights
  },
  education: {
    no_college: { economicLean: -4.8, socialLean: -0.7 }, // the federal service and hospitality workforce
    college: { economicLean: -5, socialLean: -4 }, // the career civil service
    graduate: { economicLean: -5, socialLean: -5 }, // the agency, think-tank and law professional class
  },
  wealth: {
    low: { economicLean: -5, socialLean: -1.2 }, // concentrated urban poverty in the crack-epidemic years
    middle: { economicLean: -5, socialLean: -2.1 }, // the federal grade-scale middle class
    high: { economicLean: -3, socialLean: -2.2 }, // law, lobbying and federal contracting
  },
  ideology: {
    evangelicals: { economicLean: -2.8, socialLean: 2.6 }, // Black Baptist congregations: socially traditional, economically left
    patriots: { economicLean: -2.8, socialLean: 1.5 }, // the military and veterans' bureaucracy
    gunowners: { economicLean: -2.8, socialLean: 1.2 }, // marginal under the handgun ban
    progressives: { economicLean: -5, socialLean: -5 }, // the city's civil-rights and public-employee left
    environmentalists: { economicLean: -5, socialLean: -4.7 }, // the federal environmental bureaucracy's home
    libertarians: { economicLean: 1.3, socialLean: -1.6 }, // a think-tank minority
  },
};

/**
 * 1991-era US state census profiles — independently authored, anchored to the
 * 1990 Census (not derived from the 2019 data in `stateCensusData.ts`).
 *
 * Used both for the region-page census display and for seed-time Layer-1
 * demographic generation under the `1991-default` preset.
 *
 * Methodology: each state was hand-authored from 1990 Census tabulations and
 * period political history rather than scaled from 2019 values.
 *
 * National reference points (1990 Census):
 * - Race: non-Hispanic White ~76-80%, Black ~12%, Hispanic ~9%, Asian ~3%.
 * - Education: bachelor's degree or higher ~20% of adults (graduate ~7%).
 * - Median age ~32.8 — markedly younger than 2019; seniors a smaller share.
 * - Ideology coding reflects the immediate post-Cold-War moment: evangelical
 *   mobilization at high tide across the South (Moral Majority aftermath),
 *   Gulf War patriotism elevated, environmentalists a modest post-Earth-Day-
 *   1990 presence, progressives far smaller than 2019, Reagan-Democrat
 *   blue-collar identity strong in the industrial Midwest, California still
 *   purple-ish (it voted GOP in every presidential race 1968-1988), and the
 *   Deep South's partisan realignment still in progress (Democratic
 *   governors/legislatures atop culturally conservative electorates).
 * - Ideology values are independent group shares and do NOT sum to 100;
 *   the scale conventions match the 2019 file.
 */
export const stateCensusData1991: Record<string, Layer1Config> = {
  // ---- Northeast ----
  CT: {
    race: { white: 84, black: 8, hispanic: 6, asian: 2, other: 0 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 18, middle: 54, high: 28 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 10,
      libertarians: 4,
      progressives: 11,
      patriots: 7,
      gunowners: 6,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1991, 0.9, 0.7), // insurance capital and the Gold Coast against Hartford and Bridgeport
  },
  DE: {
    race: { white: 79, black: 17, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 4,
      progressives: 9,
      patriots: 8,
      gunowners: 8,
    },
    positions: shiftRegionPositions(BORDER_1991, -0.3, -1.3), // du Pont industry with a Mid-Atlantic social profile
  },
  MA: {
    race: { white: 88, black: 5, hispanic: 5, asian: 2, other: 0 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 22, middle: 53, high: 25 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 4,
      environmentalists: 11,
      libertarians: 4,
      progressives: 14,
      patriots: 6,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1991, -1.7, -0.7), // Clinton by 24
  },
  MD: {
    race: { white: 69, black: 25, hispanic: 3, asian: 3, other: 0 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 20, middle: 55, high: 25 },
    age: { young: 28, mid: 28, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 9,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 7,
    },
    positions: shiftRegionPositions(BORDER_1991, -1, -1.3), // the federal workforce and the Baltimore-Washington suburbs
  },
  ME: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 7,
      environmentalists: 11,
      libertarians: 7,
      progressives: 8,
      patriots: 8,
      gunowners: 12,
    },
    positions: YANKEE_1991,
  },
  NH: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 18, middle: 60, high: 22 },
    age: { young: 27, mid: 28, mature: 27, senior: 18 },
    ideology: {
      evangelicals: 7,
      environmentalists: 9,
      libertarians: 11,
      progressives: 7,
      patriots: 9,
      gunowners: 12,
    },
    positions: shiftRegionPositions(YANKEE_1991, 2, 0.3), // the anti-tax outlier persists as the rest of New England moves left
  },
  NJ: {
    race: { white: 74, black: 13, hispanic: 10, asian: 3, other: 0 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 20, middle: 53, high: 27 },
    age: { young: 27, mid: 27, mature: 27, senior: 19 },
    ideology: {
      evangelicals: 6,
      environmentalists: 9,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 6,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1991, 1.3, 0.7), // suburban New Jersey, Clinton by 3
  },
  NY: {
    race: { white: 69, black: 14, hispanic: 12, asian: 4, other: 1 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 7,
      environmentalists: 9,
      libertarians: 4,
      progressives: 13,
      patriots: 7,
      gunowners: 7,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1991, -0.8, 0), // Clinton by 19: the Rockefeller Republican tradition is finished
  },
  PA: {
    race: { white: 88, black: 9, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 25, mid: 25, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 13,
      environmentalists: 6,
      libertarians: 5,
      progressives: 7,
      patriots: 12,
      gunowners: 15,
    },
    positions: MID_ATLANTIC_1991,
  },
  RI: {
    race: { white: 89, black: 4, hispanic: 5, asian: 2, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 55, high: 19 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 4,
      environmentalists: 9,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1991, -2.2, -0.2), // an economically left, socially only moderately liberal union Catholic bloc
  },
  VT: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 7,
      progressives: 12,
      patriots: 6,
      gunowners: 10,
    },
    positions: shiftRegionPositions(YANKEE_1991, -1.2, -0.9), // the most socially liberal white electorate in the country
  },

  // ---- South ----
  AL: {
    race: { white: 73, black: 25, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 36, middle: 52, high: 12 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 44,
      environmentalists: 1,
      libertarians: 3,
      progressives: 3,
      patriots: 19,
      gunowners: 24,
    },
    positions: DEEP_SOUTH_1991,
  },
  AR: {
    race: { white: 82, black: 16, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 87, college: 9, graduate: 4 },
    wealth: { low: 38, middle: 51, high: 11 },
    age: { young: 27, mid: 25, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 42,
      environmentalists: 1,
      libertarians: 4,
      progressives: 3,
      patriots: 18,
      gunowners: 23,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1991, -2.7, -0.8), // Clinton's home state: the two-party margin is 20 points of favorite son
  },
  FL: {
    race: { white: 73, black: 13, hispanic: 12, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 22, mid: 23, mature: 26, senior: 29 },
    ideology: {
      evangelicals: 18,
      environmentalists: 6,
      libertarians: 6,
      progressives: 6,
      patriots: 13,
      gunowners: 14,
    },
    positions: shiftRegionPositions(BORDER_1991, 0.9, 0), // the I-4 corridor and northern retirees
  },
  GA: {
    race: { white: 70, black: 27, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 30, mid: 28, mature: 25, senior: 17 },
    ideology: {
      evangelicals: 36,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 16,
      gunowners: 19,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1991, -0.4, -0.1), // Clinton by 0.7, over a white electorate that is already Republican
  },
  KY: {
    race: { white: 91, black: 7, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 36, middle: 52, high: 12 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 32,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 15,
      gunowners: 21,
    },
    positions: BORDER_1991,
  },
  LA: {
    race: { white: 66, black: 31, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 38, middle: 50, high: 12 },
    age: { young: 30, mid: 27, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 34,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 16,
      gunowners: 19,
    },
    positions: DEEP_SOUTH_1991,
  },
  MS: {
    race: { white: 63, black: 35, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 42, middle: 48, high: 10 },
    age: { young: 30, mid: 26, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 44,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 17,
      gunowners: 21,
    },
    positions: DEEP_SOUTH_1991,
  },
  NC: {
    race: { white: 75, black: 22, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 55, high: 15 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 34,
      environmentalists: 3,
      libertarians: 4,
      progressives: 5,
      patriots: 15,
      gunowners: 18,
    },
    positions: BORDER_1991,
  },
  SC: {
    race: { white: 68, black: 30, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 33, middle: 53, high: 14 },
    age: { young: 29, mid: 27, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 17,
      gunowners: 20,
    },
    positions: DEEP_SOUTH_1991,
  },
  TN: {
    race: { white: 82, black: 16, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 33, middle: 53, high: 14 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 16,
      gunowners: 21,
    },
    positions: shiftRegionPositions(BORDER_1991, -0.3, -0.4), // Gore on the ticket blunts the drift
  },
  VA: {
    race: { white: 76, black: 19, hispanic: 3, asian: 2, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 24, middle: 55, high: 21 },
    age: { young: 29, mid: 28, mature: 26, senior: 17 },
    ideology: {
      evangelicals: 22,
      environmentalists: 5,
      libertarians: 5,
      progressives: 7,
      patriots: 14,
      gunowners: 14,
    },
    positions: shiftRegionPositions(BORDER_1991, 1.3, 0.7), // not yet a Northern Virginia state
  },
  WV: {
    race: { white: 96, black: 3, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 88, college: 8, graduate: 4 },
    wealth: { low: 42, middle: 48, high: 10 },
    age: { young: 25, mid: 24, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 15,
      gunowners: 22,
    },
    positions: shiftRegionPositions(BORDER_1991, -3.5, 0.1), // Clinton by 16: the file's most extreme economic-left, socially traditional cell
  },

  // ---- Midwest ----
  IA: {
    race: { white: 95, black: 2, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 26, middle: 60, high: 14 },
    age: { young: 26, mid: 25, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 17,
      environmentalists: 5,
      libertarians: 6,
      progressives: 6,
      patriots: 12,
      gunowners: 14,
    },
    positions: GREAT_LAKES_1991,
  },
  IL: {
    race: { white: 75, black: 15, hispanic: 8, asian: 2, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 12,
      environmentalists: 7,
      libertarians: 5,
      progressives: 10,
      patriots: 9,
      gunowners: 9,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1991, -1.5, 0), // Chicago's machine plus collar-county suburbs moving left
  },
  IN: {
    race: { white: 89, black: 8, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 6,
      progressives: 5,
      patriots: 14,
      gunowners: 17,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1991, 0.8, 1.2), // the Great Lakes state that stays Republican through 1992
  },
  KS: {
    race: { white: 88, black: 6, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 8,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
    positions: PLAINS_1991,
  },
  MI: {
    race: { white: 82, black: 14, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 28, middle: 55, high: 17 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 15,
      environmentalists: 6,
      libertarians: 5,
      progressives: 8,
      patriots: 11,
      gunowners: 14,
    },
    positions: GREAT_LAKES_1991,
  },
  MN: {
    race: { white: 93, black: 2, hispanic: 1, asian: 2, other: 2 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 59, high: 17 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 12,
      environmentalists: 9,
      libertarians: 5,
      progressives: 11,
      patriots: 8,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1991, -1.6, -0.6), // the DFL over a Ventura-era unmoored center
  },
  MO: {
    race: { white: 87, black: 11, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 55, high: 15 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 6,
      progressives: 6,
      patriots: 13,
      gunowners: 16,
    },
    positions: shiftRegionPositions(BORDER_1991, 0, -0.6), // the bellwether, Clinton by 13
  },
  ND: {
    race: { white: 94, black: 1, hispanic: 1, asian: 1, other: 3 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 28, mid: 25, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 20,
      environmentalists: 3,
      libertarians: 8,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: PLAINS_1991,
  },
  NE: {
    race: { white: 93, black: 4, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 26, middle: 59, high: 15 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 21,
      environmentalists: 3,
      libertarians: 7,
      progressives: 4,
      patriots: 14,
      gunowners: 16,
    },
    positions: PLAINS_1991,
  },
  OH: {
    race: { white: 87, black: 11, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 6,
      progressives: 7,
      patriots: 12,
      gunowners: 15,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1991, 0.3, 0.9), // the manufacturing swing state, Clinton by 2
  },
  SD: {
    race: { white: 91, black: 1, hispanic: 1, asian: 0, other: 7 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 32, middle: 55, high: 13 },
    age: { young: 27, mid: 25, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 21,
      environmentalists: 3,
      libertarians: 8,
      progressives: 4,
      patriots: 14,
      gunowners: 18,
    },
    positions: shiftRegionPositions(PLAINS_1991, -1, -0.2), // a competitive Democratic delegation over a Republican floor
  },
  WI: {
    race: { white: 91, black: 5, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 25, middle: 59, high: 16 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 13,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 10,
      gunowners: 14,
    },
    positions: GREAT_LAKES_1991,
  },

  // ---- Southwest ----
  AZ: {
    race: { white: 71, black: 3, hispanic: 19, asian: 2, other: 5 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 28, middle: 55, high: 17 },
    age: { young: 28, mid: 26, mature: 24, senior: 22 },
    ideology: {
      evangelicals: 15,
      environmentalists: 5,
      libertarians: 10,
      progressives: 5,
      patriots: 12,
      gunowners: 14,
    },
    positions: MOUNTAIN_1991,
  },
  NM: {
    race: { white: 50, black: 2, hispanic: 38, asian: 1, other: 9 },
    education: { no_college: 80, college: 13, graduate: 7 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 6,
      progressives: 9,
      patriots: 10,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, -0.6, -0.7), // the Hispano north puts the state mean well left of its white value
  },
  OK: {
    race: { white: 81, black: 7, hispanic: 3, asian: 1, other: 8 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 34, middle: 53, high: 13 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 6,
      progressives: 3,
      patriots: 16,
      gunowners: 20,
    },
    positions: shiftRegionPositions(BORDER_1991, 1.4, 0.4), // the oil bust did not move the Bible Belt
  },
  TX: {
    race: { white: 60, black: 12, hispanic: 26, asian: 2, other: 0 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 31, mid: 28, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 28,
      environmentalists: 3,
      libertarians: 7,
      progressives: 5,
      patriots: 15,
      gunowners: 17,
    },
    positions: shiftRegionPositions(BORDER_1991, 0.8, 0.4), // Bush's home state
  },

  // ---- West ----
  AK: {
    race: { white: 74, black: 4, hispanic: 3, asian: 4, other: 15 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 22, middle: 57, high: 21 },
    age: { young: 32, mid: 31, mature: 25, senior: 12 },
    ideology: {
      evangelicals: 14,
      environmentalists: 6,
      libertarians: 14,
      progressives: 4,
      patriots: 15,
      gunowners: 20,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, 0.8, 0.4), // Perot's best state at 28.4%: anti-establishment, not moderate
  },
  CA: {
    race: { white: 57, black: 7, hispanic: 26, asian: 9, other: 1 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 31, mid: 28, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 12,
      environmentalists: 11,
      libertarians: 6,
      progressives: 11,
      patriots: 8,
      gunowners: 8,
    },
    positions: PACIFIC_1991,
  },
  CO: {
    race: { white: 80, black: 4, hispanic: 13, asian: 2, other: 1 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 30, mid: 30, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 9,
      progressives: 8,
      patriots: 11,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, -0.4, -0.7), // Amendment 2 passes in 1992, so it is still socially right of its Denver reputation
  },
  HI: {
    race: { white: 31, black: 2, hispanic: 7, asian: 55, other: 5 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 22, middle: 57, high: 21 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 10,
      libertarians: 3,
      progressives: 13,
      patriots: 7,
      gunowners: 4,
    },
    positions: ISLANDS_1991,
  },
  ID: {
    race: { white: 92, black: 0, hispanic: 5, asian: 1, other: 2 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 30, mid: 26, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 12,
      progressives: 3,
      patriots: 15,
      gunowners: 22,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, 0.9, 0.9), // tracks Utah rather than the Mountain line
  },
  MT: {
    race: { white: 91, black: 0, hispanic: 2, asian: 1, other: 6 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 32, middle: 55, high: 13 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 15,
      environmentalists: 7,
      libertarians: 12,
      progressives: 5,
      patriots: 13,
      gunowners: 22,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, -1.1, -0.1), // Clinton wins it by 3: the populist streak survives
  },
  NV: {
    race: { white: 79, black: 6, hispanic: 10, asian: 3, other: 2 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 29, mid: 29, mature: 26, senior: 16 },
    ideology: {
      evangelicals: 11,
      environmentalists: 5,
      libertarians: 13,
      progressives: 5,
      patriots: 11,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, -0.7, -1.4), // service-sector unionism restrains the state's economics
  },
  OR: {
    race: { white: 91, black: 2, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 10,
      environmentalists: 14,
      libertarians: 8,
      progressives: 10,
      patriots: 8,
      gunowners: 12,
    },
    positions: PACIFIC_1991,
  },
  UT: {
    race: { white: 91, black: 1, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 61, high: 15 },
    age: { young: 37, mid: 27, mature: 22, senior: 14 },
    ideology: {
      evangelicals: 36,
      environmentalists: 3,
      libertarians: 8,
      progressives: 3,
      patriots: 13,
      gunowners: 13,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, 1.2, 1.7), // Bush's Mountain fortress: even the Perot protest vote goes right
  },
  WA: {
    race: { white: 87, black: 3, hispanic: 4, asian: 4, other: 2 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 14,
      libertarians: 7,
      progressives: 11,
      patriots: 8,
      gunowners: 11,
    },
    positions: PACIFIC_1991,
  },
  WY: {
    race: { white: 91, black: 1, hispanic: 6, asian: 1, other: 1 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 17,
      environmentalists: 4,
      libertarians: 14,
      progressives: 3,
      patriots: 16,
      gunowners: 24,
    },
    positions: shiftRegionPositions(MOUNTAIN_1991, 0.5, 0.4), // an extraction economy with the file's most fused property-rights politics
  },
  DC: {
    race: { white: 27, black: 65, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 67, college: 17, graduate: 16 },
    wealth: { low: 38, middle: 42, high: 20 },
    age: { young: 32, mid: 30, mature: 23, senior: 15 },
    ideology: {
      evangelicals: 9,
      environmentalists: 8,
      libertarians: 2,
      progressives: 17,
      patriots: 5,
      gunowners: 3,
    },
    positions: CAPITAL_1991,
  },
};
