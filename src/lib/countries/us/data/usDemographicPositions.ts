import type { EraId } from "@/lib/seeds/presetSelector";
import { shiftRegion, type PositionEntry } from "@/lib/seeds/regionalPositions";
import type { DemographicTurnoutRates } from "@/lib/seeds/demographicCategories";

/**
 * The United States' regional political archetypes and per-state position
 * overrides.
 *
 * \u26a0\ufe0f THIS WAS 514 LINES OF ONE COUNTRY'S DATA INSIDE A SHARED MODULE.
 * `seeds/demographicCategories.ts` defines the turnout rates, labels, category
 * list and era compositions that EVERY country reads -- `countryDemographics.ts`,
 * the poll panels, the seed runner, the seed diagnostics. Sitting in the middle
 * of it were ten United States regional archetypes (Deep South, Border,
 * Mid-Atlantic, Great Lakes, Plains, Mountain, Pacific, Yankee, Islands,
 * Capital) and a per-state override table keyed AL, MS, SC, TX.
 *
 * Nothing separated the two. A reader looking for shared machinery found
 * Alabama; a reader looking for Alabama found shared machinery. That is the
 * mixing country folders exist to end, and it is why the whole file could not
 * simply be relocated: moving it would have dragged every country's demographic
 * machinery into `us/`.
 *
 * `US_STATE_POSITION_OVERRIDES` is the only export read from outside; the ten
 * archetypes are private to it, because a state's table is either its region's
 * or a `shiftRegion` of it.
 */

/**
 * Deep South (AL MS SC LA GA AR): one-party organization, not left ideology.
 * Whites here are New Deal beneficiaries (TVA, REA, farm parity) who sit at the
 * caste order's traditional ceiling. Black disfranchisement makes the white value
 * close to the state mean rather than bolder than it.
 */
const DEEP_SOUTH_1953: PositionEntry[] = [
  ["race", "white", -0.5, 4.2], // populist toward Washington money, at the caste order's ceiling socially
  ["race", "black", -3.4, -2], // disfranchised outside the cities; church-centered and economically dependent
  ["race", "hispanic", -2.6, 1.2], // south Texas and Delta farm labor, tied to the same patron economy
  ["education", "no_college", -1.7, 2.9], // mill-town and small-farmer Dixiecrats, not northern union Democrats
  ["education", "college", 0.6, 2.1], // the professional class of the courthouse ring
  ["education", "graduate", 0, 1.6], // a thin university and medical stratum, less bound by the county machine
  ["wealth", "low", -2.2, 3.1], // tenant farmers and sharecroppers: the region's populist floor
  ["wealth", "middle", 0.8, 2.6], // the courthouse and Main Street class, the region's most conservative element
  ["wealth", "high", 2.2, 2.7], // planter and textile capital, anti-union and property-first
  ["ideology", "evangelicals", -0.6, 3.2], // pre-Moral Majority: pious and segregationist, economically populist
  ["ideology", "patriots", -0.4, 3.1], // Southern military tradition, yellow-dog Democratic in party terms
  ["ideology", "gunowners", -0.8, 3], // rural hunting culture with no partisan vehicle of its own
  ["ideology", "progressives", -3.4, -1.3], // TVA and rural-electrification progressivism, silent on race
  ["ideology", "environmentalists", -1.4, 0.4], // soil conservation and flood control, a federal-works constituency
  ["ideology", "libertarians", 3.4, 2.8], // states-rights constitutionalism rather than market liberalism
];

/**
 * Border and peripheral South (VA NC TN FL TX OK KY MO WV MD DE): same New Deal
 * dependence one notch weaker, a live two-party contest in the highland counties,
 * and Byrd-style pay-as-you-go conservatism where the courthouse rings are strong.
 */
const BORDER_1953: PositionEntry[] = [
  ["race", "white", 0.2, 0.7], // two-party country: Ike took VA, TX and FL in 1952 without an ideological shift
  ["race", "black", -3.6, -2], // urban Black electorates in Baltimore, Louisville and St Louis could vote
  ["race", "hispanic", -2.6, 0.1], // Texas and Oklahoma farm labor with a Catholic Democratic tilt
  ["education", "no_college", -1.8, 1.2], // textile, tobacco and coal workers still inside the New Deal coalition
  ["education", "college", 1, 0.6], // the business and professional towns Eisenhower cracked first
  ["education", "graduate", 0.3, 0.3], // state universities and federal science payrolls
  ["wealth", "low", -2.5, 1.6], // Appalachian and Ozark poverty, the most reliably Democratic bloc here
  ["wealth", "middle", 1.1, 1], // county-seat merchants: fiscally tight, socially church-bound
  ["wealth", "high", 2.6, 1], // oil, tobacco and banking capital, business-conservative
  ["ideology", "evangelicals", 0, 1.9], // Southern Baptist majority culture, politically unorganized
  ["ideology", "patriots", 0.4, 1.7], // heavy military-base presence from Norfolk to Fort Sill
  ["ideology", "gunowners", 0, 1.5], // hunting and rural self-defense, no partisan alignment yet
  ["ideology", "progressives", -3.9, -2.8], // the New Deal wing that survived in the highland counties
  ["ideology", "environmentalists", -1.5, -0.4], // TVA-adjacent conservation, mildly federal-friendly
  ["ideology", "libertarians", 3.9, 1.3], // anti-tax and anti-Washington without the Deep South's caste politics
];

/**
 * Industrial Northeast (MA RI CT NY NJ PA): peak union density with a very large
 * Catholic ethnic bloc. Economically the New Deal's core, socially the least
 * traditional region of the era outside the Pacific.
 */
const MID_ATLANTIC_1953: PositionEntry[] = [
  ["race", "white", 1.2, -0.9], // Yankee Protestant business Republicans and New Deal Catholic ethnics roughly cancel
  ["race", "black", -4, -1.7], // Great Migration electorates in Harlem, Philadelphia and Newark, CIO-organized
  ["race", "hispanic", -3, -0.8], // the first mass Puerto Rican migration, union and machine-connected
  ["education", "no_college", -2.1, 0.3], // peak union density: traditional on family and sex, New Deal on bread
  ["education", "college", 1.9, -1.3], // the professional and managerial tier that voted for Eisenhower
  ["education", "graduate", 0.3, -2], // the era's small academic and cultural left
  ["wealth", "low", -3.3, 0.3], // tenement and mill poverty, the New Deal coalition's foundation
  ["wealth", "middle", 1.8, -0.5], // new suburban homeowners moving toward tax sensitivity
  ["wealth", "high", 3.7, -0.5], // Wall Street and industrial capital, the anti-New Deal economic right
  ["ideology", "evangelicals", 0.7, 0.8], // a small non-mainline minority with no political vehicle
  ["ideology", "patriots", 1.9, 0.2], // Cold War and veterans' organizations, Korean War patriotism
  ["ideology", "gunowners", 1.5, 0], // sporting clubs rather than a political identity
  ["ideology", "progressives", -4.8, -4.8], // the labor left proper: CIO, ADA and the garment unions
  ["ideology", "environmentalists", -2.5, -2.3], // Pinchot-tradition conservation, Democratic-leaning
  ["ideology", "libertarians", 4.9, -0.8], // old-right anti-statists, socially indifferent
];

/**
 * Great Lakes (OH IN IL MI WI MN IA): Main Street Taft Republicanism over a
 * UAW/USWA industrial core. Net centre-right, cross-pressured on both axes.
 */
const GREAT_LAKES_1953: PositionEntry[] = [
  ["race", "white", 1, -0.8], // farm-Republican countryside plus Taft small business, cross-pressured by the UAW
  ["race", "black", -4.2, -1.5], // Detroit, Chicago and Cleveland industrial electorates at peak union membership
  ["race", "hispanic", -3, -0.7], // Mexican-American steel and packinghouse labor in Chicago and Gary
  ["education", "no_college", -2.1, -0.3], // the union card, not schooling, sets this bloc's economics
  ["education", "college", 1.7, -1.2], // Main Street professionals who broke two-to-one for Eisenhower
  ["education", "graduate", 0.5, -1.8], // Big Ten faculty and research staff, Stevenson's constituency
  ["wealth", "low", -3.1, -0.1], // the industrial poor inside the CIO's organising reach
  ["wealth", "middle", 1.6, -0.5], // GI Bill suburbs: mortgage interest and property tax pull econ right
  ["wealth", "high", 3.3, -0.4], // auto, steel and machine-tool capital, solidly Republican
  ["ideology", "evangelicals", 0.7, 0.9], // rural Methodist and Lutheran piety, dry rather than mobilized
  ["ideology", "patriots", 1.7, 0.3], // American Legion country with a large veteran population
  ["ideology", "gunowners", 1.3, 0.1], // hunting culture across the northern tier, non-partisan
  ["ideology", "progressives", -4.7, -4.5], // La Follette and Farmer-Labor residue, genuinely economically left
  ["ideology", "environmentalists", -2.1, -1.9], // Izaak Walton League conservation, mildly Democratic
  ["ideology", "libertarians", 4.9, -0.6], // Chicago-school and Old Right anti-New Deal opinion
];

/**
 * Plains (ND SD NE KS): the country's most reliably Republican region in 1952
 * (KS R+38.5, NE R+38.4, SD R+38.6, ND R+42.9), small-proprietor and anti-federal.
 */
const PLAINS_1953: PositionEntry[] = [
  ["race", "white", 3.4, 0.2], // isolationist farm Republicanism; the region gave Eisenhower his largest margins
  ["race", "black", -3.2, -1], // a small urban population in Omaha, Wichita and Topeka
  ["race", "hispanic", -2.4, 0], // sugar-beet and railroad labor, thinly settled
  ["education", "no_college", 1.5, 0.6], // the owner-operator farmer and the small-town proprietor, not a wage worker
  ["education", "college", 2.9, -0.2], // land-grant graduates who stayed in county business
  ["education", "graduate", 1.7, -0.8], // agricultural extension and university staff
  ["wealth", "low", -1.4, 0.7], // the farm tenancy that the New Deal's price supports rescued
  ["wealth", "middle", 3.2, 0.6], // the merchant and farm-owner middle class: the region's Republican spine
  ["wealth", "high", 3.9, 0.6], // grain, banking and land capital, anti-federal on spending
  ["ideology", "evangelicals", 2.2, 1.7], // dry Protestant moralism, prohibitionist in memory
  ["ideology", "patriots", 3.2, 1.1], // isolationist patriotism reworked by the Korean War
  ["ideology", "gunowners", 3, 0.9], // universal rural gun ownership, entirely non-partisan
  ["ideology", "progressives", -2.8, -2.3], // Nonpartisan League and Farmers Union agrarian radicalism
  ["ideology", "environmentalists", -0.8, -0.9], // Dust Bowl soil conservation, a federal program constituency
  ["ideology", "libertarians", 5, 0.6], // anti-Washington constitutionalism, the region's default rhetoric
];

/**
 * Mountain West and Alaska (MT ID WY CO UT NV AZ NM AK): ranching, mining,
 * reclamation and the Mormon corridor. Republican well before the Southern
 * realignment; traditional without the racial caste order.
 */
const MOUNTAIN_1953: PositionEntry[] = [
  ["race", "white", 2.2, 0.1], // small government in principle, federal water, land and defense money in practice
  ["race", "black", -3.4, -1.1], // small urban populations in Denver, Phoenix and the defense towns
  ["race", "hispanic", -2, 0.7], // New Mexico Hispanos and Arizona farm labor: Catholic, Democratic, traditional
  ["education", "no_college", 0.5, 0.5], // ranch and mine labor with a real extractive-union tradition
  ["education", "college", 2.4, -0.2], // the professional tier of Denver, Salt Lake and Phoenix
  ["education", "graduate", 1.2, -0.8], // the atomic laboratories and state universities
  ["wealth", "low", -2, 0.6], // reservation and migrant poverty, weakly enfranchised
  ["wealth", "middle", 2.6, 0.5], // the small-town merchant class, Republican before the Southern realignment
  ["wealth", "high", 3.6, 0.6], // mining, cattle and land capital
  ["ideology", "evangelicals", 1.6, 1.6], // the Mormon corridor plus scattered Protestant fundamentalism
  ["ideology", "patriots", 2.6, 1], // defense installations and a heavy veteran share
  ["ideology", "gunowners", 2.4, 0.8], // hunting and ranch ownership, universal and non-partisan
  ["ideology", "progressives", -3.4, -3], // Butte and Coeur d'Alene mining unionism, the region's economic left
  ["ideology", "environmentalists", -1.4, -1], // reclamation and public-lands conservation
  ["ideology", "libertarians", 5, 0.6], // sagebrush anti-federalism a generation before the Rebellion
];

/**
 * Pacific coast (CA OR WA): Warren-era progressive Republicanism, defense-industry
 * boom, strong maritime labor, and a milder social climate than the interior.
 */
const PACIFIC_1953: PositionEntry[] = [
  ["race", "white", 1.9, -1], // Warren-era growth Republicanism: business-friendly, conservationist, socially mild
  ["race", "black", -3.6, -1.7], // wartime shipyard migration into Oakland, Portland and Seattle
  ["race", "hispanic", -2, -0.9], // bracero-era farm labor, largely unenfranchised
  ["education", "no_college", -0.2, -0.3], // aerospace, maritime and longshore labor with strong unions
  ["education", "college", 2.2, -1.4], // the growth professional class of the coastal cities
  ["education", "graduate", 0.5, -2.2], // Berkeley, Stanford and Caltech: the era's academic left
  ["wealth", "low", -2.4, -0.2], // migrant farm and cannery poverty
  ["wealth", "middle", 2.5, -0.7], // new tract suburbs built on defense payrolls
  ["wealth", "high", 3.8, -0.6], // aerospace, oil and agribusiness capital
  ["ideology", "evangelicals", 1.5, 0.4], // Okie migrant Pentecostalism in the Central Valley, not a coastal bloc
  ["ideology", "patriots", 2.5, 0], // the largest defense economy in the country
  ["ideology", "gunowners", 2.1, -0.2], // hunting and sporting culture, non-partisan
  ["ideology", "progressives", -3.2, -4], // ILWU and Popular Front residue, the coast's economic left
  ["ideology", "environmentalists", -2.2, -2.4], // Sierra Club conservation, already a mass constituency
  ["ideology", "libertarians", 5, -0.8], // growth-boom individualism, socially permissive
];

/**
 * Yankee New England (VT NH ME): town-meeting Republicanism, market-friendly and
 * mainline Protestant. VT was the strongest GOP state of 1952 at R+43.3 and is not
 * a Southern traditionalist in any era.
 */
const YANKEE_1953: PositionEntry[] = [
  ["race", "white", 2.9, -1.3], // town-meeting Republicanism: market-friendly, civic-reform, mainline Protestant
  ["race", "black", -3.5, -1.4], // a tiny population that had voted Republican since Lincoln
  ["race", "hispanic", -2.7, -0.8], // negligible in the 1950 census outside the mill towns
  ["education", "no_college", 0.5, -0.3], // hill-farm and quarry labor, proprietors more often than wage workers
  ["education", "college", 2.9, -1.5], // the professional tier of the region's Republican establishment
  ["education", "graduate", 1.6, -2], // the New England college faculties, the region's liberal edge
  ["wealth", "low", -1.5, 0.1], // marginal hill-farm poverty without an industrial union structure
  ["wealth", "middle", 3.2, -0.7], // the Yankee merchant and farm-owner class, fiscally tight
  ["wealth", "high", 4.3, -0.7], // Boston-adjacent and summer-resident capital
  ["ideology", "evangelicals", 1.5, 0.8], // old-stock Congregational and Baptist piety, dry and reformist
  ["ideology", "patriots", 2.8, 0], // town veterans' posts, a long militia tradition
  ["ideology", "gunowners", 2.6, -0.2], // deer season as civic ritual, no partisan content
  ["ideology", "progressives", -2.9, -3.3], // the Yankee reform tradition, Republican in this era rather than labor-left
  ["ideology", "environmentalists", -1.5, -1.9], // forest and watershed conservation, a Republican cause here
  ["ideology", "libertarians", 5, -1], // no-broad-based-tax constitutionalism
];

/**
 * Hawaii: ILWU plantation unionism built the territory's Democratic machine.
 * Economically the furthest left electorate in the file, socially plural and mild.
 */
const ISLANDS_1953: PositionEntry[] = [
  ["race", "white", -1.4, -1.6], // haole planter and military households, the territory's Republican remnant
  ["race", "black", -3.9, -1.7], // a small military-linked population
  ["race", "hispanic", -2.7, -1.1], // Puerto Rican and Filipino plantation labor inside the ILWU
  ["education", "no_college", -4.2, -0.7], // the plantation and dock workforce the 1946 strikes organized
  ["education", "college", -0.8, -1.6], // territorial civil service and the university
  ["education", "graduate", -1.6, -2.4], // a thin professional stratum around the university
  ["wealth", "low", -3.8, -0.4], // camp housing and seasonal plantation poverty
  ["wealth", "middle", -0.9, -0.9], // the emerging Nisei small-business and civil-service class
  ["wealth", "high", 1.8, -0.8], // the Big Five sugar and shipping oligarchy
  ["ideology", "evangelicals", -0.2, 0.6], // missionary-descended Protestant congregations
  ["ideology", "patriots", 0.3, 0], // Pearl Harbor and the 442nd: patriotic without Mainland partisanship
  ["ideology", "gunowners", 0.2, -0.2], // hunting on the outer islands, a minor identity
  ["ideology", "progressives", -4.8, -4], // the ILWU political machine that built the territorial Democrats
  ["ideology", "environmentalists", -2.8, -2.4], // watershed and fishery conservation
  ["ideology", "libertarians", 3.8, -1], // small-trader independence against the Big Five
];

/**
 * District of Columbia: a federal-payroll, majority-Black electorate with no
 * presidential vote until 1964. Economically the era's left pole.
 */
const CAPITAL_1953: PositionEntry[] = [
  ["race", "white", -1.8, -1.2], // federal managers and Georgetown professionals with no vote to cast
  ["race", "black", -4.5, -2], // the majority of the city: federal employment plus severe segregation
  ["race", "hispanic", -3.5, -1], // a very small embassy-linked population
  ["education", "no_college", -4.2, -0.4], // the federal service and hotel workforce, unionising through the AFL
  ["education", "college", -0.8, -1.9], // the career civil service, New Deal in formation
  ["education", "graduate", -1.6, -2.5], // the agency professional class, the era's technocratic left
  ["wealth", "low", -4.1, 0.1], // alley housing poverty a mile from the Capitol
  ["wealth", "middle", -1.1, -1], // the federal grade-scale middle class
  ["wealth", "high", 1.2, -1.1], // law, lobbying and old Washington capital
  ["ideology", "evangelicals", -1.5, 0.5], // large Black Baptist congregations, socially traditional
  ["ideology", "patriots", -0.5, -0.3], // the military and veterans' bureaucracy
  ["ideology", "gunowners", -0.9, -0.5], // a minor identity in a dense city
  ["ideology", "progressives", -5, -5], // the New Deal agency left in its home city
  ["ideology", "environmentalists", -3.3, -2.7], // Interior Department conservation
  ["ideology", "libertarians", 3.6, -1.1], // a small anti-federal minority in the federal city
];

/**
 * Per-state, per-era position overrides for Layer-1 demographics.
 * Allows whites in MA to lean Democratic while whites in GA lean Republican.
 * Each entry: [dimension, key, economicLean, socialLean].
 */
export const US_STATE_POSITION_OVERRIDES: Partial<
  Record<EraId, Record<string, Array<[keyof DemographicTurnoutRates, string, number, number]>>>
> = {
  // 1953 (2026-08 regional recalibration). Every state takes its region's table
  // from the block above, with single-state exceptions expressed as a shift.
  //
  // What changed and why:
  //  • The old table read the 1952 RESULT back into ideology: the Solid South's
  //    Democratic vote was encoded as economically left whites plus Democratic
  //    evangelical/patriot/gunowner buckets. That is party, not ideology. The
  //    Deep South here is economically populist-but-not-left (-0.5: TVA, farm
  //    parity, rural electrification) and sits at the caste order's traditional
  //    ceiling (+4.1), which is what the 1953 electorate actually was.
  //  • The party-proxy ideology overrides are gone. Regional character now runs
  //    through every bucket the era's archetypes weight, led by `race.white`,
  //    which carries archetype weight in this era's composition as it does from
  //    1999 on (before that it reached the granular cells but not the archetype
  //    leans, so no amount of white authoring moved a state's lean).
  //  • Margins were used only as an advisory rank-order check on geography, with
  //    the org-dominated Solid South excluded from the check.
  "1953": {
    // DeepSouth
    AL: DEEP_SOUTH_1953,
    MS: shiftRegion(DEEP_SOUTH_1953, 0.2, 1.2), // Delta planter caste order, the era's traditional ceiling
    SC: shiftRegion(DEEP_SOUTH_1953, 0.3, -0.7), // Byrnes bolted toward Eisenhower; textile capital pulls econ right of the Black Belt
    LA: shiftRegion(DEEP_SOUTH_1953, 0, -0.4), // south Louisiana Catholicism blunts the evangelical-Protestant frame
    GA: shiftRegion(DEEP_SOUTH_1953, -0.7, -0.2), // Talmadge rural populism: the widest Stevenson margin in the country
    AR: shiftRegion(DEEP_SOUTH_1953, -0.4, -1.5), // hill-country populism west of the Delta
    // Border
    VA: shiftRegion(BORDER_1953, 1.6, 1.1), // the Byrd organization: fiscally tight, socially the Border's most traditional
    NC: BORDER_1953,
    TN: BORDER_1953,
    FL: shiftRegion(BORDER_1953, 1.5, -0.3), // northern retiree and tourism in-migration already dilutes the Southern base
    TX: shiftRegion(BORDER_1953, 2.1, 0), // oil and gas capital gives Texas a business conservatism the Deep South lacks
    OK: BORDER_1953,
    KY: shiftRegion(BORDER_1953, -1.5, -0.1), // Stevenson carried it by 700 votes; eastern coalfield unionism, not Black Belt
    MO: shiftRegion(BORDER_1953, -0.9, -0.6), // Truman's border state, split between St Louis and Kansas City labor and the Ozarks
    WV: shiftRegion(BORDER_1953, -2.4, 0), // UMWA coal unionism: the clearest econ-left, socially traditional cell in the file
    MD: shiftRegion(BORDER_1953, 0.5, -2.1), // functionally Mid-Atlantic already: Baltimore industry and federal employment
    DE: shiftRegion(BORDER_1953, 0.5, -2.1), // du Pont industry and a Mid-Atlantic rather than Southern social profile
    // Yankee
    VT: shiftRegion(YANKEE_1953, 0.6, -0.3), // the strongest GOP state of 1952 (R+43.3), reform Yankee rather than traditionalist
    NH: shiftRegion(YANKEE_1953, -1, 0.3), // the no-broad-based-tax identity is already the state's civic creed
    ME: YANKEE_1953,
    // MidAtlantic
    MA: MID_ATLANTIC_1953,
    RI: shiftRegion(MID_ATLANTIC_1953, -0.2, -0.3), // the densest Catholic union electorate in the country; Stevenson's closest Northern state
    CT: MID_ATLANTIC_1953,
    NY: MID_ATLANTIC_1953,
    NJ: MID_ATLANTIC_1953,
    PA: shiftRegion(MID_ATLANTIC_1953, -0.4, -0.3), // anthracite and steel: the USWA belt anchors the state's economics
    // GreatLakes
    OH: GREAT_LAKES_1953,
    IN: GREAT_LAKES_1953,
    IL: GREAT_LAKES_1953,
    MI: GREAT_LAKES_1953,
    WI: shiftRegion(GREAT_LAKES_1953, 0.5, 0), // La Follette Progressive residue survives inside both parties
    MN: shiftRegion(GREAT_LAKES_1953, -0.1, -0.6), // the 1944 DFL merger and a Farmer-Labor tradition with no Southern analogue
    IA: shiftRegion(GREAT_LAKES_1953, 1.5, 0.5), // owner-operator Corn Belt farming sits right of the industrial Great Lakes
    // Plains
    ND: shiftRegion(PLAINS_1953, -1.1, 0.4), // Nonpartisan League agrarian radicalism survives inside the Republican party
    SD: PLAINS_1953,
    NE: PLAINS_1953,
    KS: PLAINS_1953,
    // Mountain
    MT: shiftRegion(MOUNTAIN_1953, -1.3, -0.6), // Butte mining unionism holds the state's economics off the Mountain line
    ID: MOUNTAIN_1953,
    WY: MOUNTAIN_1953,
    CO: MOUNTAIN_1953,
    UT: shiftRegion(MOUNTAIN_1953, 0.2, 2.3), // the LDS correlation of piety, teetotaling and Republicanism is already visible
    NV: shiftRegion(MOUNTAIN_1953, -0.5, -1.7), // legal gambling and permissive divorce law make it a social outlier
    AZ: MOUNTAIN_1953,
    NM: shiftRegion(MOUNTAIN_1953, -0.9, 0.4), // the Hispano north keeps the state left of its Mountain neighbors
    AK: MOUNTAIN_1953,
    // Pacific
    CA: PACIFIC_1953,
    OR: PACIFIC_1953,
    WA: shiftRegion(PACIFIC_1953, -0.9, -0.1), // Boeing and the maritime unions anchor a Democratic economics
    // Islands
    HI: ISLANDS_1953,
    // Capital
    DC: CAPITAL_1953,
  },
  "1979": {
    // Northeast — white working class still Democratic in 1980
    MA: [["race", "white", -0.5, -1.8]],
    RI: [["race", "white", -0.5, -1.2]],
    NY: [["race", "white", -0.5, -1.4]],
    CT: [["race", "white", -0.5, -1]],
    NJ: [["race", "white", -0.5, -0.6]],
    // Rust Belt — union/working-class Democratic
    PA: [["race", "white", 0, 0.8]],
    MI: [["race", "white", 0, 0.8]],
    WI: [["race", "white", 0, 0.2]],
    OH: [["race", "white", 0.5, 1]],
    IL: [["race", "white", -0.5, 0.4]],
    MN: [["race", "white", -1, -0.4]],
    IA: [["race", "white", 0.5, 0.8]],
    MO: [["race", "white", 0.5, 1.8]],
    // Upper South / Border — moderate, some Democratic residue
    WV: [["race", "white", -0.5, 2]],
    KY: [["race", "white", 0.5, 2.4]],
    TN: [["race", "white", 1, 2.6]],
    AR: [["race", "white", 1, 2.8]],
    // Deep South — strongly Republican by 1980
    AL: [["race", "white", 2.5, 3.5]],
    MS: [["race", "white", 2.5, 3.5]],
    LA: [["race", "white", 2, 3]],
    SC: [["race", "white", 2, 3.2]],
    NC: [["race", "white", 1.5, 2.6]],
    // Mountain West — strongly Republican
    UT: [["race", "white", 3, 3.4]],
    ID: [["race", "white", 3, 2.6]],
    WY: [["race", "white", 3, 2]],
    AK: [["race", "white", 2, 1.4]],
    MT: [["race", "white", 2, 1.2]],
    ND: [["race", "white", 2, 1.6]],
    SD: [["race", "white", 2, 1.6]],
    NE: [["race", "white", 2, 1.8]],
    KS: [["race", "white", 2, 1.6]],
    OK: [["race", "white", 2, 2.6]],
    // Pacific Coast — Democratic
    CA: [["race", "white", -1, -0.6]],
    OR: [["race", "white", -0.5, -0.8]],
    WA: [["race", "white", -0.5, -0.6]],
    HI: [["race", "white", -1, -1.2]],
    // Southwest — mixed
    AZ: [["race", "white", 1, 1.6]],
    NM: [["race", "white", 0, 0.8]],
    NV: [["race", "white", 0.5, 0.6]],
    CO: [["race", "white", 0.5, 0.2]],
    // New England / Liberal
    VT: [["race", "white", -1, -1]],
    NH: [["race", "white", 0, 0.4]],
    ME: [["race", "white", 0, -0.4]],
    DE: [["race", "white", -0.5, -0.4]],
    MD: [["race", "white", -1, -0.8]],
    DC: [["race", "white", -2, -1.5]],
    VA: [["race", "white", 0.5, 2.8]],
    FL: [["race", "white", 1, 1.8]],
    TX: [["race", "white", 1.5, 2.4]],
    IN: [["race", "white", 1, 1.4]],
    // Carter's home state + Democratic holdouts
    GA: [["race", "white", 0.5, 3.2]], // override: Carter home state effect
  },
  // 1992 presidential anchor (Clinton 43.0 / Bush 37.4 / Perot 18.9).
  //
  // Authored because the table previously stopped at 1979, and with the era
  // clock live an absent anchor is not neutral — every state's regional
  // character would be carried forward from 1980 unchanged for forty years.
  // (`eraPositionsForYear.ts` carries it forward rather than letting it decay,
  // which is safe, but real anchors are better than a frozen one.)
  //
  // The story of this map versus 1979: the Deep South keeps moving right while
  // APPALACHIA HAS NOT YET FLIPPED. Clinton carried West Virginia by 13 and
  // Kentucky by 3 — the New Deal coalition still held there on economics even
  // as it collapsed further south. WV is authored economically LEFT of the
  // national white baseline here and reverses hard by 2019, which is the
  // single largest regional swing in the series and should be visible as such.
  "1991": {
    // Deep South — white defection continues past the Reagan realignment.
    MS: [["race", "white", 3, 3.2]],
    AL: [["race", "white", 3.0, 3.0]],
    SC: [["race", "white", 2.5, 3]],
    LA: [["race", "white", 2.2, 2.8]],
    GA: [["race", "white", 2, 2.6]],
    NC: [["race", "white", 2.0, 2.2]],
    OK: [["race", "white", 2.5, 2.6]],
    TX: [["race", "white", 1.8, 2.2]],
    VA: [["race", "white", 1.8, 2.0]],
    FL: [["race", "white", 1.5, 1.4]],
    TN: [["race", "white", 1.5, 2.4]], // Gore on the ticket blunts the drift
    AR: [["race", "white", 0.5, 2.2]], // Clinton's home state — a +17.7 outlier
    // Appalachia / Border — still Democratic on economics in 1992.
    WV: [["race", "white", -1, 1.8]], // Clinton +13; socially traditional, econ-left
    KY: [["race", "white", 1, 2.2]],
    MO: [["race", "white", 0.8, 1.6]],
    // Mountain West / Plains — the most Republican region of the cycle.
    UT: [["race", "white", 3.5, 3.4]],
    ID: [["race", "white", 3.2, 2.8]],
    WY: [["race", "white", 2.8, 2]],
    NE: [["race", "white", 2.2, 1.8]],
    KS: [["race", "white", 2.2, 1.6]],
    AK: [["race", "white", 2.2, 1.2]],
    ND: [["race", "white", 2, 1.4]],
    SD: [["race", "white", 2, 1.4]],
    AZ: [["race", "white", 2, 1.4]],
    MT: [["race", "white", 1.5, 1]],
    NV: [["race", "white", 1.2, 0.4]],
    CO: [["race", "white", 1.2, 0]],
    NM: [["race", "white", 0.5, 0.6]],
    // Rust Belt / Midwest — union economics still binding.
    IN: [["race", "white", 1.5, 1.4]],
    OH: [["race", "white", 0.8, 0.8]],
    IA: [["race", "white", 0.3, 0.6]],
    PA: [["race", "white", 0.3, 0.6]],
    MI: [["race", "white", 0.2, 0.4]],
    WI: [["race", "white", 0, 0]],
    IL: [["race", "white", -0.3, 0.2]],
    MN: [["race", "white", -0.5, -0.6]],
    // Northeast.
    NH: [["race", "white", 0.8, 0.2]],
    NJ: [["race", "white", -0.3, -0.8]],
    DE: [["race", "white", -0.5, -0.6]],
    ME: [["race", "white", -0.5, -0.8]],
    CT: [["race", "white", -0.5, -1.2]],
    NY: [["race", "white", -1, -1.6]],
    MD: [["race", "white", -1, -1]],
    VT: [["race", "white", -1, -1.4]],
    MA: [["race", "white", -1.5, -2]],
    RI: [["race", "white", -1.5, -1.4]],
    DC: [["race", "white", -2.5, -2.0]],
    // Pacific.
    OR: [["race", "white", 0, -1]],
    WA: [["race", "white", 0, -0.8]],
    CA: [["race", "white", -0.5, -1]],
    HI: [["race", "white", -1, -1.6]],
  },
  // 2020 presidential anchor (Biden 51.3 / Trump 46.9).
  //
  // Two structural changes from 1992 dominate this map. APPALACHIA HAS
  // INVERTED: West Virginia moves from -1.0 to +3.5 on economics, the largest
  // single regional swing the series contains, and Kentucky follows it. And the
  // SUN BELT SUBURBS have moved the other way: Georgia, Arizona, Virginia and
  // Colorado are all markedly less Republican relative to the national white
  // baseline than their 1992 selves, which is why Georgia and Arizona are
  // competitive here and were not then.
  //
  // Utah is deliberately NOT at the top of the range despite being the most
  // Republican state of 1992: Trump ran well behind the historical Republican
  // share there in both 2016 and 2020.
  "2019": {
    // Deep South + the inverted Border.
    AL: [["race", "white", 3.5, 2.4]],
    MS: [["race", "white", 3.5, 2.4]],
    WY: [["race", "white", 3.5, 2]],
    OK: [["race", "white", 3.5, 2.6]],
    WV: [["race", "white", 3.5, 2.6]], // was -1.0 in 1992 — the series' biggest swing
    AR: [["race", "white", 3.2, 2.2]],
    ID: [["race", "white", 3.2, 2.2]],
    ND: [["race", "white", 3.2, 1.6]],
    KY: [["race", "white", 3, 2.4]],
    LA: [["race", "white", 3, 2.2]],
    TN: [["race", "white", 3, 2.2]],
    SD: [["race", "white", 3, 1.6]],
    SC: [["race", "white", 2.8, 2]],
    MT: [["race", "white", 2.5, 1]],
    NE: [["race", "white", 2.5, 1.4]],
    IN: [["race", "white", 2.2, 1.4]],
    IA: [["race", "white", 2.2, 0.8]],
    MO: [["race", "white", 2.2, 1.4]],
    KS: [["race", "white", 2.2, 1.2]],
    NC: [["race", "white", 2.2, 0.6]],
    GA: [["race", "white", 2.2, 0.8]], // Atlanta suburbs pull it off the Deep South line
    AK: [["race", "white", 2.2, 1]],
    OH: [["race", "white", 2, 1]],
    TX: [["race", "white", 2, 1.2]],
    FL: [["race", "white", 2, 0.8]],
    UT: [["race", "white", 2, 1.6]], // Trump underperformed the historical R share
    // The Rust Belt tips — but only just.
    AZ: [["race", "white", 1.2, 0.4]],
    NV: [["race", "white", 1, -0.4]],
    MI: [["race", "white", 1, -0.2]],
    WI: [["race", "white", 1, -0.2]],
    PA: [["race", "white", 1, -0.2]],
    VA: [["race", "white", 1, -0.4]], // northern-Virginia suburbs
    MN: [["race", "white", 0.8, -0.6]],
    NH: [["race", "white", 0, -0.4]],
    ME: [["race", "white", 0, -0.8]],
    IL: [["race", "white", 0.3, -0.8]],
    CO: [["race", "white", 0.3, -0.6]], // fully realigned away from its 1992 position
    NM: [["race", "white", 0.3, -0.6]],
    // Coasts + Northeast.
    OR: [["race", "white", -0.3, -1.4]],
    WA: [["race", "white", -0.3, -1.4]],
    CA: [["race", "white", -0.5, -1.6]],
    NY: [["race", "white", -0.5, -1.4]],
    NJ: [["race", "white", -0.5, -1]],
    RI: [["race", "white", -0.5, -1.2]],
    DE: [["race", "white", -0.5, -1]],
    CT: [["race", "white", -0.8, -1.2]],
    MD: [["race", "white", -1, -1.4]],
    HI: [["race", "white", -1, -1.8]],
    MA: [["race", "white", -1.2, -1.8]],
    VT: [["race", "white", -1.5, -1.8]],
    DC: [["race", "white", -3.0, -2.5]],
  },
};
