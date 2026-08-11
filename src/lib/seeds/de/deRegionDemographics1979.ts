import type { StateDemographics } from "@/lib/db/types";

/**
 * German Bundesländer demographic composition for the 1979 era, using the
 * same 12 DE voter archetypes and Land IDs as `deRegionDemographics.ts`.
 *
 * Era anchor: autumn 1979 — Schmidt-era West Germany (SPD/FDP coalition,
 * Modell Deutschland, union density ~35%, Gastarbeiter communities settled
 * in NRW/BW/Hessen but largely non-enfranchised), Greens not yet founded as
 * a federal party (January 1980). 1976 Bundestag turnout was 90.7%, 1980 was
 * 88.6% — western turnouts here sit in the high 80s/low 90s.
 *
 * Every value is authored independently from historical sources (1976/1980
 * Bundestag results by Land, 1970s Mikrozensus occupational structure, DDR
 * Statistisches Jahrbuch employment shares). Nothing is scaled from the
 * 2019 file.
 *
 * DESIGN DECISION — the divided Germany problem: Germany was two states in
 * 1979, but the game keeps all 16 Länder. Eastern Länder (BB, MV, SN, ST,
 * TH, and East Berlin's share of BE) are authored with DDR-era profiles
 * mapped onto the existing archetype IDs:
 *  - `ost_post_industriell` = the dominant SED-state industrial/state-sector
 *    workforce (VEB Kombinat workers) — NOT yet "post"-industrial; this is
 *    the cohort at full employment that becomes post-industrial after 1990.
 *  - `gewerkschafter` = FDGB-organised workers outside heavy industry.
 *  - `landwirte_dorf` = LPG collective-farm members (very large in MV/ST).
 *  - `urbane_progressive` = the urban intelligentsia / church-adjacent
 *    dissident milieu (small).
 *  - `gruene_mittelschicht` = 0 everywhere east (no green middle class);
 *    kept tiny (1-2) in the west (proto-green citizens' initiatives only).
 *  - `protest_waehler_ost` ≈ 0-1: open protest voting did not exist under
 *    the SED state; the residual 1 represents suppressed dissent.
 *  - `migranten_communities` ≈ 0-1 east (small Vertragsarbeiter contingents).
 *  - `wirtschaftsliberale` / `mittelstand_selbstaendige` near zero east
 *    (residual private craftsmen only).
 * Eastern turnouts are high (low 90s) reflecting mobilised, quasi-mandatory
 * participation in DDR elections rather than free electoral enthusiasm.
 */

type GroupValues = {
  population: number;
  economicLean: number;
  socialLean: number;
  turnout: number;
};
type LeanRow = { economicLean: number; socialLean: number; turnout: number };

const GROUP_IDS = [
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
] as const;

type GroupId = (typeof GROUP_IDS)[number];

// West 1979: Schmidt-era polarisation — strong class voting, very high turnout,
// Gastarbeiter mostly non-citizens (turnout 40 = the small naturalised slice votes).
const WEST_1979: Record<GroupId, LeanRow> = {
  katholische_konservative: { economicLean: 2, socialLean: 3, turnout: 90 },
  gewerkschafter: { economicLean: -3, socialLean: 1, turnout: 89 },
  urbane_progressive: { economicLean: -2, socialLean: -2, turnout: 88 },
  wirtschaftsliberale: { economicLean: 3, socialLean: 0, turnout: 90 },
  ost_post_industriell: { economicLean: -2, socialLean: 2, turnout: 85 }, // DDR-refugee/Vertriebene legacy milieu
  gruene_mittelschicht: { economicLean: -1, socialLean: -3, turnout: 84 }, // proto-green citizens' initiatives
  rentner_west: { economicLean: 1, socialLean: 3, turnout: 90 },
  migranten_communities: { economicLean: -1, socialLean: 0, turnout: 40 },
  landwirte_dorf: { economicLean: 1, socialLean: 3, turnout: 89 },
  junge_grossstadt: { economicLean: -3, socialLean: -3, turnout: 83 },
  protest_waehler_ost: { economicLean: 0, socialLean: 3, turnout: 75 },
  mittelstand_selbstaendige: { economicLean: 3, socialLean: 1, turnout: 90 },
};

// East 1979: SED state — mobilised participation (~92), state-socialist economic
// leans, socially conservative-by-default society with a small dissident milieu.
const EAST_1979: Record<GroupId, LeanRow> = {
  katholische_konservative: { economicLean: 1, socialLean: 2, turnout: 85 }, // church milieu, partially withdrawn
  gewerkschafter: { economicLean: -4, socialLean: 1, turnout: 93 }, // FDGB-organised
  urbane_progressive: { economicLean: -2, socialLean: -2, turnout: 90 }, // intelligentsia/dissident-adjacent
  wirtschaftsliberale: { economicLean: 1, socialLean: 0, turnout: 88 },
  ost_post_industriell: { economicLean: -4, socialLean: 1, turnout: 93 }, // VEB industrial workforce
  gruene_mittelschicht: { economicLean: -1, socialLean: -2, turnout: 80 }, // church-basement environmental circles
  rentner_west: { economicLean: -1, socialLean: 2, turnout: 92 },
  migranten_communities: { economicLean: -1, socialLean: 0, turnout: 50 }, // Vertragsarbeiter
  landwirte_dorf: { economicLean: -3, socialLean: 2, turnout: 92 }, // LPG members
  junge_grossstadt: { economicLean: -3, socialLean: -1, turnout: 90 }, // FDJ-socialised youth
  protest_waehler_ost: { economicLean: 0, socialLean: 1, turnout: 70 }, // suppressed dissent
  mittelstand_selbstaendige: { economicLean: 2, socialLean: 1, turnout: 88 }, // residual private craftsmen
};

function buildGroups(
  leans: Record<GroupId, LeanRow>,
  populations: Record<GroupId, number>
): Record<string, GroupValues> {
  const groups: Record<string, GroupValues> = {};
  for (const id of GROUP_IDS) {
    groups[id] = { population: populations[id], ...leans[id] };
  }
  return groups;
}

function land(
  _id: string,
  leans: Record<GroupId, LeanRow>,
  populations: Record<GroupId, number>
): StateDemographics {
  return {
    _id,
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: buildGroups(leans, populations),
    lastUpdated: new Date(),
  } as StateDemographics;
}

export const deRegionDemographics1979: StateDemographics[] = [
  // ── Süden ──────────────────────────────────────────────────────────────────

  // Baden-Württemberg 1979: CDU-run, devout Catholic south + Swabian
  // Mittelstand; large Gastarbeiter workforce in Stuttgart/Mannheim industry.
  land("BW", WEST_1979, {
    katholische_konservative: 20,
    gewerkschafter: 13,
    urbane_progressive: 6,
    wirtschaftsliberale: 12,
    ost_post_industriell: 1,
    gruene_mittelschicht: 2,
    rentner_west: 9,
    migranten_communities: 6,
    landwirte_dorf: 10,
    junge_grossstadt: 4,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 17,
  }),

  // Bayern 1979: Strauß-era CSU hegemony — peak Catholic-conservative share,
  // still strongly agrarian outside Munich.
  land("BY", WEST_1979, {
    katholische_konservative: 30,
    gewerkschafter: 10,
    urbane_progressive: 5,
    wirtschaftsliberale: 9,
    ost_post_industriell: 1,
    gruene_mittelschicht: 1,
    rentner_west: 9,
    migranten_communities: 4,
    landwirte_dorf: 16,
    junge_grossstadt: 3,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 12,
  }),

  // ── Westen ─────────────────────────────────────────────────────────────────

  // Nordrhein-Westfalen 1979: coal-and-steel Ruhr at near-peak employment —
  // the largest union bloc in the federal republic; biggest Gastarbeiter
  // concentration; Rhineland Catholic milieu still intact.
  land("NW", WEST_1979, {
    katholische_konservative: 18,
    gewerkschafter: 26,
    urbane_progressive: 7,
    wirtschaftsliberale: 9,
    ost_post_industriell: 1,
    gruene_mittelschicht: 2,
    rentner_west: 10,
    migranten_communities: 9,
    landwirte_dorf: 5,
    junge_grossstadt: 5,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 8,
  }),

  // Hessen 1979: Frankfurt banking + Opel/Hoechst industrial belt; early
  // Bürgerinitiativen scene (Startbahn West) but no green party yet.
  land("HE", WEST_1979, {
    katholische_konservative: 16,
    gewerkschafter: 17,
    urbane_progressive: 9,
    wirtschaftsliberale: 11,
    ost_post_industriell: 1,
    gruene_mittelschicht: 2,
    rentner_west: 9,
    migranten_communities: 8,
    landwirte_dorf: 8,
    junge_grossstadt: 5,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 14,
  }),

  // Rheinland-Pfalz 1979: Kohl's home Land — deeply Catholic, wine-growing
  // and small-farm rural, strong self-employed Mittelstand.
  land("RP", WEST_1979, {
    katholische_konservative: 24,
    gewerkschafter: 12,
    urbane_progressive: 5,
    wirtschaftsliberale: 8,
    ost_post_industriell: 1,
    gruene_mittelschicht: 1,
    rentner_west: 9,
    migranten_communities: 4,
    landwirte_dorf: 16,
    junge_grossstadt: 3,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 17,
  }),

  // Saarland 1979: coal/steel mono-industry at the edge of its first crisis;
  // union density rivals the Ruhr; Catholic working-class milieu.
  land("SL", WEST_1979, {
    katholische_konservative: 22,
    gewerkschafter: 26,
    urbane_progressive: 4,
    wirtschaftsliberale: 6,
    ost_post_industriell: 0,
    gruene_mittelschicht: 1,
    rentner_west: 10,
    migranten_communities: 4,
    landwirte_dorf: 6,
    junge_grossstadt: 3,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 18,
  }),

  // ── Norden ─────────────────────────────────────────────────────────────────

  // Niedersachsen 1979: VW-Wolfsburg union belt + the largest western farm
  // sector; notable DDR-refugee/expellee legacy near the inner border.
  land("NI", WEST_1979, {
    katholische_konservative: 9,
    gewerkschafter: 20,
    urbane_progressive: 6,
    wirtschaftsliberale: 9,
    ost_post_industriell: 2,
    gruene_mittelschicht: 2,
    rentner_west: 10,
    migranten_communities: 4,
    landwirte_dorf: 18,
    junge_grossstadt: 4,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 16,
  }),

  // Schleswig-Holstein 1979: Protestant agrarian north, shipyard workers in
  // Kiel/Lübeck, strong small-business and farm economy.
  land("SH", WEST_1979, {
    katholische_konservative: 5,
    gewerkschafter: 16,
    urbane_progressive: 7,
    wirtschaftsliberale: 10,
    ost_post_industriell: 2,
    gruene_mittelschicht: 2,
    rentner_west: 12,
    migranten_communities: 2,
    landwirte_dorf: 18,
    junge_grossstadt: 4,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 22,
  }),

  // Hamburg 1979: SPD port-city stronghold — dockworkers + Hanseatic
  // liberal bourgeoisie + a large student/alternative scene.
  land("HH", WEST_1979, {
    katholische_konservative: 3,
    gewerkschafter: 18,
    urbane_progressive: 16,
    wirtschaftsliberale: 13,
    ost_post_industriell: 2,
    gruene_mittelschicht: 3,
    rentner_west: 11,
    migranten_communities: 8,
    landwirte_dorf: 1,
    junge_grossstadt: 13,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 12,
  }),

  // Bremen 1979: shipbuilding (AG Weser) still alive — peak SPD/union city.
  land("BRE", WEST_1979, {
    katholische_konservative: 3,
    gewerkschafter: 26,
    urbane_progressive: 13,
    wirtschaftsliberale: 7,
    ost_post_industriell: 1,
    gruene_mittelschicht: 3,
    rentner_west: 10,
    migranten_communities: 9,
    landwirte_dorf: 1,
    junge_grossstadt: 11,
    protest_waehler_ost: 0,
    mittelstand_selbstaendige: 16,
  }),

  // ── Osten (DDR profiles — see header) ──────────────────────────────────────

  // Berlin 1979: a blended profile of walled West Berlin (alternative scene,
  // students, Gastarbeiter in Kreuzberg) and East Berlin (DDR capital,
  // state-sector workforce). Uses east leans for the dominant state cohorts.
  land("BE", EAST_1979, {
    katholische_konservative: 4,
    gewerkschafter: 16,
    urbane_progressive: 13,
    wirtschaftsliberale: 6,
    ost_post_industriell: 22,
    gruene_mittelschicht: 2,
    rentner_west: 9,
    migranten_communities: 6,
    landwirte_dorf: 0,
    junge_grossstadt: 14,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 7,
  }),

  // Brandenburg 1979: DDR Bezirke Potsdam/Frankfurt/Cottbus — lignite and
  // steel (Eisenhüttenstadt) plus very large LPG agriculture.
  land("BB", EAST_1979, {
    katholische_konservative: 2,
    gewerkschafter: 14,
    urbane_progressive: 3,
    wirtschaftsliberale: 1,
    ost_post_industriell: 42,
    gruene_mittelschicht: 0,
    rentner_west: 8,
    migranten_communities: 1,
    landwirte_dorf: 22,
    junge_grossstadt: 4,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 2,
  }),

  // Mecklenburg-Vorpommern 1979: Bezirke Rostock/Schwerin/Neubrandenburg —
  // shipyards on the coast, otherwise the most agricultural DDR region.
  land("MV", EAST_1979, {
    katholische_konservative: 1,
    gewerkschafter: 12,
    urbane_progressive: 2,
    wirtschaftsliberale: 1,
    ost_post_industriell: 38,
    gruene_mittelschicht: 0,
    rentner_west: 8,
    migranten_communities: 1,
    landwirte_dorf: 32,
    junge_grossstadt: 3,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 1,
  }),

  // Sachsen 1979: the DDR's industrial core (Karl-Marx-Stadt, Leipzig,
  // Dresden) — highest industrial-workforce share in either Germany.
  land("SN", EAST_1979, {
    katholische_konservative: 2,
    gewerkschafter: 16,
    urbane_progressive: 5,
    wirtschaftsliberale: 1,
    ost_post_industriell: 48,
    gruene_mittelschicht: 0,
    rentner_west: 9,
    migranten_communities: 1,
    landwirte_dorf: 9,
    junge_grossstadt: 5,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 3,
  }),

  // Sachsen-Anhalt 1979: Bezirke Halle/Magdeburg — chemical triangle (Leuna,
  // Buna, Bitterfeld) plus heavy LPG agriculture in the Börde.
  land("ST", EAST_1979, {
    katholische_konservative: 1,
    gewerkschafter: 15,
    urbane_progressive: 3,
    wirtschaftsliberale: 1,
    ost_post_industriell: 47,
    gruene_mittelschicht: 0,
    rentner_west: 8,
    migranten_communities: 1,
    landwirte_dorf: 17,
    junge_grossstadt: 4,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 2,
  }),

  // Thüringen 1979: Bezirke Erfurt/Gera/Suhl — optics (Zeiss Jena) and
  // machine industry; the Catholic Eichsfeld pocket survives the SED state.
  land("TH", EAST_1979, {
    katholische_konservative: 5,
    gewerkschafter: 15,
    urbane_progressive: 4,
    wirtschaftsliberale: 1,
    ost_post_industriell: 44,
    gruene_mittelschicht: 0,
    rentner_west: 8,
    migranten_communities: 1,
    landwirte_dorf: 14,
    junge_grossstadt: 4,
    protest_waehler_ost: 1,
    mittelstand_selbstaendige: 3,
  }),
];
