import type { Layer1Config } from "./stateDemographics";
import { shiftRegionPositions, type PositionsBlock } from "./regionalPositions";

/**
 * Deep South (AL MS SC LA GA AR), 2007. Maximum white Republican alignment on both
 * axes. The state means understate the white position badly because a quarter to a
 * third of the electorate is Black and turning out at its historical peak, which is
 * why this is the region where the group value must be boldest relative to the mean.
 */
const DEEP_SOUTH_2007: PositionsBlock = {
  race: {
    white: { economicLean: 0.7, socialLean: 2.5 }, // the Republican ceiling on both axes: anti-redistribution, energy and defense
    black: { economicLean: -4.7, socialLean: -1.4 }, // peak Black turnout and near-total consolidation behind Obama
    hispanic: { economicLean: -3.2, socialLean: -1.4 }, // a small Gulf Coast and Delta population
  },
  education: {
    no_college: { economicLean: 4.8, socialLean: 2.9 }, // the diploma divide here is college slightly less Republican, not a left college class
    college: { economicLean: -1.5, socialLean: -1.6 }, // the Atlanta and research-corridor professional class
    graduate: { economicLean: -3.4, socialLean: -3.9 }, // a nationally rather than regionally coded stratum
  },
  wealth: {
    low: { economicLean: -3.1, socialLean: 0.5 }, // the poorest electorate in the country, disproportionately Black
    middle: { economicLean: 1.8, socialLean: 2.3 }, // small-metro chamber conservatism plus church attendance
    high: { economicLean: 2.5, socialLean: 1.4 }, // the financial crisis trims high-income Republicanism even here
  },
  ideology: {
    evangelicals: { economicLean: 2.5, socialLean: 4.8 }, // positions barely move but McCain is a poor fit, so turnout enthusiasm is down
    patriots: { economicLean: 2, socialLean: 4 }, // Gulf War patriotism over the country's densest base network
    gunowners: { economicLean: 2.2, socialLean: 4 }, // the assault-weapons fight is about to make this an organized bloc
    progressives: { economicLean: -5, socialLean: -4.5 }, // the biracial civil-rights coalition, a regional minority
    environmentalists: { economicLean: -4.5, socialLean: -3.7 }, // coastal and river politics without a partisan home
    libertarians: { economicLean: 3.8, socialLean: 1.1 }, // anti-regulation business conservatism
  },
};

/**
 * Border and peripheral South (VA NC TN FL TX OK KY MO WV MD DE), 2007. The split is
 * complete: the Appalachian and Ozark interior counter-swings right against a national
 * Democratic tide while VA, NC and FL move left on suburban growth.
 */
const BORDER_2007: PositionsBlock = {
  race: {
    white: { economicLean: -0.5, socialLean: 1.6 }, // the completed Appalachian reversal against a national Democratic tide
    black: { economicLean: -4.7, socialLean: -1.7 }, // urban Black electorates from Baltimore to Memphis
    hispanic: { economicLean: -3.2, socialLean: -1.7 }, // south Texas: Democratic, Catholic and socially traditional
  },
  education: {
    no_college: { economicLean: 4, socialLean: 2.1 }, // WV, KY, TN and AR non-college whites have finished moving right
    college: { economicLean: -2.2, socialLean: -2.2 }, // the Northern Virginia and Research Triangle professional class
    graduate: { economicLean: -3.9, socialLean: -4.2 }, // federal, university and defense-lab payrolls
  },
  wealth: {
    low: { economicLean: -3.5, socialLean: 0 }, // coalfield and Ozark poverty, the last New Deal bloc in the region
    middle: { economicLean: 0, socialLean: 0.9 }, // county-seat conservatism, untouched by the crisis politics of the coasts
    high: { economicLean: 1.8, socialLean: 0.6 }, // energy, tobacco and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 1.9, socialLean: 4.4 }, // Southern Baptist mobilization at its organizational peak
    patriots: { economicLean: 1.2, socialLean: 3.4 }, // Norfolk, Fort Bragg and the Gulf War homecoming
    gunowners: { economicLean: 1.6, socialLean: 3.4 }, // coalfield and Piedmont gun culture, newly partisan
    progressives: { economicLean: -5, socialLean: -4.8 }, // civil-rights and labor organizations, a shrinking minority
    environmentalists: { economicLean: -4.9, socialLean: -4 }, // strip-mining and river politics
    libertarians: { economicLean: 3.5, socialLean: 0.6 }, // anti-tax business conservatism
  },
};

/**
 * Industrial Northeast (MA RI CT NY NJ PA), 2007. The Republican collapse is most
 * complete here, and not one New England House seat survives 2008. White social
 * liberalism is the distinctive fact; white economics are only modestly left.
 */
const MID_ATLANTIC_2007: PositionsBlock = {
  race: {
    white: { economicLean: -1, socialLean: -2.3 }, // social liberalism is the distinctive fact; economics only modestly left
    black: { economicLean: -4.7, socialLean: -2.3 }, // the Democratic coalition's urban core
    hispanic: { economicLean: -3.4, socialLean: -2.1 }, // Puerto Rican and Dominican New York and New Jersey
  },
  education: {
    no_college: { economicLean: 4.1, socialLean: -0.2 }, // still much less right than southern non-college whites; the inversion is incomplete
    college: { economicLean: -1.6, socialLean: -2.8 }, // the suburban professional class, now reliably Democratic
    graduate: { economicLean: -3.8, socialLean: -5 }, // the academic and media professions, the era's liberal pole
  },
  wealth: {
    low: { economicLean: -3.3, socialLean: -1 }, // the post-industrial urban poor
    middle: { economicLean: -0.1, socialLean: -2.2 }, // housing exposure and professional-class social liberalism together
    high: { economicLean: 2.6, socialLean: -2 }, // the financial crisis year: high earners are the least Republican of the series
  },
  ideology: {
    evangelicals: { economicLean: 2.4, socialLean: 3.5 }, // a smaller share and less likely to define a state mean
    patriots: { economicLean: 2.1, socialLean: 2.5 }, // ethnic Catholic Cold War patriotism after the Cold War
    gunowners: { economicLean: 2.3, socialLean: 2.5 }, // sporting clubs against an urban crime politics
    progressives: { economicLean: -5, socialLean: -5 }, // the reform-Democratic and public-employee left
    environmentalists: { economicLean: -4.9, socialLean: -4.6 }, // a mass constituency by now, and Democratic
    libertarians: { economicLean: 4.4, socialLean: -1.3 }, // a thin anti-tax minority
  },
};

/**
 * Great Lakes (OH IN IL MI WI MN IA), 2007. Manufacturing collapse revives economic
 * populism and pulls the region's economics back toward neutral for the first time
 * since 1979. Indiana flips for the first time since 1964.
 */
const GREAT_LAKES_2007: PositionsBlock = {
  race: {
    white: { economicLean: -1.8, socialLean: -0.5 }, // manufacturing collapse revives economic populism; social values stay right of the coasts
    black: { economicLean: -4.6, socialLean: -2.2 }, // Detroit, Cleveland, Chicago and Milwaukee
    hispanic: { economicLean: -3.5, socialLean: -2 }, // Chicago and the northern Indiana steel towns
  },
  education: {
    no_college: { economicLean: 3, socialLean: 1.1 }, // economically the most left this group has been since 1979, which is why OH, MI and IN move
    college: { economicLean: -2.4, socialLean: -2.7 }, // the suburban professional tier, socially liberalizing
    graduate: { economicLean: -4.3, socialLean: -4.8 }, // Big Ten faculty and the research economy
  },
  wealth: {
    low: { economicLean: -3.9, socialLean: -0.9 }, // the plant-closure electorate of the 1980s
    middle: { economicLean: -1, socialLean: -0.5 }, // auto-belt households with negative equity
    high: { economicLean: 1.7, socialLean: -0.9 }, // manufacturing capital in retreat
  },
  ideology: {
    evangelicals: { economicLean: 1.5, socialLean: 3.8 }, // a mobilized bloc across the rural tier, not yet dominant
    patriots: { economicLean: 0.9, socialLean: 2.6 }, // Legion halls and a heavily drafted generation
    gunowners: { economicLean: 1.3, socialLean: 2.8 }, // the northern hunting belt, now politically organized
    progressives: { economicLean: -5, socialLean: -5 }, // the DFL and campus left
    environmentalists: { economicLean: -5, socialLean: -4.3 }, // Great Lakes cleanup politics
    libertarians: { economicLean: 3.5, socialLean: -0.6 }, // small-business anti-regulation opinion
  },
};

/**
 * Plains (ND SD NE KS), 2007. Unmoved across the whole 55-year span, the most stable
 * cell in the file.
 */
const PLAINS_2007: PositionsBlock = {
  race: {
    white: { economicLean: 1.7, socialLean: 0.9 }, // the Republican floor, hardened by the farm crisis into anti-Washington economics
    black: { economicLean: -4.5, socialLean: -2 }, // small urban populations in Omaha, Wichita and Sioux Falls
    hispanic: { economicLean: -2.7, socialLean: -1.6 }, // meatpacking labor arriving in the small towns
  },
  education: {
    no_college: { economicLean: 4.8, socialLean: 1.3 }, // no union structure to pull the farm and small-town workforce left
    college: { economicLean: -0.9, socialLean: -2.3 }, // land-grant graduates in agriculture and county business
    graduate: { economicLean: -3, socialLean: -4.4 }, // extension and university staff
  },
  wealth: {
    low: { economicLean: -2.4, socialLean: -0.5 }, // farm-crisis debt and small-town decline
    middle: { economicLean: 1.7, socialLean: 0.3 }, // the merchant and farm-owner middle class
    high: { economicLean: 3.1, socialLean: -0.1 }, // grain, land and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 3.5, socialLean: 4.2 }, // Christian Coalition country alongside the South
    patriots: { economicLean: 2.7, socialLean: 3.2 }, // missile fields and airbases
    gunowners: { economicLean: 3.2, socialLean: 3.2 }, // universal rural ownership fused with national gun politics
    progressives: { economicLean: -4.9, socialLean: -4.7 }, // the surviving Farmers Union left
    environmentalists: { economicLean: -4.1, socialLean: -3.9 }, // soil and aquifer conservation
    libertarians: { economicLean: 4.4, socialLean: 0 }, // anti-federal constitutionalism
  },
};

/**
 * Mountain West and Alaska (MT ID WY CO UT NV AZ NM AK), 2007. The interior stays red
 * while CO, NV and NM flip on in-migration and Latino turnout; economics ease slightly
 * off the 1991 peak and the housing crash lands hardest in Nevada and Arizona.
 */
const MOUNTAIN_2007: PositionsBlock = {
  race: {
    white: { economicLean: 1.4, socialLean: 0.3 }, // the interior holds while CO, NV and NM flip on in-migration
    black: { economicLean: -4.6, socialLean: -2 }, // small urban populations in Denver, Phoenix and Las Vegas
    hispanic: { economicLean: -2.6, socialLean: -1.2 }, // New Mexico Hispanos and Arizona and Nevada service labor
  },
  education: {
    no_college: { economicLean: 4.8, socialLean: 1.1 }, // extraction and service labor with the unions mostly gone
    college: { economicLean: -0.9, socialLean: -2.3 }, // the professional tier of Denver, Salt Lake, Phoenix and Boise
    graduate: { economicLean: -3.1, socialLean: -4.4 }, // the national laboratories and state universities
  },
  wealth: {
    low: { economicLean: -2.7, socialLean: -0.5 }, // reservation and service-sector poverty
    middle: { economicLean: 1.3, socialLean: -0.3 }, // the housing crash has made this group economically insecure
    high: { economicLean: 3.3, socialLean: -0.3 }, // energy, mining and real-estate capital
  },
  ideology: {
    evangelicals: { economicLean: 3.4, socialLean: 4 }, // the LDS corridor plus Rocky Mountain fundamentalism
    patriots: { economicLean: 2.7, socialLean: 3 }, // the defense installations and a heavy veteran share
    gunowners: { economicLean: 3.3, socialLean: 3.2 }, // the region where federal firearms politics is most explosive
    progressives: { economicLean: -5, socialLean: -4.9 }, // a Denver, Boulder and Santa Fe minority
    environmentalists: { economicLean: -4.5, socialLean: -4.3 }, // wilderness and water politics against the property-rights movement
    libertarians: { economicLean: 4.3, socialLean: -0.2 }, // the movement's geographic heartland
  },
};

/**
 * Pacific coast (CA OR WA), 2007. Housing-bubble exposure pulls economics toward
 * neutral while the coast reaches its most socially liberal point in the file.
 */
const PACIFIC_2007: PositionsBlock = {
  race: {
    white: { economicLean: -0.7, socialLean: -2.6 }, // the most socially liberal white electorate in the file
    black: { economicLean: -4.7, socialLean: -2.5 }, // Los Angeles, Oakland and Seattle after the 1992 unrest
    hispanic: { economicLean: -3.2, socialLean: -2.3 }, // a fast-growing electorate, still under-registered before Proposition 187
  },
  education: {
    no_college: { economicLean: 4.2, socialLean: 0.1 }, // aerospace layoffs and inland timber, economically squeezed
    college: { economicLean: -1.8, socialLean: -3 }, // the coastal professional class, now reliably Democratic
    graduate: { economicLean: -4.1, socialLean: -5 }, // the University of California system and the software economy
  },
  wealth: {
    low: { economicLean: -3.1, socialLean: -1.2 }, // inner-city and farmworker poverty
    middle: { economicLean: 0, socialLean: -2.3 }, // bubble-exposed suburbs from the Inland Empire to Clark County
    high: { economicLean: 2.8, socialLean: -2.4 }, // entertainment, aerospace and early technology capital
  },
  ideology: {
    evangelicals: { economicLean: 2.3, socialLean: 3.6 }, // Orange County and Central Valley congregations against a liberal coast
    patriots: { economicLean: 2.1, socialLean: 2.4 }, // a shrinking defense economy
    gunowners: { economicLean: 2.2, socialLean: 2.4 }, // inland gun culture against coastal restriction
    progressives: { economicLean: -5, socialLean: -5 }, // the environmental and civil-rights left at its strongest
    environmentalists: { economicLean: -5, socialLean: -4.8 }, // the coast's defining political identity outside the cities
    libertarians: { economicLean: 4.3, socialLean: -1.6 }, // technology-boom individualism
  },
};

/**
 * Yankee New England (VT NH ME), 2007. New Hampshire's social identity has finally
 * flipped, Obama takes it by 10 in a state Bush won in 2000, and Vermont is his best
 * state outside DC and Hawaii.
 */
const YANKEE_2007: PositionsBlock = {
  race: {
    white: { economicLean: -1, socialLean: -2.4 }, // New Hampshire's social flip completes the region's inversion
    black: { economicLean: -4.5, socialLean: -2.1 }, // a very small population concentrated in the mill cities
    hispanic: { economicLean: -3.1, socialLean: -2.1 }, // small and concentrated in the same mill cities
  },
  education: {
    no_college: { economicLean: 3.8, socialLean: -0.3 }, // mill and quarry labor without a union structure, Perot's best audience
    college: { economicLean: -1.8, socialLean: -2.8 }, // the region's professional class, the most socially liberal in the file
    graduate: { economicLean: -4, socialLean: -5 }, // the New England college faculties
  },
  wealth: {
    low: { economicLean: -3, socialLean: -0.9 }, // rural hill poverty
    middle: { economicLean: 0.2, socialLean: -2.1 }, // the anti-tax small-town middle class, still New Hampshire's spine
    high: { economicLean: 2.8, socialLean: -2.2 }, // Boston-adjacent finance and second-home capital
  },
  ideology: {
    evangelicals: { economicLean: 1.8, socialLean: 3.3 }, // a small old-stock Protestant remnant
    patriots: { economicLean: 1.8, socialLean: 2.3 }, // town veterans' posts
    gunowners: { economicLean: 2.2, socialLean: 2.3 }, // deer season as civic ritual, only lightly partisan
    progressives: { economicLean: -5, socialLean: -5 }, // the Vermont left that will produce Dean and Sanders
    environmentalists: { economicLean: -5, socialLean: -4.5 }, // land-use and forest politics, electorally decisive
    libertarians: { economicLean: 4.2, socialLean: -1.4 }, // Live Free or Die constitutionalism
  },
};

/**
 * Hawaii, 2007. Obama's home state and his best state in the country at +46.
 */
const ISLANDS_2007: PositionsBlock = {
  race: {
    white: { economicLean: -3.8, socialLean: -3.8 }, // military and mainland-transplant households inside a Democratic state
    black: { economicLean: -4.7, socialLean: -2.7 }, // a small military-linked population
    hispanic: { economicLean: -3.1, socialLean: -2.5 }, // Filipino and Puerto Rican plantation descendants
  },
  education: {
    no_college: { economicLean: 1.4, socialLean: -1.5 }, // the hotel and dock workforce, the machine's base
    college: { economicLean: -2.4, socialLean: -3.9 }, // state civil service and the university
    graduate: { economicLean: -4.4, socialLean: -5 }, // a small professional stratum
  },
  wealth: {
    low: { economicLean: -3.6, socialLean: -1.7 }, // service-sector and camp-housing poverty
    middle: { economicLean: -2, socialLean: -3.3 }, // the civil-service and small-business class the ILWU machine built
    high: { economicLean: 1.4, socialLean: -3.3 }, // tourism and Japanese investment capital
  },
  ideology: {
    evangelicals: { economicLean: 1, socialLean: 1.9 }, // missionary-descended congregations, a minority
    patriots: { economicLean: 0.6, socialLean: 0.7 }, // Pearl Harbor and a heavy military presence
    gunowners: { economicLean: 0.8, socialLean: 0.7 }, // outer-island hunting, a minor identity
    progressives: { economicLean: -5, socialLean: -5 }, // the ILWU political machine
    environmentalists: { economicLean: -5, socialLean: -4.9 }, // reef and land conservation against resort development
    libertarians: { economicLean: 3.4, socialLean: -2.1 }, // small-trader independence, marginal
  },
};

/**
 * District of Columbia, 2007. Obama by 87 points; the economic left pole of the file.
 */
const CAPITAL_2007: PositionsBlock = {
  race: {
    white: { economicLean: -5, socialLean: -3.6 }, // federal professionals and gentrifiers in a Black-majority city
    black: { economicLean: -5, socialLean: -2 }, // the most Democratic electorate in the country
    hispanic: { economicLean: -4.6, socialLean: -2.4 }, // a growing Salvadoran population in Columbia Heights
  },
  education: {
    no_college: { economicLean: -3.2, socialLean: -0.8 }, // the federal service and hospitality workforce
    college: { economicLean: -5, socialLean: -3.9 }, // the career civil service
    graduate: { economicLean: -5, socialLean: -5 }, // the agency, think-tank and law professional class
  },
  wealth: {
    low: { economicLean: -5, socialLean: -1.2 }, // concentrated urban poverty in the crack-epidemic years
    middle: { economicLean: -5, socialLean: -3 }, // the federal grade-scale middle class
    high: { economicLean: -2.5, socialLean: -3.1 }, // law, lobbying and federal contracting
  },
  ideology: {
    evangelicals: { economicLean: -3.3, socialLean: 2.6 }, // Black Baptist congregations: socially traditional, economically left
    patriots: { economicLean: -3.5, socialLean: 1.2 }, // the military and veterans' bureaucracy
    gunowners: { economicLean: -3.3, socialLean: 1.4 }, // marginal under the handgun ban
    progressives: { economicLean: -5, socialLean: -5 }, // the city's civil-rights and public-employee left
    environmentalists: { economicLean: -5, socialLean: -5 }, // the federal environmental bureaucracy's home
    libertarians: { economicLean: 1, socialLean: -1.9 }, // a think-tank minority
  },
};

/**
 * 2007-era US state census profiles (Layer 1 demographics).
 *
 * Era anchor: 2006–2008 American Community Survey estimates, hand-authored
 * independently per state — values are NOT derived from or scaled against the
 * 2019 dataset in `stateCensusData.ts`; that file was consulted only for the
 * field shape and ideology-scale conventions.
 *
 * Key national reference points circa 2007:
 * - Race mix: White ~66%, Black ~12%, Hispanic ~15%, Asian ~4.4%.
 * - Bachelor's degree or higher ~28% (markedly below 2019 levels).
 * - Median age ~36.5; Baby Boomers still mostly working-age, so senior
 *   shares run lower and mid/mature shares higher than 2019.
 * - Pre-crash housing-boom prosperity inflates middle/high wealth shares in
 *   Sun Belt boom states (NV, AZ, FL) and depresses "low" shares there.
 * - Politics: Iraq-War polarization, evangelical political power near its
 *   peak (post-2004 values-voter era), environmentalism rising but not yet
 *   mainstream (An Inconvenient Truth era), libertarian streak visible in
 *   the Mountain West, Hispanic growth accelerating in the Southwest and
 *   Southeast but still below 2019 shares.
 *
 * Ideology values are independent shares of the population (do not sum
 * to 100); race, education, wealth, and age each sum to exactly 100.
 */
export const stateCensusData2007: Record<string, Layer1Config> = {
  AK: {
    race: { white: 67, black: 4, hispanic: 6, asian: 5, other: 18 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 27, mid: 29, mature: 27, senior: 17 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 12,
      progressives: 11,
      patriots: 8,
      gunowners: 18,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, 1.2, 0.8), // Obama -22 with Palin on the ticket
  },
  AL: {
    race: { white: 70, black: 26, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 28,
      environmentalists: 6,
      libertarians: 4,
      progressives: 10,
      patriots: 8,
      gunowners: 14,
    },
    positions: DEEP_SOUTH_2007,
  },
  AR: {
    race: { white: 76, black: 16, hispanic: 5, asian: 1, other: 2 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 26, mature: 28, senior: 22 },
    ideology: {
      evangelicals: 27,
      environmentalists: 6,
      libertarians: 5,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: DEEP_SOUTH_2007,
  },
  AZ: {
    race: { white: 60, black: 4, hispanic: 29, asian: 2, other: 5 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 8,
      progressives: 13,
      patriots: 6,
      gunowners: 12,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, -0.1, 0.4), // Obama -8.6, suppressed by McCain's home-state effect
  },
  CA: {
    race: { white: 43, black: 6, hispanic: 36, asian: 12, other: 3 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 50, high: 24 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 16,
      libertarians: 5,
      progressives: 21,
      patriots: 3,
      gunowners: 6,
    },
    positions: PACIFIC_2007,
  },
  CO: {
    race: { white: 72, black: 4, hispanic: 20, asian: 3, other: 1 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 26, mid: 29, mature: 27, senior: 18 },
    ideology: {
      evangelicals: 13,
      environmentalists: 15,
      libertarians: 8,
      progressives: 16,
      patriots: 5,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, -1.1, -0.3), // Obama +9: the Mountain in-migration story completed
  },
  CT: {
    race: { white: 74, black: 9, hispanic: 11, asian: 4, other: 2 },
    education: { no_college: 52, college: 29, graduate: 19 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 5,
      progressives: 20,
      patriots: 3,
      gunowners: 5,
    },
    positions: MID_ATLANTIC_2007,
  },
  DC: {
    race: { white: 34, black: 55, hispanic: 8, asian: 3, other: 0 },
    education: { no_college: 44, college: 26, graduate: 30 },
    wealth: { low: 32, middle: 42, high: 26 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 14,
      libertarians: 3,
      progressives: 30,
      patriots: 2,
      gunowners: 2,
    },
    positions: CAPITAL_2007,
  },
  DE: {
    race: { white: 68, black: 21, hispanic: 6, asian: 3, other: 2 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 9,
      environmentalists: 13,
      libertarians: 5,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
    positions: shiftRegionPositions(BORDER_2007, -2.1, -2.1), // Obama +25 with Biden on the ticket
  },
  FL: {
    race: { white: 61, black: 15, hispanic: 20, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 23, mid: 26, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 6,
      progressives: 14,
      patriots: 6,
      gunowners: 9,
    },
    positions: shiftRegionPositions(BORDER_2007, -0.7, -0.1), // Obama +3
  },
  GA: {
    race: { white: 59, black: 30, hispanic: 8, asian: 3, other: 0 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 27, mid: 29, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 24,
      environmentalists: 7,
      libertarians: 5,
      progressives: 13,
      patriots: 7,
      gunowners: 12,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_2007, -0.9, -0.4), // Obama -5 as metro Atlanta grows
  },
  HI: {
    race: { white: 25, black: 2, hispanic: 9, asian: 41, other: 23 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 8,
      environmentalists: 16,
      libertarians: 4,
      progressives: 20,
      patriots: 3,
      gunowners: 3,
    },
    positions: ISLANDS_2007,
  },
  IA: {
    race: { white: 91, black: 2, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 6,
      progressives: 13,
      patriots: 5,
      gunowners: 10,
    },
    positions: GREAT_LAKES_2007,
  },
  ID: {
    race: { white: 86, black: 1, hispanic: 10, asian: 1, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 20,
      environmentalists: 9,
      libertarians: 11,
      progressives: 8,
      patriots: 8,
      gunowners: 18,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, 0.8, 2.4), // Obama -26
  },
  IL: {
    race: { white: 65, black: 15, hispanic: 15, asian: 4, other: 1 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 11,
      environmentalists: 12,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
    positions: shiftRegionPositions(GREAT_LAKES_2007, -0.9, -0.5), // Obama +25 in his home state
  },
  IN: {
    race: { white: 84, black: 9, hispanic: 5, asian: 1, other: 1 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 21,
      environmentalists: 7,
      libertarians: 6,
      progressives: 11,
      patriots: 7,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_2007, 0.4, 1.5), // Obama +1 over a socially conservative white electorate: economics carried it
  },
  KS: {
    race: { white: 81, black: 6, hispanic: 9, asian: 2, other: 2 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 19,
      environmentalists: 8,
      libertarians: 8,
      progressives: 10,
      patriots: 7,
      gunowners: 13,
    },
    positions: PLAINS_2007,
  },
  KY: {
    race: { white: 88, black: 7, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 26,
      environmentalists: 6,
      libertarians: 5,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.2, 0.9), // Obama -16
  },
  LA: {
    race: { white: 63, black: 32, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 6,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 14,
    },
    positions: DEEP_SOUTH_2007,
  },
  MA: {
    race: { white: 80, black: 6, hispanic: 8, asian: 5, other: 1 },
    education: { no_college: 48, college: 30, graduate: 22 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 4,
      environmentalists: 16,
      libertarians: 4,
      progressives: 22,
      patriots: 3,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_2007, -0.3, -0.3), // Obama +26
  },
  MD: {
    race: { white: 58, black: 29, hispanic: 6, asian: 5, other: 2 },
    education: { no_college: 52, college: 28, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 9,
      environmentalists: 14,
      libertarians: 4,
      progressives: 21,
      patriots: 4,
      gunowners: 5,
    },
    positions: shiftRegionPositions(BORDER_2007, -2.1, -1.8), // Obama +26
  },
  ME: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 21, mid: 24, mature: 29, senior: 26 },
    ideology: {
      evangelicals: 7,
      environmentalists: 15,
      libertarians: 7,
      progressives: 15,
      patriots: 5,
      gunowners: 9,
    },
    positions: YANKEE_2007,
  },
  MI: {
    race: { white: 79, black: 14, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 26, mature: 28, senior: 22 },
    ideology: {
      evangelicals: 15,
      environmentalists: 11,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: shiftRegionPositions(GREAT_LAKES_2007, -0.4, 0), // Obama +17 as the auto industry collapses
  },
  MN: {
    race: { white: 86, black: 4, hispanic: 4, asian: 3, other: 3 },
    education: { no_college: 54, college: 31, graduate: 15 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 13,
      environmentalists: 14,
      libertarians: 6,
      progressives: 17,
      patriots: 4,
      gunowners: 10,
    },
    positions: shiftRegionPositions(GREAT_LAKES_2007, -0.1, -0.3), // Obama +10
  },
  MO: {
    race: { white: 83, black: 11, hispanic: 3, asian: 1, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 21,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 6,
      gunowners: 13,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.6, -0.2), // McCain by 0.1 as the bellwether finally breaks
  },
  MS: {
    race: { white: 59, black: 37, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 30,
      environmentalists: 5,
      libertarians: 3,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_2007, -0.6, -0.1), // Obama -13 on the largest Black electorate share in the country
  },
  MT: {
    race: { white: 89, black: 0, hispanic: 2, asian: 1, other: 8 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 23, mid: 25, mature: 29, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 13,
      libertarians: 10,
      progressives: 11,
      patriots: 8,
      gunowners: 19,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, -0.7, -0.8), // Obama -2.4, the closest Mountain state McCain held
  },
  NC: {
    race: { white: 67, black: 21, hispanic: 7, asian: 2, other: 3 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 23,
      environmentalists: 8,
      libertarians: 5,
      progressives: 12,
      patriots: 7,
      gunowners: 12,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.6, -0.4), // Obama +0.3 on Research Triangle and Charlotte growth
  },
  ND: {
    race: { white: 91, black: 1, hispanic: 2, asian: 1, other: 5 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 15,
      environmentalists: 8,
      libertarians: 7,
      progressives: 10,
      patriots: 6,
      gunowners: 14,
    },
    positions: PLAINS_2007,
  },
  NE: {
    race: { white: 86, black: 4, hispanic: 8, asian: 1, other: 1 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 17,
      environmentalists: 8,
      libertarians: 7,
      progressives: 10,
      patriots: 6,
      gunowners: 12,
    },
    positions: PLAINS_2007,
  },
  NH: {
    race: { white: 94, black: 1, hispanic: 2, asian: 2, other: 1 },
    education: { no_college: 52, college: 31, graduate: 17 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 23, mid: 26, mature: 29, senior: 22 },
    ideology: {
      evangelicals: 5,
      environmentalists: 13,
      libertarians: 11,
      progressives: 15,
      patriots: 4,
      gunowners: 9,
    },
    positions: shiftRegionPositions(YANKEE_2007, 0.6, 2.2), // Obama +10 in a state Bush won in 2000: the file's most instructive move
  },
  NJ: {
    race: { white: 61, black: 13, hispanic: 16, asian: 8, other: 2 },
    education: { no_college: 52, college: 29, graduate: 19 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 4,
      progressives: 20,
      patriots: 4,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_2007, 0.2, 0.6), // Obama +16
  },
  NM: {
    race: { white: 42, black: 2, hispanic: 44, asian: 1, other: 11 },
    education: { no_college: 60, college: 25, graduate: 15 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 6,
      progressives: 15,
      patriots: 6,
      gunowners: 12,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, -2.3, -2), // Obama +15 on Latino turnout
  },
  NV: {
    race: { white: 60, black: 7, hispanic: 25, asian: 6, other: 2 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 11,
      environmentalists: 9,
      libertarians: 9,
      progressives: 13,
      patriots: 5,
      gunowners: 11,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, -1.4, -1.8), // Obama +13 where the housing crash hit hardest
  },
  NY: {
    race: { white: 60, black: 15, hispanic: 16, asian: 7, other: 2 },
    education: { no_college: 54, college: 27, graduate: 19 },
    wealth: { low: 28, middle: 48, high: 24 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 4,
      progressives: 21,
      patriots: 3,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_2007, -0.5, -0.4), // Obama +27
  },
  OH: {
    race: { white: 83, black: 12, hispanic: 2, asian: 2, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 17,
      environmentalists: 9,
      libertarians: 5,
      progressives: 13,
      patriots: 6,
      gunowners: 11,
    },
    positions: shiftRegionPositions(GREAT_LAKES_2007, 0.5, 1.1), // Obama +5: deindustrialization moves economics left while social stays right
  },
  OK: {
    race: { white: 74, black: 8, hispanic: 7, asian: 2, other: 9 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 28,
      environmentalists: 5,
      libertarians: 6,
      progressives: 8,
      patriots: 9,
      gunowners: 16,
    },
    positions: shiftRegionPositions(BORDER_2007, 1.1, 1.5), // Obama -31 without carrying a single county
  },
  OR: {
    race: { white: 83, black: 2, hispanic: 10, asian: 4, other: 1 },
    education: { no_college: 56, college: 29, graduate: 15 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 18,
      libertarians: 8,
      progressives: 18,
      patriots: 4,
      gunowners: 10,
    },
    positions: shiftRegionPositions(PACIFIC_2007, -0.4, 0), // Obama +17
  },
  PA: {
    race: { white: 82, black: 10, hispanic: 4, asian: 2, other: 2 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_2007, 0.8, 0.5), // Obama +10
  },
  RI: {
    race: { white: 79, black: 5, hispanic: 11, asian: 3, other: 2 },
    education: { no_college: 56, college: 27, graduate: 17 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 25, mid: 26, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 4,
      progressives: 20,
      patriots: 3,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_2007, -0.6, -0.1), // Obama +28
  },
  SC: {
    race: { white: 66, black: 29, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 26,
      environmentalists: 7,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 13,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_2007, -0.5, 0), // Obama -9
  },
  SD: {
    race: { white: 87, black: 1, hispanic: 2, asian: 1, other: 9 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 24, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 18,
      environmentalists: 8,
      libertarians: 7,
      progressives: 9,
      patriots: 7,
      gunowners: 15,
    },
    positions: PLAINS_2007,
  },
  TN: {
    race: { white: 78, black: 17, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 64, college: 24, graduate: 12 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 27,
      environmentalists: 6,
      libertarians: 5,
      progressives: 10,
      patriots: 8,
      gunowners: 13,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.3, 0.9), // Obama -15
  },
  TX: {
    race: { white: 48, black: 11, hispanic: 36, asian: 3, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 21,
      environmentalists: 7,
      libertarians: 6,
      progressives: 12,
      patriots: 7,
      gunowners: 13,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.5, 1.1), // Obama -12 with the white value well right of it
  },
  UT: {
    race: { white: 84, black: 1, hispanic: 11, asian: 2, other: 2 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 35, mid: 28, mature: 23, senior: 14 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 12,
      progressives: 8,
      patriots: 7,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, 1, 4.2), // Obama -29 and unmoved on the social axis across all five eras
  },
  VA: {
    race: { white: 67, black: 19, hispanic: 7, asian: 5, other: 2 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 18,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 6,
      gunowners: 10,
    },
    positions: shiftRegionPositions(BORDER_2007, -0.9, -0.2), // Obama +6, the first Democratic win since 1964, driven by Northern Virginia
  },
  VT: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 22, mid: 24, mature: 30, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 22,
      libertarians: 7,
      progressives: 23,
      patriots: 3,
      gunowners: 8,
    },
    positions: shiftRegionPositions(YANKEE_2007, -1.1, -0.9), // Obama +38, his best state outside DC and Hawaii
  },
  WA: {
    race: { white: 78, black: 3, hispanic: 9, asian: 7, other: 3 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 11,
      environmentalists: 17,
      libertarians: 7,
      progressives: 18,
      patriots: 4,
      gunowners: 9,
    },
    positions: PACIFIC_2007,
  },
  WI: {
    race: { white: 86, black: 6, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 11,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 11,
    },
    positions: GREAT_LAKES_2007,
  },
  WV: {
    race: { white: 94, black: 3, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 38, middle: 50, high: 12 },
    age: { young: 22, mid: 25, mature: 29, senior: 24 },
    ideology: {
      evangelicals: 24,
      environmentalists: 6,
      libertarians: 4,
      progressives: 9,
      patriots: 9,
      gunowners: 16,
    },
    positions: shiftRegionPositions(BORDER_2007, 0.2, 0.9), // Obama -13: the counter-swing is social, so economics stay left of the region
  },
  WY: {
    race: { white: 90, black: 1, hispanic: 7, asian: 1, other: 1 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 12,
      progressives: 8,
      patriots: 9,
      gunowners: 20,
    },
    positions: shiftRegionPositions(MOUNTAIN_2007, 1.3, 0.6), // Obama -33: the country's most Republican state in 2008
  },
};
