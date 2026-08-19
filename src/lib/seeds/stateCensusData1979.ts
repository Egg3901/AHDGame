import type { Layer1Config } from "./stateDemographics";
import { shiftRegionPositions, type PositionsBlock } from "./regionalPositions";

/**
 * Deep South (AL MS SC LA GA AR), 1979. The Sunbelt boom, right-to-work law and
 * the end of federal dependence flip white economics right for the first time; the
 * state means stay competitive only because a quarter of the electorate is Black
 * and votes the other way. Socially the region is still the traditional ceiling.
 */
const DEEP_SOUTH_1979: PositionsBlock = {
  race: {
    white: { economicLean: 1.6, socialLean: 1.5 }, // realigned on economics by the Sunbelt boom, unmoved on the social axis
    black: { economicLean: -5, socialLean: -1.6 }, // post-Voting Rights Act mobilization: the era's most consolidated Democratic bloc
    hispanic: { economicLean: -3.8, socialLean: -2 }, // Gulf Coast and Delta farm labor, weakly registered
  },
  education: {
    no_college: { economicLean: 0.3, socialLean: 0.9 }, // working-class whites here realigned earlier and harder than northern Reagan Democrats
    college: { economicLean: -2.6, socialLean: -3.5 }, // the region's growing metro professional class, its least traditional white cell
    graduate: { economicLean: -3.4, socialLean: -4.6 }, // university and research-triangle professionals, a national rather than regional cell
  },
  wealth: {
    low: { economicLean: -4.2, socialLean: -0.2 }, // the poorest electorate in the country, disproportionately Black
    middle: { economicLean: -0.1, socialLean: -0.1 }, // small-metro Chamber of Commerce plus church
    high: { economicLean: 1.7, socialLean: 0.3 }, // the new Sunbelt developer and energy capital
  },
  ideology: {
    evangelicals: { economicLean: 2.8, socialLean: 2.5 }, // the Moral Majority's founding constituency, mobilizing this year
    patriots: { economicLean: 2.9, socialLean: 2.1 }, // the region's military bases and the post-Vietnam patriotic revival
    gunowners: { economicLean: 2.7, socialLean: 1.7 }, // the NRA's political turn lands on an already armed rural culture
    progressives: { economicLean: -4.9, socialLean: -5 }, // a small biracial coalition around the civil-rights organizations
    environmentalists: { economicLean: -4.2, socialLean: -4.4 }, // coastal and river conservation, a minority position
    libertarians: { economicLean: 4.4, socialLean: 0.4 }, // anti-regulation business conservatism in the right-to-work states
  },
};

/**
 * Border and peripheral South (VA NC TN FL TX OK KY MO WV MD DE), 1979. The same
 * trajectory running a step behind: oil-patch and military-suburban Republicans in
 * TX/OK/FL/VA over lingering New Deal Democrats in Appalachia.
 */
const BORDER_1979: PositionsBlock = {
  race: {
    white: { economicLean: 1.3, socialLean: 1.3 }, // oil-patch and military suburbs pulling right, Appalachian New Deal Democrats holding
    black: { economicLean: -4.9, socialLean: -1.9 }, // urban Black electorates now fully registered and heavily Democratic
    hispanic: { economicLean: -3.9, socialLean: -2.1 }, // south Texas and Oklahoma: Democratic, Catholic, socially traditional
  },
  education: {
    no_college: { economicLean: -0.3, socialLean: 0.8 }, // coal, tobacco and textile labor, the last economically Democratic white bloc here
    college: { economicLean: -2.8, socialLean: -3.3 }, // the metro professional tier of Atlanta's northern neighbors
    graduate: { economicLean: -3.5, socialLean: -4.6 }, // federal and university payrolls from Norfolk to Oak Ridge
  },
  wealth: {
    low: { economicLean: -4.2, socialLean: -0.5 }, // Appalachian and Ozark poverty, still inside the New Deal coalition
    middle: { economicLean: -0.5, socialLean: -0.2 }, // county-seat merchants and the military middle class
    high: { economicLean: 1.5, socialLean: 0.1 }, // energy, tobacco and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 2.4, socialLean: 3 }, // Southern Baptist mobilization one notch behind the Deep South
    patriots: { economicLean: 2.6, socialLean: 2.4 }, // the country's heaviest concentration of military installations
    gunowners: { economicLean: 2.6, socialLean: 2 }, // hunting culture fusing with the new gun politics
    progressives: { economicLean: -5, socialLean: -5 }, // the region's civil-rights and labor left
    environmentalists: { economicLean: -4.2, socialLean: -4.5 }, // strip-mining and river conservation fights
    libertarians: { economicLean: 4.5, socialLean: 0.2 }, // anti-tax, anti-Washington business conservatism
  },
};

/**
 * Industrial Northeast (MA RI CT NY NJ PA), 1979. Union density still high and the
 * last place economic liberalism is a majority white position, but busing, crime
 * and abortion have cut hard into the ethnic Catholic bloc.
 */
const MID_ATLANTIC_1979: PositionsBlock = {
  race: {
    white: { economicLean: 2.5, socialLean: 0.9 }, // Rockefeller Republicans collapsing; Catholic ethnics still New Deal on economics
    black: { economicLean: -4.8, socialLean: -2.3 }, // the Democratic coalition's urban core at peak organizational strength
    hispanic: { economicLean: -3.8, socialLean: -2.1 }, // Puerto Rican and Dominican New York, machine-connected and economically left
  },
  education: {
    no_college: { economicLean: 0.1, socialLean: 0.6 }, // union residue delays the economic right turn that busing has already started socially
    college: { economicLean: -2.3, socialLean: -3.3 }, // the suburban professional class moving left on culture
    graduate: { economicLean: -3.5, socialLean: -4.6 }, // the Northeast academic and media professions, the era's liberal pole
  },
  wealth: {
    low: { economicLean: -4, socialLean: -1.1 }, // the deindustrializing urban poor
    middle: { economicLean: 0.3, socialLean: -0.8 }, // the tax-revolt suburb without the Sunbelt's social traditionalism
    high: { economicLean: 2.4, socialLean: -1.3 }, // finance and corporate capital, economically right and socially indifferent
  },
  ideology: {
    evangelicals: { economicLean: 2.7, socialLean: 2.8 }, // present but small and not yet fused to the Republican coalition
    patriots: { economicLean: 3.3, socialLean: 2.8 }, // ethnic Catholic Cold War patriotism, the Reagan Democrat's other half
    gunowners: { economicLean: 3.3, socialLean: 2.4 }, // sporting clubs plus a growing urban-crime politics
    progressives: { economicLean: -4.7, socialLean: -5 }, // the region's labor-left and reform-Democratic tradition
    environmentalists: { economicLean: -4.4, socialLean: -4.8 }, // post-Earth Day environmentalism at its organizational peak
    libertarians: { economicLean: 4.8, socialLean: -0.8 }, // a thin anti-tax minority
  },
};

/**
 * Great Lakes (OH IN IL MI WI MN IA), 1979. Peak-late industrial unionism with the
 * rust starting to show. The Reagan Democrat is being manufactured here: centre-left
 * on bread, moving right on race, crime and taxes.
 */
const GREAT_LAKES_1979: PositionsBlock = {
  race: {
    white: { economicLean: 1.9, socialLean: 0.8 }, // Reagan Democrats: union households moving right on race, crime and taxes
    black: { economicLean: -5, socialLean: -2.3 }, // Detroit, Cleveland and Chicago at the center of the Democratic coalition
    hispanic: { economicLean: -3.8, socialLean: -2.1 }, // Chicago and the steel towns, union-organized
  },
  education: {
    no_college: { economicLean: 0.2, socialLean: 0.5 }, // the Reagan Democrat cell proper, still left of southern no-college whites
    college: { economicLean: -2.4, socialLean: -3.4 }, // the suburban professional tier, socially liberalizing
    graduate: { economicLean: -3.7, socialLean: -4.6 }, // Big Ten faculty and research staff
  },
  wealth: {
    low: { economicLean: -4.4, socialLean: -1.2 }, // auto and steel layoffs arriving; economic anxiety without a partisan home
    middle: { economicLean: -0.2, socialLean: -0.9 }, // the union homeowner's tax revolt
    high: { economicLean: 2.1, socialLean: -1 }, // manufacturing capital under import pressure
  },
  ideology: {
    evangelicals: { economicLean: 2.7, socialLean: 2.6 }, // an organizing but not yet dominant bloc in the rural tier
    patriots: { economicLean: 3, socialLean: 2.5 }, // veterans' organizations and the Legion halls of a heavily drafted region
    gunowners: { economicLean: 3, socialLean: 2 }, // the northern hunting belt, newly politicized
    progressives: { economicLean: -4.9, socialLean: -5 }, // La Follette and DFL residue plus the campus left
    environmentalists: { economicLean: -4.4, socialLean: -4.8 }, // Great Lakes cleanup politics, a mass constituency
    libertarians: { economicLean: 4.5, socialLean: -0.4 }, // a small-business anti-regulation minority
  },
};

/**
 * Plains (ND SD NE KS), 1979. Anti-government economics intact and the farm credit
 * boom still on; the crisis that radicalizes this region is three years away.
 */
const PLAINS_1979: PositionsBlock = {
  race: {
    white: { economicLean: 3.7, socialLean: 1.6 }, // the Republican floor: farm ownership, anti-Washington economics, dry Protestantism
    black: { economicLean: -4.5, socialLean: -2.2 }, // small urban populations in Omaha, Wichita and Kansas City
    hispanic: { economicLean: -3.3, socialLean: -1.8 }, // meatpacking and railroad labor, thinly registered
  },
  education: {
    no_college: { economicLean: 0.7, socialLean: 0.6 }, // no union structure to pull the farm and small-town workforce left
    college: { economicLean: -1.8, socialLean: -3.1 }, // land-grant graduates in county business and agriculture
    graduate: { economicLean: -3.1, socialLean: -4.3 }, // extension service and university staff
  },
  wealth: {
    low: { economicLean: -3.5, socialLean: -1 }, // farm tenancy and small-town poverty, weakly organized
    middle: { economicLean: 0.9, socialLean: -0.2 }, // the merchant and farm-owner middle class, the region's Republican spine
    high: { economicLean: 2.5, socialLean: -0.3 }, // grain, land and banking capital
  },
  ideology: {
    evangelicals: { economicLean: 3.8, socialLean: 3.4 }, // Moral Majority country: a Southern and Plains phenomenon first
    patriots: { economicLean: 3.7, socialLean: 2.8 }, // Cold War patriotism over missile fields and airbases
    gunowners: { economicLean: 3.7, socialLean: 2.4 }, // universal rural ownership fusing with national gun politics
    progressives: { economicLean: -4.5, socialLean: -5 }, // Farmers Union and the surviving prairie-populist left
    environmentalists: { economicLean: -3.7, socialLean: -4.2 }, // soil and water conservation, a working-farmer concern
    libertarians: { economicLean: 4.6, socialLean: 0.1 }, // anti-federal constitutionalism, the region's default rhetoric
  },
};

/**
 * Mountain West and Alaska (MT ID WY CO UT NV AZ NM AK), 1979. The Sagebrush
 * Rebellion is literally this year: federal land management is the defining regional
 * grievance and the region is the country's economic right pole.
 */
const MOUNTAIN_1979: PositionsBlock = {
  race: {
    white: { economicLean: 3.8, socialLean: 1.7 }, // Sagebrush Rebellion economics: public lands, extraction and defense
    black: { economicLean: -4.5, socialLean: -2.2 }, // small urban populations in Denver, Phoenix and Las Vegas
    hispanic: { economicLean: -3.3, socialLean: -1.4 }, // New Mexico Hispanos and Arizona farm labor: Democratic and socially traditional
  },
  education: {
    no_college: { economicLean: 0.8, socialLean: 0.7 }, // mine, ranch and service labor with a thinning extractive-union tradition
    college: { economicLean: -1.8, socialLean: -3 }, // the professional tier of Denver, Salt Lake and Phoenix
    graduate: { economicLean: -3.2, socialLean: -4.3 }, // the national laboratories and state universities
  },
  wealth: {
    low: { economicLean: -3.8, socialLean: -0.9 }, // reservation and migrant poverty
    middle: { economicLean: 1.2, socialLean: -0.1 }, // property-assessment inflation makes the tax revolt a live grievance here
    high: { economicLean: 2.7, socialLean: -0.2 }, // energy, mining and land capital
  },
  ideology: {
    evangelicals: { economicLean: 3.4, socialLean: 3 }, // the LDS corridor plus Rocky Mountain fundamentalism
    patriots: { economicLean: 3.7, socialLean: 2.8 }, // defense installations and the missile fields
    gunowners: { economicLean: 3.8, socialLean: 2.4 }, // public-lands hunting and the federal-firearms backlash
    progressives: { economicLean: -4.7, socialLean: -5 }, // a small urban-Denver and university left
    environmentalists: { economicLean: -4.2, socialLean: -4.5 }, // wilderness and water politics, the Rebellion's antagonist
    libertarians: { economicLean: 4.6, socialLean: -0.1 }, // the movement's geographic heartland
  },
};

/**
 * Pacific coast (CA OR WA), 1979. Proposition 13 pulls economics sharply right at
 * exactly the moment social liberalism becomes a mass position: the cleanest case in
 * the series of the two axes moving in opposite directions in one electorate.
 */
const PACIFIC_1979: PositionsBlock = {
  race: {
    white: { economicLean: 3.1, socialLean: -0.3 }, // Proposition 13 economics over a coast already liberalizing socially
    black: { economicLean: -4.6, socialLean: -2.5 }, // Oakland, Los Angeles and Seattle, strongly Democratic
    hispanic: { economicLean: -3.6, socialLean: -2.3 }, // the post-1965 Mexican migration, still lightly registered
  },
  education: {
    no_college: { economicLean: 0.6, socialLean: -0.6 }, // aerospace, timber and longshore labor, inland rather than coastal
    college: { economicLean: -2.1, socialLean: -3.4 }, // the coastal professional class, the era's socially liberal vanguard
    graduate: { economicLean: -3.6, socialLean: -4.7 }, // the University of California system and the research economy
  },
  wealth: {
    low: { economicLean: -3.8, socialLean: -1.4 }, // farmworker and inner-city poverty
    middle: { economicLean: 1.2, socialLean: -1.6 }, // the suburban tax revolt without Southern social traditionalism
    high: { economicLean: 2.8, socialLean: -1.8 }, // aerospace, entertainment and agribusiness capital
  },
  ideology: {
    evangelicals: { economicLean: 2.8, socialLean: 2.6 }, // Orange County and Central Valley congregations, a real but regional bloc
    patriots: { economicLean: 3.5, socialLean: 2.5 }, // the defense economy and a large veteran population
    gunowners: { economicLean: 3.5, socialLean: 2.1 }, // rural and inland gun culture against a liberalizing coast
    progressives: { economicLean: -4.8, socialLean: -5 }, // the environmental and antiwar left at its organizational height
    environmentalists: { economicLean: -4.6, socialLean: -5 }, // the coast's defining political identity outside the cities
    libertarians: { economicLean: 4.6, socialLean: -1.3 }, // growth-boom individualism, socially permissive
  },
};

/**
 * Yankee New England (VT NH ME), 1979. The no-broad-based-tax pledge is now civic
 * identity while counterculture in-migration has already started the social
 * inversion; Anderson's 15% in VT is that bloc with nowhere to go.
 */
const YANKEE_1979: PositionsBlock = {
  race: {
    white: { economicLean: 2.8, socialLean: -0.1 }, // the no-broad-based-tax pledge as civic identity, with the social inversion beginning
    black: { economicLean: -4.2, socialLean: -2.1 }, // a very small population concentrated in the mill cities
    hispanic: { economicLean: -3.4, socialLean: -2.1 }, // negligible outside the mill towns
  },
  education: {
    no_college: { economicLean: 0.1, socialLean: -0.4 }, // quarry, mill and hill-farm labor without a strong union structure
    college: { economicLean: -2.3, socialLean: -3.2 }, // the region's professional class, socially the most liberal in the file
    graduate: { economicLean: -3.7, socialLean: -4.5 }, // the New England college faculties
  },
  wealth: {
    low: { economicLean: -3.9, socialLean: -1.3 }, // rural hill poverty, weakly organized
    middle: { economicLean: 0.9, socialLean: -1.4 }, // the anti-tax suburban and small-town middle class
    high: { economicLean: 2.6, socialLean: -1.6 }, // Boston-adjacent finance and summer-resident capital
  },
  ideology: {
    evangelicals: { economicLean: 2.1, socialLean: 2.6 }, // a small old-stock Protestant remnant, not a mobilized bloc
    patriots: { economicLean: 3, socialLean: 2.6 }, // town veterans' posts and a long militia tradition
    gunowners: { economicLean: 3.1, socialLean: 2.2 }, // deer season as civic ritual, only lightly partisan
    progressives: { economicLean: -4.9, socialLean: -5 }, // counterculture in-migration is building the modern Vermont left
    environmentalists: { economicLean: -4.6, socialLean: -4.9 }, // land-use and forest politics, already electorally decisive
    libertarians: { economicLean: 4.7, socialLean: -1.1 }, // Live Free or Die constitutionalism
  },
};

/**
 * Hawaii, 1979. The ILWU-founded Democratic machine at full strength: economically
 * the furthest left electorate in the country and a Carter state in 1980.
 */
const ISLANDS_1979: PositionsBlock = {
  race: {
    white: { economicLean: -2.6, socialLean: -0.5 }, // military and mainland-transplant households against a Democratic machine
    black: { economicLean: -4.9, socialLean: -2.4 }, // a small military-linked population
    hispanic: { economicLean: -3.9, socialLean: -2.2 }, // Filipino and Puerto Rican plantation descendants inside the ILWU
  },
  education: {
    no_college: { economicLean: -3.8, socialLean: -0.9 }, // the hotel, dock and plantation workforce, the machine's base
    college: { economicLean: -3.9, socialLean: -3.4 }, // state civil service and the university
    graduate: { economicLean: -4.9, socialLean: -4.7 }, // a small professional stratum around the university
  },
  wealth: {
    low: { economicLean: -5, socialLean: -1.6 }, // plantation-camp and service-sector poverty
    middle: { economicLean: -3.2, socialLean: -1.7 }, // the Nisei small-business and civil-service class the machine built
    high: { economicLean: 0.2, socialLean: -1.8 }, // the surviving Big Five and tourism capital
  },
  ideology: {
    evangelicals: { economicLean: 0.3, socialLean: 2.1 }, // missionary-descended congregations, a small minority
    patriots: { economicLean: 0.7, socialLean: 1.9 }, // Pearl Harbor, the 442nd and a heavy military presence
    gunowners: { economicLean: 0.7, socialLean: 1.5 }, // outer-island hunting, a minor identity
    progressives: { economicLean: -5, socialLean: -5 }, // the ILWU political machine that runs the state
    environmentalists: { economicLean: -5, socialLean: -4.8 }, // land and reef conservation against resort development
    libertarians: { economicLean: 3.5, socialLean: -1.3 }, // small-trader independence, marginal
  },
};

/**
 * District of Columbia, 1979. Federal payroll, a Black majority, and the largest
 * Democratic margin in the country; the era's economic left pole.
 */
const CAPITAL_1979: PositionsBlock = {
  race: {
    white: { economicLean: -4.2, socialLean: -1.4 }, // federal managers and gentrifying professionals in a Black-majority city
    black: { economicLean: -5, socialLean: -1.8 }, // home rule won in 1973: the most Democratic electorate in the country
    hispanic: { economicLean: -4.7, socialLean: -2.2 }, // a small Salvadoran and embassy-linked population
  },
  education: {
    no_college: { economicLean: -5, socialLean: -0.6 }, // the federal service and hospitality workforce, heavily unionized
    college: { economicLean: -5, socialLean: -3.8 }, // the career civil service
    graduate: { economicLean: -5, socialLean: -5 }, // the agency and think-tank professional class
  },
  wealth: {
    low: { economicLean: -5, socialLean: -1.1 }, // concentrated urban poverty a mile from the Capitol
    middle: { economicLean: -5, socialLean: -1.8 }, // the federal grade-scale middle class
    high: { economicLean: -2, socialLean: -2 }, // law, lobbying and the federal contracting economy
  },
  ideology: {
    evangelicals: { economicLean: -2.2, socialLean: 2.3 }, // large Black Baptist congregations: socially traditional, economically left
    patriots: { economicLean: -1.6, socialLean: 1.9 }, // the military and veterans' bureaucracy
    gunowners: { economicLean: -1.6, socialLean: 1.7 }, // a marginal identity under the 1976 handgun ban
    progressives: { economicLean: -5, socialLean: -5 }, // the city's civil-rights and public-employee left
    environmentalists: { economicLean: -5, socialLean: -4.9 }, // the federal environmental bureaucracy's home
    libertarians: { economicLean: 2.1, socialLean: -1.2 }, // a think-tank minority in the federal city
  },
};

/**
 * 1979-era US state census profiles (Layer 1 demographic configs).
 *
 * Era anchor: the 1980 Census. Every state profile here was authored
 * independently from historical knowledge of that state circa 1979 —
 * NOT derived by scaling the 2019 data in `stateCensusData.ts`.
 *
 * Key national reference points (1980 Census / late-1970s surveys):
 * - Race: White ~80%, Black ~11.7%, Hispanic ~6.4%, Asian ~1.5%.
 *   Hispanic population heavily concentrated in NM/TX/CA/AZ/CO/NY/FL;
 *   most of the country was far Whiter than in 2019. Asian share was
 *   negligible outside HI/CA/WA/NY. "Other" carries American Indian /
 *   Alaska Native populations (AK, NM, AZ, OK, SD, MT, ND).
 * - Education: bachelor's-or-higher attainment ~17% nationally
 *   (vs ~33% in 2019); graduate degrees rare. no_college dominates
 *   everywhere; Appalachia/Deep South in the low 60s for HS completion.
 * - Age: median age ~30. Baby boomers were 16-34, so the population is
 *   young-heavy with a small senior cohort (~11% 65+). FL already a
 *   retirement magnet; UT exceptionally young.
 * - Wealth: era-neutral relative tiers. Industrial Midwest (MI/OH/IL)
 *   still prosperous pre-deindustrialization collapse; energy-boom
 *   states (TX/AK/WY/OK/LA) riding the late-70s oil boom; Appalachia
 *   (WV/KY) and the Deep South (MS/AR/AL) poorest; CT/NJ/MD/AK richest.
 * - Ideology (pre-Reagan coding): evangelical political mobilization was
 *   only just beginning (Moral Majority founded 1979) — high cultural
 *   presence in the South but somewhat below 2019 political peaks.
 *   Environmentalist and progressive identification far lower than 2019
 *   (post-Earth Day but pre-mainstreaming). Libertarians a tiny fringe
 *   (party founded 1971), modestly higher in the Mountain West.
 *   Patriots (Cold War nationalism) and gunowners strong in the rural
 *   South/West; the unionized industrial Midwest reads blue-collar
 *   Democratic rather than progressive.
 */
export const stateCensusData1979: Record<string, Layer1Config> = {
  AK: {
    race: { white: 77, black: 3, hispanic: 2, asian: 4, other: 14 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 38, mid: 30, mature: 22, senior: 10 },
    ideology: {
      evangelicals: 12,
      environmentalists: 6,
      libertarians: 10,
      progressives: 6,
      patriots: 14,
      gunowners: 24,
    },
    positions: MOUNTAIN_1979,
  },
  AL: {
    race: { white: 73, black: 25, hispanic: 1, asian: 0, other: 1 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 30,
      environmentalists: 1,
      libertarians: 2,
      progressives: 3,
      patriots: 16,
      gunowners: 20,
    },
    positions: DEEP_SOUTH_1979,
  },
  AR: {
    race: { white: 82, black: 16, hispanic: 1, asian: 0, other: 1 },
    education: { no_college: 87, college: 9, graduate: 4 },
    wealth: { low: 40, middle: 47, high: 13 },
    age: { young: 30, mid: 25, mature: 24, senior: 21 },
    ideology: {
      evangelicals: 28,
      environmentalists: 1,
      libertarians: 3,
      progressives: 3,
      patriots: 14,
      gunowners: 20,
    },
    positions: DEEP_SOUTH_1979,
  },
  AZ: {
    race: { white: 75, black: 3, hispanic: 16, asian: 1, other: 5 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 12,
      environmentalists: 4,
      libertarians: 9,
      progressives: 5,
      patriots: 12,
      gunowners: 17,
    },
    positions: MOUNTAIN_1979,
  },
  CA: {
    race: { white: 67, black: 8, hispanic: 19, asian: 5, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 33, mid: 28, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 9,
      libertarians: 5,
      progressives: 12,
      patriots: 6,
      gunowners: 8,
    },
    positions: shiftRegionPositions(PACIFIC_1979, 0.8, 0.4), // Proposition 13 economics plus mass social liberalization
  },
  CO: {
    race: { white: 82, black: 4, hispanic: 12, asian: 1, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 35, mid: 28, mature: 22, senior: 15 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 8,
      progressives: 8,
      patriots: 9,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_1979, -0.4, -1), // Denver and Boulder in-migration begins pulling it off the Mountain line
  },
  CT: {
    race: { white: 88, black: 7, hispanic: 4, asian: 1, other: 0 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 18, middle: 52, high: 30 },
    age: { young: 29, mid: 26, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 4,
      environmentalists: 7,
      libertarians: 3,
      progressives: 13,
      patriots: 5,
      gunowners: 6,
    },
    positions: MID_ATLANTIC_1979,
  },
  DC: {
    race: { white: 26, black: 70, hispanic: 3, asian: 1, other: 0 },
    education: { no_college: 67, college: 18, graduate: 15 },
    wealth: { low: 36, middle: 42, high: 22 },
    age: { young: 34, mid: 28, mature: 23, senior: 15 },
    ideology: {
      evangelicals: 10,
      environmentalists: 6,
      libertarians: 2,
      progressives: 20,
      patriots: 3,
      gunowners: 3,
    },
    positions: CAPITAL_1979,
  },
  DE: {
    race: { white: 81, black: 16, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 31, mid: 27, mature: 25, senior: 17 },
    ideology: {
      evangelicals: 8,
      environmentalists: 5,
      libertarians: 3,
      progressives: 10,
      patriots: 7,
      gunowners: 8,
    },
    positions: shiftRegionPositions(BORDER_1979, -0.5, -1.2), // du Pont industry with a Mid-Atlantic social profile
  },
  FL: {
    race: { white: 76, black: 14, hispanic: 9, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 27, mid: 24, mature: 24, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 3,
      libertarians: 5,
      progressives: 6,
      patriots: 12,
      gunowners: 13,
    },
    positions: shiftRegionPositions(BORDER_1979, 2, 0), // retiree and Cuban in-migration diluting the Southern base
  },
  GA: {
    race: { white: 71, black: 27, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 34, mid: 27, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 28,
      environmentalists: 2,
      libertarians: 3,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1979, -3.4, -0.6), // Carter's home state: the one Deep South state he holds in 1980
  },
  HI: {
    race: { white: 33, black: 2, hispanic: 3, asian: 56, other: 6 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 34, mid: 29, mature: 23, senior: 14 },
    ideology: {
      evangelicals: 5,
      environmentalists: 8,
      libertarians: 2,
      progressives: 13,
      patriots: 6,
      gunowners: 4,
    },
    positions: ISLANDS_1979,
  },
  IA: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 30, mid: 25, mature: 24, senior: 21 },
    ideology: {
      evangelicals: 13,
      environmentalists: 3,
      libertarians: 4,
      progressives: 6,
      patriots: 9,
      gunowners: 12,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1979, 0.6, 0.2), // owner-operator Corn Belt farming, right of the industrial Great Lakes
  },
  ID: {
    race: { white: 94, black: 0, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 34, mid: 26, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 18,
      environmentalists: 3,
      libertarians: 9,
      progressives: 3,
      patriots: 14,
      gunowners: 22,
    },
    positions: shiftRegionPositions(MOUNTAIN_1979, 0.1, 0.4), // tracks Utah more than the Mountain line
  },
  IL: {
    race: { white: 78, black: 15, hispanic: 6, asian: 1, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 32, mid: 27, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 9,
      environmentalists: 5,
      libertarians: 3,
      progressives: 11,
      patriots: 7,
      gunowners: 8,
    },
    positions: GREAT_LAKES_1979,
  },
  IN: {
    race: { white: 90, black: 8, hispanic: 2, asian: 0, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 17,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 12,
      gunowners: 13,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1979, 0, 0.8), // the most Republican Great Lakes state since 1936
  },
  KS: {
    race: { white: 91, black: 5, hispanic: 3, asian: 1, other: 0 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 26, mature: 23, senior: 20 },
    ideology: {
      evangelicals: 15,
      environmentalists: 2,
      libertarians: 6,
      progressives: 4,
      patriots: 12,
      gunowners: 14,
    },
    positions: PLAINS_1979,
  },
  KY: {
    race: { white: 92, black: 7, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 88, college: 8, graduate: 4 },
    wealth: { low: 40, middle: 47, high: 13 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 25,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 13,
      gunowners: 19,
    },
    positions: shiftRegionPositions(BORDER_1979, -0.5, -0.3), // eastern coalfield Democrats against a Republican Bluegrass
  },
  LA: {
    race: { white: 68, black: 29, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 35, mid: 26, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 24,
      environmentalists: 1,
      libertarians: 2,
      progressives: 5,
      patriots: 14,
      gunowners: 18,
    },
    positions: shiftRegionPositions(DEEP_SOUTH_1979, 0.3, 0.4), // south Louisiana Catholicism and the oil boom
  },
  MA: {
    race: { white: 93, black: 4, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 72, college: 18, graduate: 10 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    ideology: {
      evangelicals: 4,
      environmentalists: 9,
      libertarians: 3,
      progressives: 15,
      patriots: 4,
      gunowners: 4,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1979, -2.6, -0.7), // Reagan by 0.2 with Anderson at 15%: socially left of its region
  },
  MD: {
    race: { white: 74, black: 23, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 75, college: 16, graduate: 9 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 32, mid: 28, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 6,
      libertarians: 3,
      progressives: 12,
      patriots: 6,
      gunowners: 6,
    },
    positions: shiftRegionPositions(BORDER_1979, -1.2, -1.2), // a Carter state on the federal workforce and Baltimore
  },
  ME: {
    race: { white: 98, black: 0, hispanic: 0, asian: 1, other: 1 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 6,
      environmentalists: 7,
      libertarians: 5,
      progressives: 8,
      patriots: 6,
      gunowners: 13,
    },
    positions: shiftRegionPositions(YANKEE_1979, -0.8, -0.1), // the same anti-tax profile as New Hampshire, one notch weaker
  },
  MI: {
    race: { white: 84, black: 13, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 33, mid: 27, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 10,
      environmentalists: 4,
      libertarians: 3,
      progressives: 10,
      patriots: 7,
      gunowners: 11,
    },
    positions: GREAT_LAKES_1979,
  },
  MN: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 6,
      libertarians: 4,
      progressives: 12,
      patriots: 6,
      gunowners: 11,
    },
    positions: shiftRegionPositions(GREAT_LAKES_1979, -3.4, -1.4), // the DFL, Mondale on the ticket, and one of only six Carter states
  },
  MO: {
    race: { white: 88, black: 10, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 30, mid: 26, mature: 24, senior: 20 },
    ideology: {
      evangelicals: 18,
      environmentalists: 2,
      libertarians: 4,
      progressives: 6,
      patriots: 11,
      gunowners: 14,
    },
    positions: shiftRegionPositions(BORDER_1979, 0.6, -0.1), // the bellwether: St Louis and Kansas City labor against the Ozarks
  },
  MS: {
    race: { white: 64, black: 35, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 87, college: 8, graduate: 5 },
    wealth: { low: 44, middle: 44, high: 12 },
    age: { young: 35, mid: 25, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 30,
      environmentalists: 1,
      libertarians: 2,
      progressives: 4,
      patriots: 14,
      gunowners: 19,
    },
    positions: DEEP_SOUTH_1979,
  },
  MT: {
    race: { white: 93, black: 0, hispanic: 1, asian: 1, other: 5 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 10,
      environmentalists: 5,
      libertarians: 8,
      progressives: 5,
      patriots: 12,
      gunowners: 23,
    },
    positions: shiftRegionPositions(MOUNTAIN_1979, -0.8, -0.6), // Butte copper unionism survives inside a Mountain state
  },
  NC: {
    race: { white: 75, black: 22, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 33, mid: 27, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 2,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
    positions: BORDER_1979,
  },
  ND: {
    race: { white: 95, black: 0, hispanic: 1, asian: 0, other: 4 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 33, mid: 25, mature: 22, senior: 20 },
    ideology: {
      evangelicals: 12,
      environmentalists: 2,
      libertarians: 5,
      progressives: 5,
      patriots: 11,
      gunowners: 16,
    },
    positions: PLAINS_1979,
  },
  NE: {
    race: { white: 94, black: 3, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 14, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 25, mature: 23, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 11,
      gunowners: 14,
    },
    positions: PLAINS_1979,
  },
  NH: {
    race: { white: 98, black: 0, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 31, mid: 27, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 6,
      libertarians: 8,
      progressives: 7,
      patriots: 7,
      gunowners: 12,
    },
    positions: shiftRegionPositions(YANKEE_1979, 0.7, 0.6), // no income tax, no sales tax: the pledge is the state's civic creed
  },
  NJ: {
    race: { white: 79, black: 13, hispanic: 7, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 20, middle: 52, high: 28 },
    age: { young: 30, mid: 26, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 6,
      libertarians: 3,
      progressives: 12,
      patriots: 6,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1979, 1.1, 0.1), // suburban tax revolt over a shrinking industrial base
  },
  NM: {
    race: { white: 52, black: 2, hispanic: 37, asian: 1, other: 8 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 35, mid: 26, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 10,
      environmentalists: 4,
      libertarians: 5,
      progressives: 8,
      patriots: 9,
      gunowners: 15,
    },
    positions: MOUNTAIN_1979,
  },
  NV: {
    race: { white: 85, black: 6, hispanic: 7, asian: 1, other: 1 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 32, mid: 28, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 3,
      libertarians: 10,
      progressives: 5,
      patriots: 9,
      gunowners: 14,
    },
    positions: shiftRegionPositions(MOUNTAIN_1979, 0, -2.1), // the casino economy and permissive social law: service unionism restrains econ
  },
  NY: {
    race: { white: 75, black: 14, hispanic: 9, asian: 2, other: 0 },
    education: { no_college: 75, college: 16, graduate: 9 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 31, mid: 26, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 7,
      libertarians: 3,
      progressives: 15,
      patriots: 5,
      gunowners: 6,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1979, -2, -0.3), // the fiscal crisis city and the last big-machine Democratic electorate
  },
  OH: {
    race: { white: 88, black: 10, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 12,
      environmentalists: 3,
      libertarians: 3,
      progressives: 8,
      patriots: 9,
      gunowners: 11,
    },
    positions: GREAT_LAKES_1979,
  },
  OK: {
    race: { white: 83, black: 7, hispanic: 2, asian: 1, other: 7 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 31, mid: 26, mature: 23, senior: 20 },
    ideology: {
      evangelicals: 26,
      environmentalists: 1,
      libertarians: 5,
      progressives: 3,
      patriots: 14,
      gunowners: 18,
    },
    positions: shiftRegionPositions(BORDER_1979, 1.8, 0.5), // oil-patch economics plus Bible Belt mobilization
  },
  OR: {
    race: { white: 93, black: 1, hispanic: 3, asian: 2, other: 1 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 27, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 10,
      libertarians: 6,
      progressives: 10,
      patriots: 7,
      gunowners: 14,
    },
    positions: PACIFIC_1979,
  },
  PA: {
    race: { white: 89, black: 9, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 9,
      environmentalists: 3,
      libertarians: 3,
      progressives: 9,
      patriots: 8,
      gunowners: 12,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1979, 0, 0.5), // steel and anthracite: the USWA belt anchors the state's economics
  },
  RI: {
    race: { white: 94, black: 3, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 80, college: 13, graduate: 7 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 30, mid: 25, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 4,
      environmentalists: 6,
      libertarians: 3,
      progressives: 13,
      patriots: 5,
      gunowners: 5,
    },
    positions: shiftRegionPositions(MID_ATLANTIC_1979, -4.2, -0.6), // the densest Catholic union electorate in the country
  },
  SC: {
    race: { white: 68, black: 30, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 28,
      environmentalists: 1,
      libertarians: 2,
      progressives: 4,
      patriots: 15,
      gunowners: 17,
    },
    positions: DEEP_SOUTH_1979,
  },
  SD: {
    race: { white: 92, black: 0, hispanic: 1, asian: 0, other: 7 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 32, middle: 54, high: 14 },
    age: { young: 32, mid: 25, mature: 22, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 12,
      gunowners: 17,
    },
    positions: PLAINS_1979,
  },
  TN: {
    race: { white: 83, black: 16, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 29,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 14,
      gunowners: 18,
    },
    positions: shiftRegionPositions(BORDER_1979, -0.4, -0.5), // the peripheral South's swing state, still competitive on economics
  },
  TX: {
    race: { white: 66, black: 12, hispanic: 21, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 22,
      environmentalists: 1,
      libertarians: 5,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: shiftRegionPositions(BORDER_1979, 1.6, 0.4), // the oil-patch Reagan coalition assembling
  },
  UT: {
    race: { white: 93, black: 1, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 24, middle: 60, high: 16 },
    age: { young: 42, mid: 25, mature: 19, senior: 14 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 7,
      progressives: 3,
      patriots: 12,
      gunowners: 13,
    },
    positions: shiftRegionPositions(MOUNTAIN_1979, 0.7, 1.6), // Carter's worst state at R+56 two-party: the LDS corridor maxes both axes
  },
  VA: {
    race: { white: 79, black: 19, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 33, mid: 28, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 20,
      environmentalists: 3,
      libertarians: 3,
      progressives: 6,
      patriots: 13,
      gunowners: 13,
    },
    positions: shiftRegionPositions(BORDER_1979, 1.4, 0.8), // the federal suburbs of Northern Virginia against a Byrd-tradition Southside
  },
  VT: {
    race: { white: 98, black: 0, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 32, middle: 54, high: 14 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 5,
      environmentalists: 10,
      libertarians: 5,
      progressives: 11,
      patriots: 5,
      gunowners: 12,
    },
    positions: YANKEE_1979,
  },
  WA: {
    race: { white: 90, black: 3, hispanic: 3, asian: 3, other: 1 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 10,
      libertarians: 5,
      progressives: 11,
      patriots: 7,
      gunowners: 11,
    },
    positions: PACIFIC_1979,
  },
  WI: {
    race: { white: 94, black: 4, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 24, middle: 60, high: 16 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 5,
      libertarians: 4,
      progressives: 11,
      patriots: 7,
      gunowners: 12,
    },
    positions: GREAT_LAKES_1979,
  },
  WV: {
    race: { white: 96, black: 3, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 89, college: 7, graduate: 4 },
    wealth: { low: 42, middle: 46, high: 12 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 22,
      environmentalists: 1,
      libertarians: 2,
      progressives: 6,
      patriots: 11,
      gunowners: 18,
    },
    positions: shiftRegionPositions(BORDER_1979, -3.7, 0.1), // coal unionism holds it for Carter while the rest of the region goes
  },
  WY: {
    race: { white: 92, black: 1, hispanic: 5, asian: 1, other: 1 },
    education: { no_college: 79, college: 15, graduate: 6 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 },
    ideology: {
      evangelicals: 13,
      environmentalists: 3,
      libertarians: 11,
      progressives: 3,
      patriots: 14,
      gunowners: 24,
    },
    positions: MOUNTAIN_1979,
  },
};
