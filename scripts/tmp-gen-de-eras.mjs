// Temporary generator for era-specific DE region demographics files.
import fs from "node:fs";

const GROUPS = [
  "katholische_konservative",
  "gewerkschafter",
  "urbane_progressive",
  "wirtschaftsliberale",
  "ost_post_industriell",
  "gruene_mittelschicht",
  "rentner_west",
  "migranten_communities",
  "landwirte_dorf",
  "junge_grossstadt",
  "protest_waehler_ost",
  "mittelstand_selbstaendige",
];

// Per-era group templates: [economicLean, socialLean, turnout]
const TEMPLATES = {
  1999: {
    katholische_konservative: [2, 3, 86],
    gewerkschafter: [-3, 1, 84],
    urbane_progressive: [-2, -3, 83],
    wirtschaftsliberale: [3, 0, 86],
    ost_post_industriell: [-3, 1, 72],
    gruene_mittelschicht: [-1, -3, 85],
    rentner_west: [1, 3, 88],
    migranten_communities: [-1, -1, 55],
    landwirte_dorf: [1, 3, 84],
    junge_grossstadt: [-2, -3, 68],
    protest_waehler_ost: [-2, 2, 70],
    mittelstand_selbstaendige: [3, 1, 86],
  },
  2007: {
    katholische_konservative: [2, 2, 82],
    gewerkschafter: [-3, 0, 79],
    urbane_progressive: [-2, -3, 80],
    wirtschaftsliberale: [3, -1, 83],
    ost_post_industriell: [-3, 1, 68],
    gruene_mittelschicht: [-1, -3, 84],
    rentner_west: [1, 2, 86],
    migranten_communities: [-1, -2, 58],
    landwirte_dorf: [1, 3, 81],
    junge_grossstadt: [-3, -3, 62],
    protest_waehler_ost: [-1, 3, 66],
    mittelstand_selbstaendige: [3, 1, 83],
  },
  2023: {
    katholische_konservative: [2, 2, 80],
    gewerkschafter: [-3, 0, 76],
    urbane_progressive: [-2, -4, 80],
    wirtschaftsliberale: [3, -1, 82],
    ost_post_industriell: [-2, 2, 68],
    gruene_mittelschicht: [-1, -4, 85],
    rentner_west: [1, 2, 85],
    migranten_communities: [-1, -2, 60],
    landwirte_dorf: [1, 3, 79],
    junge_grossstadt: [-3, -4, 64],
    protest_waehler_ost: [0, 4, 73],
    mittelstand_selbstaendige: [3, 1, 81],
  },
};

// Populations per Land, in GROUPS order.
const POPS = {
  1999: {
    BW: [16, 12, 7, 15, 1, 8, 11, 6, 8, 5, 1, 10],
    BY: [25, 11, 6, 12, 1, 5, 12, 5, 12, 5, 1, 5],
    NW: [14, 22, 8, 10, 1, 6, 10, 9, 5, 6, 1, 8],
    HE: [14, 13, 10, 13, 1, 8, 9, 7, 7, 7, 1, 10],
    RP: [19, 12, 6, 9, 1, 5, 10, 5, 13, 4, 1, 15],
    SL: [16, 23, 5, 6, 1, 4, 12, 5, 6, 3, 1, 18],
    NI: [9, 19, 7, 9, 1, 6, 11, 5, 14, 5, 1, 13],
    SH: [6, 11, 7, 11, 1, 8, 13, 3, 13, 4, 1, 22],
    HH: [3, 14, 17, 13, 1, 9, 9, 7, 1, 15, 1, 10],
    BRE: [3, 22, 14, 7, 1, 8, 9, 10, 1, 14, 1, 10],
    BE: [3, 10, 17, 8, 13, 7, 6, 9, 0, 17, 6, 4],
    BB: [2, 9, 4, 4, 28, 3, 4, 1, 14, 6, 20, 5],
    MV: [2, 7, 3, 3, 30, 2, 3, 1, 17, 5, 23, 4],
    SN: [3, 10, 6, 5, 27, 3, 4, 1, 9, 6, 20, 6],
    ST: [2, 9, 4, 4, 30, 2, 4, 1, 14, 5, 22, 3],
    TH: [5, 10, 5, 4, 28, 3, 4, 1, 12, 5, 20, 3],
  },
  2007: {
    BW: [15, 10, 8, 15, 1, 11, 12, 7, 7, 4, 1, 9],
    BY: [24, 9, 6, 12, 1, 7, 13, 6, 11, 4, 1, 6],
    NW: [13, 19, 9, 10, 1, 7, 11, 11, 4, 5, 2, 8],
    HE: [14, 11, 10, 13, 1, 9, 10, 9, 6, 6, 2, 9],
    RP: [18, 10, 6, 9, 1, 6, 11, 6, 12, 4, 2, 15],
    SL: [14, 20, 5, 7, 1, 5, 13, 6, 5, 3, 3, 18],
    NI: [9, 17, 7, 9, 1, 7, 12, 6, 13, 5, 2, 12],
    SH: [6, 10, 7, 11, 1, 10, 14, 4, 12, 4, 2, 19],
    HH: [3, 12, 18, 12, 1, 11, 10, 8, 1, 14, 1, 9],
    BRE: [3, 20, 14, 6, 1, 10, 10, 12, 1, 13, 2, 8],
    BE: [3, 8, 18, 7, 11, 9, 6, 11, 0, 17, 6, 4],
    BB: [2, 8, 5, 4, 25, 4, 5, 2, 13, 5, 22, 5],
    MV: [2, 6, 4, 3, 27, 3, 4, 1, 16, 4, 26, 4],
    SN: [3, 9, 6, 5, 24, 4, 4, 2, 9, 5, 23, 6],
    ST: [2, 8, 4, 4, 27, 3, 4, 1, 14, 4, 26, 3],
    TH: [4, 9, 5, 4, 26, 4, 4, 2, 12, 4, 23, 3],
  },
  2023: {
    BW: [13, 8, 8, 13, 1, 15, 13, 11, 5, 4, 2, 7],
    BY: [20, 7, 7, 11, 1, 10, 14, 9, 8, 4, 3, 6],
    NW: [11, 14, 9, 10, 1, 10, 12, 15, 3, 5, 4, 6],
    HE: [12, 8, 11, 12, 1, 12, 11, 12, 5, 6, 4, 6],
    RP: [15, 8, 7, 8, 1, 9, 13, 8, 10, 4, 4, 13],
    SL: [11, 15, 6, 7, 1, 7, 15, 9, 5, 3, 5, 16],
    NI: [8, 13, 8, 9, 1, 10, 14, 8, 11, 5, 4, 9],
    SH: [5, 7, 8, 10, 1, 13, 16, 6, 10, 4, 4, 16],
    HH: [3, 9, 18, 11, 1, 14, 10, 12, 1, 13, 2, 6],
    BRE: [3, 15, 15, 6, 1, 12, 10, 16, 1, 11, 4, 6],
    BE: [3, 6, 19, 7, 7, 11, 7, 14, 0, 16, 6, 4],
    BB: [3, 7, 6, 5, 18, 6, 8, 3, 11, 5, 24, 4],
    MV: [2, 5, 4, 4, 21, 4, 7, 2, 14, 4, 29, 4],
    SN: [3, 7, 8, 5, 17, 5, 7, 3, 8, 5, 28, 4],
    ST: [2, 6, 5, 4, 20, 4, 7, 2, 12, 4, 30, 4],
    TH: [4, 7, 6, 4, 19, 5, 7, 3, 10, 4, 28, 3],
  },
};

const LAND_COMMENTS = {
  1999: {
    BW: "Baden-Württemberg: CDU-FDP heartland, Mittelstand prosperity; Greens present in Stuttgart/Freiburg but pre-Kretschmann breakthrough.",
    BY: "Bayern: Stoiber-era CSU dominance, deepest Catholic-rural base in the federation, large farm sector.",
    NW: "Nordrhein-Westfalen: Ruhr at the tail of coal/steel — union membership still mass-scale; SPD heartland under Clement.",
    HE: "Hessen: Koch's CDU rising; Frankfurt finance + early red-green urban milieu (Fischer's home base).",
    RP: "Rheinland-Pfalz: Catholic, rural, wine-country Mittelstand; Beck's SPD-FDP coalition.",
    SL: "Saarland: Coal/steel twilight, heavy union density, Lafontaine's home turf at peak SPD strength.",
    NI: "Niedersachsen: Schröder's springboard — VW industrial unionism plus a large farm belt.",
    SH: "Schleswig-Holstein: Rural-coastal, Simonis SPD era; small-business and farming heavy, few migrants.",
    HH: "Hamburg: SPD Hanseatic port city; pre-gentrification — strong dock unions, sizable young/alternative scene.",
    BRE: "Bremen: SPD grand-coalition city, shipyard-collapse aftermath, high union and migrant share for the era.",
    BE: "Berlin: Post-reunification capital-in-transition; large eastern post-industrial bloc, PDS strong in the east half.",
    BB: "Brandenburg: Stolpe's SPD east; mass unemployment, emigration outflow beginning, PDS protest entrenched.",
    MV: "Mecklenburg-Vorpommern: First SPD-PDS coalition (1998); ~20% unemployment, deepest post-industrial dislocation.",
    SN: "Sachsen: Biedenkopf's CDU 'König Kurt' era; industrial collapse cushioned by CDU loyalty, PDS strong.",
    ST: "Sachsen-Anhalt: Magdeburg model (SPD tolerated by PDS); worst unemployment in the federation.",
    TH: "Thüringen: Vogel CDU majority; PDS the dominant opposition, heavy industrial job losses.",
  },
  2007: {
    BW: "Baden-Württemberg: Oettinger CDU; export-boom prosperity, Greens consolidating in university cities.",
    BY: "Bayern: Late Stoiber CSU; booming exports, Munich pulling young professionals.",
    NW: "Nordrhein-Westfalen: Rüttgers CDU interlude; Hartz-IV resentment feeds early western Linke vote in the Ruhr.",
    HE: "Hessen: Koch CDU; Frankfurt finance peak pre-crash, growing migrant-background communities.",
    RP: "Rheinland-Pfalz: Beck SPD absolute majority (2006); stable rural Mittelstand profile.",
    SL: "Saarland: Lafontaine's WASG/Linke surge strongest in the west here; declining industry, aging fast.",
    NI: "Niedersachsen: Wulff CDU; VW unionism intact but thinning, large agricultural sector.",
    SH: "Schleswig-Holstein: Grand coalition under Carstensen; rural small-business profile persists.",
    HH: "Hamburg: Von Beust CDU city government; harbour boom, gentrification accelerating in inner districts.",
    BRE: "Bremen: SPD-Grüne (first in 2007); structural decline, high migrant share, western Linke beachhead.",
    BE: "Berlin: Wowereit's red-red 'poor but sexy' era; creative-class influx alongside eastern Linke base.",
    BB: "Brandenburg: SPD-CDU under Platzeck; emigration drain continues, Linke at peak protest strength.",
    MV: "Mecklenburg-Vorpommern: Grand coalition; NPD in Landtag (2006) signals hard-protest undercurrent; Linke very strong.",
    SN: "Sachsen: CDU-SPD; Linke the main eastern protest channel, NPD presence; Leipzig/Dresden slowly reviving.",
    ST: "Sachsen-Anhalt: CDU-SPD under Böhmer; deepest demographic decline, Linke near parity with CDU.",
    TH: "Thüringen: Althaus CDU; Linke (Ramelow rising) the strongest opposition in its best Land.",
  },
  2023: {
    BW: "Baden-Württemberg: Kretschmann's Green-led Land; graduate-green milieu large, migrant-background share high in industrial towns.",
    BY: "Bayern: Söder CSU + Freie-Wähler-flavoured rural protest; Munich green-progressive counterweight.",
    NW: "Nordrhein-Westfalen: Wüst CDU-Grüne; post-industrial Ruhr unions shrunken, very high migrant-background urban share.",
    HE: "Hessen: Rhein CDU; Frankfurt majority-minority among under-40s, strong green graduate bloc.",
    RP: "Rheinland-Pfalz: Dreyer SPD traffic-light; aging rural base, AfD growing in former industrial corners.",
    SL: "Saarland: Rehlinger SPD majority; oldest western Land profile, industrial transition anxiety feeds protest.",
    NI: "Niedersachsen: Weil SPD-Grüne; VW transformation angst, agrarian protest (tractor era) in the north-west.",
    SH: "Schleswig-Holstein: Günther CDU-Grüne; wind-energy consensus, strong green-rural coexistence.",
    HH: "Hamburg: SPD-Grüne; gentrified inner city, ~35%+ migrant-background population, weak protest vote.",
    BRE: "Bremen: SPD-Grüne-Linke; poorest western Land, highest western migrant share, BIW-style protest niche.",
    BE: "Berlin: Post-Mitte-Links repeat election, Wegner CDU; huge young-urban and migrant blocs, eastern legacy fading.",
    BB: "Brandenburg: Woidke SPD holding against AfD plurality polling; aged east, Tesla/lignite transition tension.",
    MV: "Mecklenburg-Vorpommern: Schwesig SPD; oldest Land, AfD strongest bloc in rural districts.",
    SN: "Sachsen: Kretschmer CDU vs AfD near-parity; Leipzig boomtown progressives vs rural protest belt.",
    ST: "Sachsen-Anhalt: Haseloff CDU; deepest aging and emigration legacy, AfD structurally entrenched.",
    TH: "Thüringen: Ramelow Linke minority government; Höcke's AfD strongest in polling — maximum east polarisation.",
  },
};

const DOCS = {
  1999: `/**
 * German Bundesländer voter-group demographics — 1999 era (Schröder red-green).
 *
 * Era anchor: the first Schröder cabinet (SPD-Grüne, elected 1998 at ~82%
 * turnout). The Berlin Republic is just moving in; eastern Länder are at the
 * depth of post-reunification deindustrialisation — double-digit unemployment,
 * the westward emigration wave underway, and the PDS as the established eastern
 * protest/identity vote. In the west: union membership still mass-scale in the
 * Ruhr, Saar and VW belt (decline only beginning), the Greens an established
 * but still mid-sized western-urban party, migrant-background communities
 * (Gastarbeiter families, incoming Spätaussiedler) growing but well below
 * later-era shares, and a younger overall age profile than the 2020s.
 *
 * Methodology: every population share, lean and turnout below was authored
 * independently from historical knowledge of the 1998 Bundestag and late-1990s
 * Landtag results, era unemployment/demographic data and party-system shape.
 * No value is scaled or derived from the 2019 baseline file; only the Land IDs,
 * group IDs and document shape are shared. Population shares per Land sum to
 * 100. Turnouts reflect the high-participation late-90s norm (national ~82%,
 * eastern groups lower).
 */`,
  2007: `/**
 * German Bundesländer voter-group demographics — 2007 era (Merkel I grand
 * coalition, Hartz-IV aftermath).
 *
 * Era anchor: the CDU/CSU-SPD grand coalition after the 2005 snap election
 * (~78% turnout). Agenda-2010/Hartz-IV resentment has just fused Lafontaine's
 * WASG with the PDS into Die Linke, surging among the eastern post-industrial
 * bloc and opening a first western protest beachhead in the Saar and Ruhr
 * precariat. The pre-crash export boom delivers visible prosperity in
 * Baden-Württemberg and Bavaria; the Greens are a stable mid-sized party;
 * union cohorts are clearly shrinking from their 1990s mass base; eastern
 * emigration and aging continue; migrant-background communities are growing
 * through family consolidation (pre-2015, so well below 2020s shares).
 *
 * Methodology: every population share, lean and turnout below was authored
 * independently from historical knowledge of the 2005 Bundestag election,
 * mid-2000s Landtag results, Destatis-era demographic profiles and the
 * Hartz-IV-period labour market. No value is scaled or derived from the 2019
 * baseline file; only the Land IDs, group IDs and document shape are shared.
 * Population shares per Land sum to 100. The protest_waehler_ost archetype is
 * Linke-coded in this era (economically left, mildly socially conservative),
 * unlike its AfD coding in later eras.
 */`,
  2023: `/**
 * German Bundesländer voter-group demographics — 2023 era (Ampel coalition).
 *
 * Era anchor: the SPD-Grüne-FDP "traffic light" government after the 2021
 * Bundestag election (~77% turnout), seen from 2023: post-2015 integration is
 * demographically visible (migrant-background shares around 30%+ in big
 * western cities), the Greens are a large party of the urban graduate
 * middle class, AfD-coded protest blocs dominate rural eastern districts and
 * are clearly growing in the west (energy-price and migration backlash),
 * union/industrial cohorts have shrunk to a fraction of their 1990s base,
 * and the eastern Länder are the oldest in the federation after three decades
 * of emigration. The protest_waehler_ost archetype is AfD-coded: strongly
 * socially right, economically ambivalent.
 *
 * Methodology: every population share, lean and turnout below was authored
 * independently from historical knowledge of the 2021 Bundestag result, the
 * 2022-2023 Landtag elections and polling (AfD surge year), Destatis 2022
 * regional demographics and Mikrozensus migration-background data. No value
 * is scaled or derived from the 2019 baseline file; only the Land IDs, group
 * IDs and document shape are shared. Population shares per Land sum to 100.
 */`,
};

function emit(era) {
  const tmpl = TEMPLATES[era];
  const pops = POPS[era];
  const lines = [];
  lines.push(`import type { StateDemographics } from "@/lib/db/types";`, "");
  lines.push(DOCS[era]);
  lines.push(`export const deRegionDemographics${era}: StateDemographics[] = [`);
  for (const [land, vals] of Object.entries(pops)) {
    lines.push(`  // ${LAND_COMMENTS[era][land]}`);
    lines.push(`  {`);
    lines.push(`    _id: "${land}",`);
    lines.push(`    countryId: "DE",`);
    lines.push(`    categoryWeights: { de_voterGroups: 100 },`);
    lines.push(`    groups: {`);
    GROUPS.forEach((g, i) => {
      const [e, s, t] = tmpl[g];
      lines.push(
        `      ${g}: { population: ${vals[i]}, economicLean: ${e}, socialLean: ${s}, turnout: ${t} },`
      );
    });
    lines.push(`    },`);
    lines.push(`    lastUpdated: new Date(),`);
    lines.push(`  },`);
    lines.push(``);
  }
  lines.pop();
  lines.push(`];`, ``);
  fs.writeFileSync(`src/lib/seeds/de/deRegionDemographics${era}.ts`, lines.join("\n"));
  console.log(`wrote deRegionDemographics${era}.ts`);
}

for (const era of [1999, 2007, 2023]) emit(era);
