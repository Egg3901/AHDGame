import type { Layer1Config } from "./stateDemographics";
import { shiftRegionPositions, type PositionsBlock } from "./regionalPositions";

/**
 * Deep South (AL MS SC LA GA AR), 1999. Southern white conservatism at its most
 * economically consolidated: the last conservative Democratic officeholders are
 * converting or retiring and the region is a Republican base in presidential and,
 * increasingly, congressional voting alike.
 */
const DEEP_SOUTH_1999: PositionsBlock = {
  race: {
    white: { economicLean: 0.8, socialLean: 2.9 }, // tax cuts, defense and deregulation over an unmoved social axis
    black: { economicLean: -5, socialLean: -1 }, // a third of the electorate in MS and SC, and the most Democratic bloc in the country
    hispanic: { economicLean: -3.8, socialLean: -1.4 }, // a small Gulf Coast and Delta population
  },
  education: {
    no_college: { economicLean: 0.6, socialLean: 3.1 }, // fully sorted into the Republican coalition by now
    college: { economicLean: -2.5, socialLean: -1.5 }, // the Atlanta and research-corridor professional class
    graduate: { economicLean: -3.7, socialLean: -3.4 }, // a nationally rather than regionally coded stratum
  },
  wealth: {
    low: { economicLean: -3.8, socialLean: 0.6 }, // the poorest electorate in the country, disproportionately Black
    middle: { economicLean: 0.2, socialLean: 2.7 }, // small-metro chamber conservatism plus church attendance
    high: { economicLean: 1.5, socialLean: 1.9 }, // Sunbelt developer, banking and energy capital
  },
  ideology: {
    evangelicals: { economicLean: 2.5, socialLean: 4.9 }, // peak organizational strength, though impeachment has spent some of it
    patriots: { economicLean: 2, socialLean: 4.1 }, // the country's densest base network in the pre-9/11 lull
    gunowners: { economicLean: 2.2, socialLean: 4.1 }, // the assault-weapons ban made this an organized Republican bloc
    progressives: { economicLean: -5, socialLean: -4.4 }, // the biracial civil-rights coalition, a regional minority
    environmentalists: { economicLean: -4.4, socialLean: -3.6 }, // coastal and river politics without a partisan home
    libertarians: { economicLean: 3.9, socialLean: 1.2 }, // anti-regulation business conservatism
  },
};

/**
 * Border and peripheral South (VA NC TN FL TX OK KY MO WV MD DE), 1999. Appalachia
 * is now moving right: Gore loses TN, AR and WV in a year he wins the national popular
 * vote, and nothing economic explains it. FL, VA and NC are becoming the swing tier.
 */
const BORDER_1999: PositionsBlock = {
  race: {
    white: { economicLean: 0.7, socialLean: 2.3 }, // the Appalachian reversal begins: Gore loses WV, TN and AR on culture, not economics
    black: { economicLean: -5, socialLean: -1.3 }, // urban Black electorates from Baltimore to Memphis
    hispanic: { economicLean: -3.5, socialLean: -1.7 }, // south Texas: Democratic, Catholic and socially traditional
  },
  education: {
    no_college: { economicLean: 0, socialLean: 2.6 }, // the WV and KY reversal is this cell moving right economically
    college: { economicLean: -2.4, socialLean: -1.8 }, // the Northern Virginia and Research Triangle professional class
    graduate: { economicLean: -3.7, socialLean: -3.7 }, // federal, university and defense-lab payrolls
  },
  wealth: {
    low: { economicLean: -3.9, socialLean: 0.1 }, // coalfield and Ozark poverty, the last New Deal bloc in the region
    middle: { economicLean: -0.4, socialLean: 1.6 }, // county-seat merchants and the military middle class
    high: { economicLean: 1.6, socialLean: 1.4 }, // energy, tobacco and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 2.9, socialLean: 4.8 }, // peak organizational strength across the Bible Belt
    patriots: { economicLean: 2.2, socialLean: 3.8 }, // Norfolk and Fort Bragg over a heavy veteran share
    gunowners: { economicLean: 2.6, socialLean: 3.8 }, // coalfield and Piedmont gun culture, newly partisan
    progressives: { economicLean: -5, socialLean: -4.7 }, // civil-rights and labor organizations, a shrinking minority
    environmentalists: { economicLean: -4.5, socialLean: -3.9 }, // strip-mining and river politics
    libertarians: { economicLean: 4.1, socialLean: 0.7 }, // anti-tax business conservatism
  },
};

/**
 * Industrial Northeast (MA RI CT NY NJ PA), 1999. A solidly Democratic presidential
 * region. Social liberalism is the regional brand; the boom has quieted the fiscal
 * argument, so white economics are center-left rather than a labor left.
 */
const MID_ATLANTIC_1999: PositionsBlock = {
  race: {
    white: { economicLean: 1.2, socialLean: -1.8 }, // affluent, socially liberal and quiet on fiscal questions during the boom
    black: { economicLean: -4.8, socialLean: -1.9 }, // the Democratic coalition's urban core
    hispanic: { economicLean: -3.6, socialLean: -2.1 }, // Puerto Rican and Dominican New York and New Jersey
  },
  education: {
    no_college: { economicLean: 0.8, socialLean: -0.1 }, // still not a right bloc: the diploma divide is milder than it will be
    college: { economicLean: -1.5, socialLean: -2.9 }, // the suburban professional class, now reliably Democratic
    graduate: { economicLean: -3.5, socialLean: -4.7 }, // the academic and media professions, the era's liberal pole
  },
  wealth: {
    low: { economicLean: -3.5, socialLean: -1 }, // the post-industrial urban poor
    middle: { economicLean: 0.2, socialLean: -1.7 }, // suburban professionals, socially liberalizing
    high: { economicLean: 2.7, socialLean: -1.3 }, // finance capital: economically right, socially indifferent
  },
  ideology: {
    evangelicals: { economicLean: 3.6, socialLean: 3.4 }, // a smaller share and less likely to define a state mean
    patriots: { economicLean: 3.3, socialLean: 2.4 }, // ethnic Catholic Cold War patriotism after the Cold War
    gunowners: { economicLean: 3.5, socialLean: 2.4 }, // sporting clubs against an urban crime politics
    progressives: { economicLean: -4.9, socialLean: -5 }, // the reform-Democratic and public-employee left
    environmentalists: { economicLean: -4.3, socialLean: -4.6 }, // a mass constituency by now, and Democratic
    libertarians: { economicLean: 5, socialLean: -1.3 }, // a thin anti-tax minority
  },
};

/**
 * Great Lakes (OH IN IL MI WI MN IA), 1999. The genuine national median: MI, MN, WI,
 * IA and OH all finish within 5.5 points in 2000. Union decline continues and Nader
 * peels the left in WI, OR and MN.
 */
const GREAT_LAKES_1999: PositionsBlock = {
  race: {
    white: { economicLean: 0.8, socialLean: -0.1 }, // the national median electorate, split five ways across the 2000 tie belt
    black: { economicLean: -5, socialLean: -1.8 }, // Detroit, Cleveland, Chicago and Milwaukee
    hispanic: { economicLean: -3.6, socialLean: -2 }, // Chicago and the northern Indiana steel towns
  },
  education: {
    no_college: { economicLean: 0.4, socialLean: 1.1 }, // Ohio, Indiana and Missouri non-college whites right of Michigan and Minnesota
    college: { economicLean: -2, socialLean: -2.7 }, // the suburban professional tier, socially liberalizing
    graduate: { economicLean: -3.7, socialLean: -4.4 }, // Big Ten faculty and the research economy
  },
  wealth: {
    low: { economicLean: -4, socialLean: -0.9 }, // the plant-closure electorate, left behind by the boom
    middle: { economicLean: -0.2, socialLean: -0.3 }, // the union homeowner turned suburban fiscal conservative
    high: { economicLean: 2.1, socialLean: -0.5 }, // manufacturing capital in retreat
  },
  ideology: {
    evangelicals: { economicLean: 3.2, socialLean: 3.8 }, // a mobilized bloc across the rural tier, not yet dominant
    patriots: { economicLean: 2.6, socialLean: 2.6 }, // Legion halls and a heavily drafted generation
    gunowners: { economicLean: 3, socialLean: 2.8 }, // the northern hunting belt, now politically organized
    progressives: { economicLean: -5, socialLean: -5 }, // the DFL and campus left
    environmentalists: { economicLean: -4.4, socialLean: -4.3 }, // Great Lakes cleanup politics
    libertarians: { economicLean: 4.5, socialLean: -0.6 }, // small-business anti-regulation opinion
  },
};

/**
 * Plains (ND SD NE KS), 1999. The most consistent cell in the file across five eras:
 * an unchanged Republican floor.
 */
const PLAINS_1999: PositionsBlock = {
  race: {
    white: { economicLean: 3.6, socialLean: 1.4 }, // the Republican floor, hardened by the farm crisis into anti-Washington economics
    black: { economicLean: -4.4, socialLean: -1.6 }, // small urban populations in Omaha, Wichita and Sioux Falls
    hispanic: { economicLean: -3, socialLean: -1.6 }, // meatpacking labor arriving in the small towns
  },
  education: {
    no_college: { economicLean: 2, socialLean: 1.6 }, // no union structure to pull the farm and small-town workforce left
    college: { economicLean: -0.9, socialLean: -2.1 }, // land-grant graduates in agriculture and county business
    graduate: { economicLean: -2.7, socialLean: -3.9 }, // extension and university staff
  },
  wealth: {
    low: { economicLean: -2.7, socialLean: -0.4 }, // farm-crisis debt and small-town decline
    middle: { economicLean: 1.6, socialLean: 0.8 }, // the merchant and farm-owner middle class
    high: { economicLean: 3.1, socialLean: 0.5 }, // grain, land and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 4.6, socialLean: 4.4 }, // Bible Belt organization at its peak alongside the South
    patriots: { economicLean: 3.9, socialLean: 3.4 }, // missile fields and airbases
    gunowners: { economicLean: 4.3, socialLean: 3.4 }, // universal rural ownership fused with national gun politics
    progressives: { economicLean: -4.3, socialLean: -4.6 }, // the surviving Farmers Union left
    environmentalists: { economicLean: -3.5, socialLean: -3.8 }, // soil and aquifer conservation
    libertarians: { economicLean: 5, socialLean: 0.1 }, // anti-federal constitutionalism
  },
};

/**
 * Mountain West and Alaska (MT ID WY CO UT NV AZ NM AK), 1999. Still the economic
 * right pole, but social traditionalism starts easing where in-migration has reached
 * Colorado, Nevada and Arizona.
 */
const MOUNTAIN_1999: PositionsBlock = {
  race: {
    white: { economicLean: 3.3, socialLean: 1 }, // the economic right pole, with in-migration starting to soften CO, NV and AZ
    black: { economicLean: -4.4, socialLean: -1.6 }, // small urban populations in Denver, Phoenix and Las Vegas
    hispanic: { economicLean: -2.8, socialLean: -1.2 }, // New Mexico Hispanos and Arizona and Nevada service labor
  },
  education: {
    no_college: { economicLean: 1.7, socialLean: 1.2 }, // extraction and service labor with the unions mostly gone
    college: { economicLean: -1.1, socialLean: -2.2 }, // the professional tier of Denver, Salt Lake, Phoenix and Boise
    graduate: { economicLean: -2.8, socialLean: -4 }, // the national laboratories and state universities
  },
  wealth: {
    low: { economicLean: -3, socialLean: -0.5 }, // reservation and service-sector poverty
    middle: { economicLean: 1.5, socialLean: 0.4 }, // suburban fiscal conservatism plus Amendment 2 era social politics
    high: { economicLean: 3.1, socialLean: 0.4 }, // energy, mining and real-estate capital
  },
  ideology: {
    evangelicals: { economicLean: 4.4, socialLean: 4.1 }, // the LDS corridor plus Rocky Mountain fundamentalism
    patriots: { economicLean: 3.7, socialLean: 3.1 }, // the defense installations and a heavy veteran share
    gunowners: { economicLean: 4.3, socialLean: 3.3 }, // the region where federal firearms politics is most explosive
    progressives: { economicLean: -4.6, socialLean: -4.9 }, // a Denver, Boulder and Santa Fe minority
    environmentalists: { economicLean: -4, socialLean: -4.3 }, // wilderness and water politics against the property-rights movement
    libertarians: { economicLean: 5, socialLean: -0.2 }, // the movement's geographic heartland
  },
};

/**
 * Pacific coast (CA OR WA), 1999. The Proposition 187 backlash has ended Republican
 * competitiveness in California, and the white group itself moves further socially
 * liberal rather than merely being outvoted.
 */
const PACIFIC_1999: PositionsBlock = {
  race: {
    white: { economicLean: 1.9, socialLean: -1.7 }, // post-Proposition 187 California: the white group itself moves left, not just the electorate
    black: { economicLean: -4.5, socialLean: -2 }, // Los Angeles, Oakland and Seattle
    hispanic: { economicLean: -3.3, socialLean: -2.2 }, // registration surging in the Proposition 187 backlash
  },
  education: {
    no_college: { economicLean: 1.2, socialLean: 0.1 }, // aerospace layoffs and inland timber, economically squeezed
    college: { economicLean: -1.5, socialLean: -2.8 }, // the coastal professional class, now reliably Democratic
    graduate: { economicLean: -3.6, socialLean: -4.7 }, // the University of California system and the software economy
  },
  wealth: {
    low: { economicLean: -3.2, socialLean: -1.1 }, // inner-city and farmworker poverty
    middle: { economicLean: 1, socialLean: -1.5 }, // post-industrial suburban professionals rather than tax-revolt homeowners
    high: { economicLean: 3.1, socialLean: -1.4 }, // entertainment, aerospace and early technology capital
  },
  ideology: {
    evangelicals: { economicLean: 3.9, socialLean: 3.8 }, // a real but regional bloc that does not drag the state means
    patriots: { economicLean: 3.6, socialLean: 2.6 }, // a shrinking defense economy
    gunowners: { economicLean: 3.8, socialLean: 2.6 }, // inland gun culture against coastal restriction
    progressives: { economicLean: -4.8, socialLean: -5 }, // the environmental and civil-rights left at its strongest
    environmentalists: { economicLean: -4.4, socialLean: -4.7 }, // the coast's defining political identity outside the cities
    libertarians: { economicLean: 5, socialLean: -1.5 }, // technology-boom individualism
  },
};

/**
 * Yankee New England (VT NH ME), 1999. Vermont enacts civil unions in 2000 and leads
 * the social axis nationally, while New Hampshire stays the anti-tax exception and the
 * only Bush state in New England.
 */
const YANKEE_1999: PositionsBlock = {
  race: {
    white: { economicLean: 1.4, socialLean: -1.2 }, // civil unions and the anti-tax pledge in the same three states
    black: { economicLean: -4.2, socialLean: -1.6 }, // a very small population concentrated in the mill cities
    hispanic: { economicLean: -3.2, socialLean: -2 }, // small and concentrated in the same mill cities
  },
  education: {
    no_college: { economicLean: 0.6, socialLean: 0.4 }, // mill and quarry labor without a union structure
    college: { economicLean: -1.8, socialLean: -2.4 }, // the region's professional class, the most socially liberal in the file
    graduate: { economicLean: -3.6, socialLean: -4.4 }, // the New England college faculties
  },
  wealth: {
    low: { economicLean: -3.2, socialLean: -0.8 }, // rural hill poverty
    middle: { economicLean: 0.6, socialLean: -1 }, // the anti-tax small-town middle class, still New Hampshire's spine
    high: { economicLean: 2.8, socialLean: -1 }, // Boston-adjacent finance and second-home capital
  },
  ideology: {
    evangelicals: { economicLean: 3, socialLean: 3.8 }, // a small old-stock Protestant remnant
    patriots: { economicLean: 3, socialLean: 2.8 }, // town veterans' posts
    gunowners: { economicLean: 3.4, socialLean: 2.8 }, // deer season as civic ritual, only lightly partisan
    progressives: { economicLean: -4.8, socialLean: -5 }, // the Vermont left that will produce Dean and Sanders
    environmentalists: { economicLean: -4.4, socialLean: -4.4 }, // land-use and forest politics, electorally decisive
    libertarians: { economicLean: 5, socialLean: -1.2 }, // Live Free or Die constitutionalism
  },
};

/**
 * Hawaii, 1999. Gore by 20: a safe Democratic state on both axes, with the ILWU
 * legacy still setting its economics.
 */
const ISLANDS_1999: PositionsBlock = {
  race: {
    white: { economicLean: -0.4, socialLean: -2.3 }, // military and mainland-transplant households inside a Democratic state
    black: { economicLean: -4.3, socialLean: -2.1 }, // a small military-linked population
    hispanic: { economicLean: -3.1, socialLean: -2.3 }, // Filipino and Puerto Rican plantation descendants
  },
  education: {
    no_college: { economicLean: -0.7, socialLean: -0.8 }, // the hotel and dock workforce, the machine's base
    college: { economicLean: -1.7, socialLean: -3.3 }, // state civil service and the university
    graduate: { economicLean: -3.5, socialLean: -4.8 }, // a small professional stratum
  },
  wealth: {
    low: { economicLean: -3.5, socialLean: -1.5 }, // service-sector and camp-housing poverty
    middle: { economicLean: -0.7, socialLean: -2 }, // the civil-service and small-business class the ILWU machine built
    high: { economicLean: 2.1, socialLean: -1.9 }, // tourism and Japanese investment capital
  },
  ideology: {
    evangelicals: { economicLean: 3.1, socialLean: 2.6 }, // missionary-descended congregations, a minority
    patriots: { economicLean: 2.7, socialLean: 1.4 }, // Pearl Harbor and a heavy military presence
    gunowners: { economicLean: 2.9, socialLean: 1.4 }, // outer-island hunting, a minor identity
    progressives: { economicLean: -4.9, socialLean: -5 }, // the ILWU political machine
    environmentalists: { economicLean: -4.3, socialLean: -4.7 }, // reef and land conservation against resort development
    libertarians: { economicLean: 4.7, socialLean: -1.8 }, // small-trader independence, marginal
  },
};

/**
 * District of Columbia, 1999. Gore by 81 points. The economic left pole of the file.
 */
const CAPITAL_1999: PositionsBlock = {
  race: {
    white: { economicLean: -5, socialLean: -3.1 }, // federal professionals and gentrifiers in a Black-majority city
    black: { economicLean: -5, socialLean: -1.5 }, // the most Democratic electorate in the country
    hispanic: { economicLean: -4.4, socialLean: -2.3 }, // a growing Salvadoran population in Columbia Heights
  },
  education: {
    no_college: { economicLean: -4.5, socialLean: -0.8 }, // the federal service and hospitality workforce
    college: { economicLean: -4.8, socialLean: -3.8 }, // the career civil service
    graduate: { economicLean: -5, socialLean: -5 }, // the agency, think-tank and law professional class
  },
  wealth: {
    low: { economicLean: -5, socialLean: -1.1 }, // concentrated urban poverty a mile from the Capitol
    middle: { economicLean: -4.5, socialLean: -2.4 }, // the federal grade-scale middle class
    high: { economicLean: -1, socialLean: -2.2 }, // law, lobbying and federal contracting
  },
  ideology: {
    evangelicals: { economicLean: -0.5, socialLean: 2.7 }, // Black Baptist congregations: socially traditional, economically left
    patriots: { economicLean: -0.7, socialLean: 1.3 }, // the military and veterans' bureaucracy
    gunowners: { economicLean: -0.5, socialLean: 1.5 }, // marginal under the handgun ban
    progressives: { economicLean: -5, socialLean: -5 }, // the city's civil-rights and public-employee left
    environmentalists: { economicLean: -5, socialLean: -5 }, // the federal environmental bureaucracy's home
    libertarians: { economicLean: 2.5, socialLean: -1.9 }, // a think-tank minority
  },
};

/**
 * 1999-era US state demographic profiles, anchored to the 2000 Census.
 *
 * Methodology: every state was authored INDEPENDENTLY from historical
 * knowledge of that state circa 1999-2000 — values are NOT scaled or
 * derived from the 2019 dataset in `stateCensusData.ts` (that file was
 * consulted only for field shape and ideology-scale conventions).
 *
 * Key national reference points (Census 2000):
 * - Race: non-Hispanic White ~69%, Black ~12%, Hispanic ~12.5%, Asian ~3.6%
 * - Education: bachelor's degree or higher ~24% of adults 25+
 * - Median age ~35.3 (younger than 2019; smaller senior cohorts)
 * - Dot-com boom prosperity concentrated in CA/WA/MA/CO/CT/NJ tech and
 *   finance corridors; Appalachia and the Deep South lag
 * - Hispanic population growth concentrated in CA/TX/AZ/NM/NV/FL
 * - Evangelical influence strong across the South; environmental movement
 *   mid-strength (strongest in the Pacific Northwest and Vermont);
 *   pre-9/11, so nationalist "patriot" sentiment is modest; partisan
 *   sorting only beginning, so progressive shares run lower than 2019
 *
 * race/education/wealth/age each sum to exactly 100 per state;
 * ideology values are independent shares and do not sum to 100.
 */
export const stateCensusData1999: Record<string, Layer1Config> = {
  AK: {
    race: { white: 69, black: 3, hispanic: 4, asian: 4, other: 20 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 30, mid: 29, mature: 26, senior: 15 },
    ideology: {
      evangelicals: 12,
      environmentalists: 8,
      libertarians: 12,
      progressives: 7,
      patriots: 12,
      gunowners: 20,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, 0.9, 0.7), // Gore -35.8
  },
  AL: {
    race: { white: 71, black: 26, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 36, middle: 49, high: 15 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 14,
      gunowners: 22,
    },
    positions: DEEP_SOUTH_1999,
  },
  AR: {
    race: { white: 79, black: 16, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 35,
      environmentalists: 3,
      libertarians: 5,
      progressives: 4,
      patriots: 13,
      gunowners: 22,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1999, 0, -2.2), // Bush by 6 in Clinton's home state
  },
  AZ: {
    race: { white: 64, black: 3, hispanic: 25, asian: 2, other: 6 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 27, mid: 27, mature: 24, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 9,
      progressives: 8,
      patriots: 10,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, -1, -0.4), // Bush by 6.6, with retiree and Latino growth pulling opposite ways
  },
  CA: {
    race: { white: 47, black: 6, hispanic: 32, asian: 11, other: 4 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 26, middle: 50, high: 24 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 16,
      libertarians: 5,
      progressives: 18,
      patriots: 4,
      gunowners: 7,
    },
    positions: PACIFIC_1999,
  },
  CO: {
    race: { white: 75, black: 4, hispanic: 17, asian: 2, other: 2 },
    education: { no_college: 62, college: 25, graduate: 13 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 28, mid: 29, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 9,
      progressives: 12,
      patriots: 7,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, -0.9, -1.2), // Bush by 9, but the Front Range in-migration trend is now measurable
  },
  CT: {
    race: { white: 77, black: 9, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 63, college: 23, graduate: 14 },
    wealth: { low: 20, middle: 50, high: 30 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 5,
      progressives: 17,
      patriots: 3,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1999, 0, -0.3), // Gore by 19 with Lieberman on the ticket
  },
  DC: {
    race: { white: 28, black: 60, hispanic: 8, asian: 3, other: 1 },
    education: { no_college: 55, college: 24, graduate: 21 },
    wealth: { low: 36, middle: 40, high: 24 },
    age: { young: 30, mid: 29, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 8,
      environmentalists: 12,
      libertarians: 3,
      progressives: 24,
      patriots: 3,
      gunowners: 3,
    },
    positions: CAPITAL_1999,
  },
  DE: {
    race: { white: 72, black: 19, hispanic: 5, asian: 2, other: 2 },
    education: { no_college: 69, college: 20, graduate: 11 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 8,
      environmentalists: 12,
      libertarians: 5,
      progressives: 16,
      patriots: 5,
      gunowners: 6,
    },
    positions: shiftRegionPositions(BORDER_1999, -0.8, -2.3), // Gore by 14
  },
  FL: {
    race: { white: 65, black: 14, hispanic: 17, asian: 2, other: 2 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 24, mid: 26, mature: 25, senior: 25 },
    ideology: {
      evangelicals: 15,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 9,
      gunowners: 11,
    },
    positions: shiftRegionPositions(BORDER_1999, 1.1, -1.5), // the 537-vote state
  },
  GA: {
    race: { white: 63, black: 29, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 28, mid: 29, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 5,
      progressives: 7,
      patriots: 13,
      gunowners: 17,
    },
    positions: DEEP_SOUTH_1999,
  },
  HI: {
    race: { white: 24, black: 2, hispanic: 7, asian: 41, other: 26 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 7,
      environmentalists: 14,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 4,
    },
    positions: ISLANDS_1999,
  },
  IA: {
    race: { white: 93, black: 2, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 25, mid: 25, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 7,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, 0, 0.5), // Gore by 0.3 in the closest farm state
  },
  ID: {
    race: { white: 88, black: 0, hispanic: 8, asian: 1, other: 3 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 6,
      libertarians: 11,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, 0.8, 1.9), // Gore -41.8
  },
  IL: {
    race: { white: 68, black: 15, hispanic: 12, asian: 3, other: 2 },
    education: { no_college: 68, college: 21, graduate: 11 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 27, mid: 27, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 6,
      gunowners: 7,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, -0.7, -0.8), // Chicago and the collar counties make it safe by 12
  },
  IN: {
    race: { white: 86, black: 8, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 6,
      progressives: 7,
      patriots: 10,
      gunowners: 15,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, 1, 1.4), // already Republican while its neighbors are not
  },
  KS: {
    race: { white: 83, black: 6, hispanic: 7, asian: 2, other: 2 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 26, middle: 55, high: 19 },
    age: { young: 27, mid: 26, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 20,
      environmentalists: 5,
      libertarians: 8,
      progressives: 7,
      patriots: 10,
      gunowners: 15,
    },
    positions: PLAINS_1999,
  },
  KY: {
    race: { white: 89, black: 7, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 5,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: BORDER_1999,
  },
  LA: {
    race: { white: 63, black: 32, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 38, middle: 47, high: 15 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 26,
      environmentalists: 3,
      libertarians: 4,
      progressives: 8,
      patriots: 12,
      gunowners: 18,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1999, 0.1, -0.3), // Bush by 8
  },
  MA: {
    race: { white: 82, black: 5, hispanic: 7, asian: 4, other: 2 },
    education: { no_college: 60, college: 24, graduate: 16 },
    wealth: { low: 22, middle: 48, high: 30 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 5,
      environmentalists: 15,
      libertarians: 4,
      progressives: 19,
      patriots: 3,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1999, -1.1, -0.9), // Gore by 30
  },
  MD: {
    race: { white: 62, black: 28, hispanic: 4, asian: 4, other: 2 },
    education: { no_college: 63, college: 22, graduate: 15 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 26, mid: 29, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 10,
      environmentalists: 12,
      libertarians: 4,
      progressives: 18,
      patriots: 5,
      gunowners: 6,
    },
    positions: shiftRegionPositions(BORDER_1999, -1.3, -2.5), // Gore by 17 on the federal suburbs and Baltimore
  },
  ME: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 23, mid: 26, mature: 28, senior: 23 },
    ideology: {
      evangelicals: 8,
      environmentalists: 14,
      libertarians: 7,
      progressives: 12,
      patriots: 5,
      gunowners: 10,
    },
    positions: shiftRegionPositions(YANKEE_1999, 0.1, -0.4), // Gore by 6 over a socially moderate anti-tax tradition
  },
  MI: {
    race: { white: 79, black: 14, hispanic: 3, asian: 2, other: 2 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 5,
      progressives: 13,
      patriots: 8,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, 0.1, -0.7), // the auto economy holds it Democratic by 5
  },
  MN: {
    race: { white: 88, black: 3, hispanic: 3, asian: 3, other: 3 },
    education: { no_college: 67, college: 23, graduate: 10 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 11,
      libertarians: 6,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, -0.8, -0.5), // Ventura's 1998 win signals an unmoored anti-establishment center
  },
  MO: {
    race: { white: 84, black: 11, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 25, mid: 26, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 7,
      progressives: 8,
      patriots: 10,
      gunowners: 15,
    },
    positions: BORDER_1999,
  },
  MS: {
    race: { white: 61, black: 36, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 42, middle: 45, high: 13 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 32,
      environmentalists: 2,
      libertarians: 4,
      progressives: 6,
      patriots: 12,
      gunowners: 17,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1999, 0.3, 0.5), // the largest Black electorate share in the country under a Republican white majority
  },
  MT: {
    race: { white: 90, black: 0, hispanic: 2, asian: 1, other: 7 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 25, mid: 25, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 12,
      progressives: 7,
      patriots: 12,
      gunowners: 22,
    },
    positions: MOUNTAIN_1999,
  },
  NC: {
    race: { white: 70, black: 21, hispanic: 5, asian: 1, other: 3 },
    education: { no_college: 71, college: 19, graduate: 10 },
    wealth: { low: 30, middle: 51, high: 19 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 28,
      environmentalists: 4,
      libertarians: 5,
      progressives: 8,
      patriots: 11,
      gunowners: 15,
    },
    positions: shiftRegionPositions(BORDER_1999, 0.1, 0.4), // Bush by 13 with the Research Triangle growing
  },
  ND: {
    race: { white: 92, black: 1, hispanic: 1, asian: 1, other: 5 },
    education: { no_college: 71, college: 21, graduate: 8 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 7,
      progressives: 6,
      patriots: 9,
      gunowners: 16,
    },
    positions: PLAINS_1999,
  },
  NE: {
    race: { white: 87, black: 4, hispanic: 6, asian: 1, other: 2 },
    education: { no_college: 70, college: 21, graduate: 9 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 25, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 7,
      progressives: 7,
      patriots: 9,
      gunowners: 14,
    },
    positions: PLAINS_1999,
  },
  NH: {
    race: { white: 95, black: 1, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 64, college: 23, graduate: 13 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 12,
      libertarians: 11,
      progressives: 12,
      patriots: 5,
      gunowners: 11,
    },
    positions: shiftRegionPositions(YANKEE_1999, 0.3, 0.7), // the only Bush state in New England, and still the anti-tax exception
  },
  NJ: {
    race: { white: 66, black: 13, hispanic: 13, asian: 6, other: 2 },
    education: { no_college: 64, college: 22, graduate: 14 },
    wealth: { low: 22, middle: 48, high: 30 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 12,
      libertarians: 5,
      progressives: 17,
      patriots: 4,
      gunowners: 4,
    },
    positions: MID_ATLANTIC_1999,
  },
  NM: {
    race: { white: 45, black: 2, hispanic: 42, asian: 1, other: 10 },
    education: { no_college: 71, college: 18, graduate: 11 },
    wealth: { low: 38, middle: 46, high: 16 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 9,
      libertarians: 7,
      progressives: 11,
      patriots: 8,
      gunowners: 15,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, -1.5, -1.3), // decided by 366 votes; the Hispanic north puts the state mean far left of its white value
  },
  NV: {
    race: { white: 65, black: 7, hispanic: 20, asian: 5, other: 3 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 28, mid: 28, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 11,
      environmentalists: 7,
      libertarians: 10,
      progressives: 8,
      patriots: 8,
      gunowners: 13,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, -1.2, -1.2), // Bush by 3.7: the casino service economy against a Republican interior
  },
  NY: {
    race: { white: 62, black: 15, hispanic: 15, asian: 6, other: 2 },
    education: { no_college: 65, college: 21, graduate: 14 },
    wealth: { low: 28, middle: 46, high: 26 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 7,
      environmentalists: 13,
      libertarians: 4,
      progressives: 19,
      patriots: 4,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1999, -1, 0.1), // Gore by 26
  },
  OH: {
    race: { white: 84, black: 11, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 6,
      libertarians: 5,
      progressives: 11,
      patriots: 8,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, 0.4, 1), // Bush by 4 in the country's most reliable bellwether
  },
  OK: {
    race: { white: 74, black: 7, hispanic: 5, asian: 1, other: 13 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 32,
      environmentalists: 3,
      libertarians: 6,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: shiftRegionPositions(BORDER_1999, 1.1, 0.5), // Bush by 22
  },
  OR: {
    race: { white: 84, black: 2, hispanic: 8, asian: 3, other: 3 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 16,
      libertarians: 8,
      progressives: 15,
      patriots: 6,
      gunowners: 11,
    },
    positions: shiftRegionPositions(PACIFIC_1999, -0.1, 0.4), // Gore by 0.5: Portland against the timber counties
  },
  PA: {
    race: { white: 84, black: 10, hispanic: 3, asian: 2, other: 1 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 13,
      environmentalists: 8,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1999, 0.2, 0.9), // Gore by 4: Philadelphia and Pittsburgh against the Republican T
  },
  RI: {
    race: { white: 82, black: 4, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 70, college: 19, graduate: 11 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 4,
      progressives: 17,
      patriots: 4,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1999, -1.3, -0.8), // Gore by 31
  },
  SC: {
    race: { white: 66, black: 30, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 4,
      progressives: 6,
      patriots: 13,
      gunowners: 17,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1999, 0.3, 0.3), // Bush by 16
  },
  SD: {
    race: { white: 88, black: 1, hispanic: 1, asian: 1, other: 9 },
    education: { no_college: 74, college: 18, graduate: 8 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 8,
      progressives: 5,
      patriots: 10,
      gunowners: 17,
    },
    positions: PLAINS_1999,
  },
  TN: {
    race: { white: 79, black: 16, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 32, middle: 51, high: 17 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 32,
      environmentalists: 3,
      libertarians: 5,
      progressives: 6,
      patriots: 13,
      gunowners: 18,
    },
    positions: BORDER_1999,
  },
  TX: {
    race: { white: 52, black: 11, hispanic: 32, asian: 3, other: 2 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 24,
      environmentalists: 4,
      libertarians: 8,
      progressives: 8,
      patriots: 11,
      gunowners: 15,
    },
    positions: shiftRegionPositions(BORDER_1999, 1.3, 0.5), // Bush's home state
  },
  UT: {
    race: { white: 85, black: 1, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 32,
      environmentalists: 4,
      libertarians: 8,
      progressives: 4,
      patriots: 11,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, 0.8, 3), // Gore -43.6: the Mountain ceiling on both axes
  },
  VA: {
    race: { white: 70, black: 19, hispanic: 5, asian: 4, other: 2 },
    education: { no_college: 67, college: 21, graduate: 12 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 27, mid: 29, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 6,
      libertarians: 5,
      progressives: 10,
      patriots: 10,
      gunowners: 12,
    },
    positions: BORDER_1999,
  },
  VT: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 67, college: 21, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 6,
      environmentalists: 18,
      libertarians: 7,
      progressives: 17,
      patriots: 4,
      gunowners: 9,
    },
    positions: YANKEE_1999,
  },
  WA: {
    race: { white: 79, black: 3, hispanic: 7, asian: 6, other: 5 },
    education: { no_college: 65, college: 23, graduate: 12 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 10,
      environmentalists: 17,
      libertarians: 7,
      progressives: 16,
      patriots: 5,
      gunowners: 9,
    },
    positions: PACIFIC_1999,
  },
  WI: {
    race: { white: 87, black: 6, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 25, middle: 56, high: 19 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 6,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1999, 0, -0.4), // Gore by 0.2 with Nader on the ballot
  },
  WV: {
    race: { white: 95, black: 3, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 42, middle: 46, high: 12 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 26,
      environmentalists: 3,
      libertarians: 4,
      progressives: 5,
      patriots: 12,
      gunowners: 22,
    },
    positions: shiftRegionPositions(BORDER_1999, 0.5, -1.1), // flips to Bush for the first time outside a landslide since 1928: guns, coal and culture
  },
  WY: {
    race: { white: 89, black: 1, hispanic: 6, asian: 1, other: 3 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 13,
      progressives: 4,
      patriots: 13,
      gunowners: 22,
    },
    positions: shiftRegionPositions(MOUNTAIN_1999, 0.8, 0.6), // Gore -42.0 with Cheney on the ticket
  },
};
