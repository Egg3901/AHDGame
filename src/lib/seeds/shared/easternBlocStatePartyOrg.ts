/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era's table is authored self-contained. These are one-party states, so
 * regional org is an authored distribution per era, not a vote-share × formula.
 * (Mirrors ruStatePartyOrgCalculations.ts / ddStatePartyOrgCalculations.ts.)
 *
 * Regional party organisation for the six Warsaw-Pact satellites plus the three
 * Soviet union republics modelled as their own countries (UKR/BLR/BAL, whose
 * republican parties were branches of the CPSU but ran their own regional
 * apparat, so the same one-party shape applies). Unlike the
 * GDR — which runs a National Front of five captive parties — each satellite
 * here seeds exactly ONE party, its ruling communist party, so the table is a
 * single org percentage per region rather than a per-party split.
 *
 * Why this matters mechanically, not just as flavour: `statePartyOrg.registration`
 * is what gates the swing-flow engine's §7.3.2 defense via the `regByParty` map.
 * With no row at all, the ruling party falls to the newcomer baseline and is
 * ~20%-peelable under `transferableShare` / `persuasionResistance` — i.e. the
 * PZPR could be organised out of Silesia by a party that did not exist. The
 * shared `seedRegistrationLanes` pipeline only covers US/UK/JP/DE, so these set
 * `registration` inline, following the RU/CN/DD precedent.
 *
 * Historical texture. 1953 org is HIGHER than 1979 almost everywhere: the
 * Stalinist parties were mass-mobilisation organisations at their peak reach,
 * with membership drives, workplace cells and compulsory participation. By 1979
 * the same parties are careerist administrative machines — larger on paper in
 * some countries, but thinner as a share of genuine organised presence, and
 * visibly weaker in the places that had already revolted or resisted.
 */

export interface EasternBlocOrgProfile {
  /** Ruling-party sequentialId — always "1" (seedOrder 1 in every roster). */
  seqId: string;
  /** Party treasury per era, in local currency. */
  treasury: Record<"1953" | "1979", number>;
  /** Regional organisation percentage, per era, keyed by region `_id`. */
  org: Record<"1953" | "1979", Record<string, number>>;
  /** Regional party tax rate. */
  stateTaxRate: number;
}

export const EASTERN_BLOC_STATE_PARTY_ORG: Record<string, EasternBlocOrgProfile> = {
  // Poland — PZPR. Weakest party penetration in the bloc in both eras: the
  // Church is the rival mass institution, private farms kept the countryside
  // outside the party's reach, and the east is its thinnest ground. Silesia and
  // the new industrial centres are its real base. By 1979 the party has visibly
  // receded in the Baltic shipyard belt — Gdańsk is a year away.
  PL: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 120_000_000, "1979": 900_000_000 },
    org: {
      "1953": {
        PL_MAZ: 58,
        PL_LOD: 57,
        PL_MAL: 48,
        PL_SLK: 62,
        PL_DSL: 55,
        PL_WLK: 50,
        PL_POM: 52,
        PL_EAS: 42,
      },
      "1979": {
        PL_MAZ: 54,
        PL_LOD: 52,
        PL_MAL: 43,
        PL_SLK: 58,
        PL_DSL: 51,
        PL_WLK: 47,
        PL_POM: 44, // the shipyard coast; Solidarity forms here in 1980
        PL_EAS: 39,
      },
    },
  },

  // Hungary — MDP in 1953 (Rákosi), MSZMP in 1979 (Kádár). The 1953 figures are
  // the high-water mark of the most literally Stalinist party in the bloc; the
  // 1979 figures are Kádár's quieter machine after 1956 shattered the MDP.
  HU: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 900_000_000, "1979": 6_000_000_000 },
    org: {
      "1953": { HU_BUD: 64, HU_PES: 52, HU_TRW: 51, HU_TRS: 49, HU_NOR: 56, HU_ALF: 47 },
      "1979": { HU_BUD: 60, HU_PES: 50, HU_TRW: 49, HU_TRS: 47, HU_NOR: 53, HU_ALF: 45 },
    },
  },

  // Romania — PMR in 1953, PCR in 1979. Ceaușescu's PCR became the largest
  // communist party per capita in the world, so Romania is the one satellite
  // whose org RISES between the eras rather than falling.
  RO: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 400_000_000, "1979": 3_000_000_000 },
    org: {
      "1953": {
        RO_BUC: 58,
        RO_MUN: 44,
        RO_OLT: 42,
        RO_TRA: 46,
        RO_VST: 47,
        RO_MOL: 41,
        RO_DOB: 45,
      },
      "1979": {
        RO_BUC: 66,
        RO_MUN: 54,
        RO_OLT: 53,
        RO_TRA: 52,
        RO_VST: 53,
        RO_MOL: 52,
        RO_DOB: 54,
      },
    },
  },

  // Bulgaria — BKP. The most obedient satellite and the most thoroughly
  // party-saturated society outside the USSR; consistently the highest org in
  // the bloc. Weakest in the Turkish northeast and the Pomak southwest.
  BG: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 300_000_000, "1979": 2_000_000_000 },
    org: {
      "1953": { BG_SOF: 66, BG_NOR: 52, BG_COA: 55, BG_THR: 53, BG_SW: 50 },
      "1979": { BG_SOF: 68, BG_NOR: 55, BG_COA: 58, BG_THR: 55, BG_SW: 53 },
    },
  },

  // Czechoslovakia — KSČ. Uniquely, a party with a genuine pre-war mass base in
  // the Czech lands (it won 38% in the free 1946 election), so 1953 org is very
  // high. Normalisation after 1968 expelled roughly a third of the membership,
  // which is why the Czech lands fall hardest by 1979 while Slovakia — which
  // gained federal status from 1968 — does not.
  CS: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 500_000_000, "1979": 3_200_000_000 },
    org: {
      "1953": { CS_PRG: 68, CS_BOH: 64, CS_MOR: 63, CS_SVK: 52 },
      "1979": { CS_PRG: 58, CS_BOH: 55, CS_MOR: 56, CS_SVK: 51 },
    },
  },

  // Yugoslavia — SKJ. Not a pact member. Its authority rests on the Partisan war
  // record rather than Soviet arms, so org is high in the wartime heartlands
  // (Montenegro, Bosnia, Serbia proper) and weakest in Kosovo and Slovenia — the
  // former never integrated, the latter self-confident and least in need of it.
  // Falls slightly by 1979 as decentralisation devolves power to the republics.
  YU: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 200_000_000, "1979": 4_500_000_000 },
    org: {
      "1953": {
        YU_SLO: 48,
        YU_CRO: 50,
        YU_BIH: 58,
        YU_SRB: 56,
        YU_VOJ: 52,
        YU_KOS: 38,
        YU_MNE: 64,
        YU_MKD: 51,
      },
      "1979": {
        YU_SLO: 45,
        YU_CRO: 46,
        YU_BIH: 55,
        YU_SRB: 53,
        YU_VOJ: 50,
        YU_KOS: 36,
        YU_MNE: 60,
        YU_MKD: 49,
      },
    },
  },

  // Ukraine — CPU, the republican branch of the CPSU. A union republic rather
  // than a satellite, so the floor is higher than anywhere in the pact: there
  // was no rival mass institution and no private agriculture. Org tracks
  // industry and settlement history. Donbas and the Dnieper belt are the party's
  // real base (workplace cells in mines and steel plants), Kyiv is the apparat
  // itself, and the annexed west is the exception that proves the rule: in 1953
  // it had been Soviet for barely a decade, was Greek-Catholic, and was still
  // being pacified after the UPA insurgency. Unlike the satellites, org RISES
  // by 1979 almost everywhere, because Russification and the Shcherbytsky
  // machine were still expanding while the pact parties were hollowing out.
  UKR: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 800_000_000, "1979": 5_400_000_000 },
    org: {
      "1953": {
        UKR_KYI: 68,
        UKR_WES: 34, // lowest party penetration anywhere in the bloc in 1953
        UKR_POD: 52,
        UKR_DON: 72,
        UKR_DNI: 67,
        UKR_SOU: 60,
      },
      "1979": {
        UKR_KYI: 72,
        UKR_WES: 48, // a generation of Soviet schooling closes much of the gap
        UKR_POD: 58,
        UKR_DON: 75,
        UKR_DNI: 71,
        UKR_SOU: 66,
      },
    },
  },

  // Byelorussia — CPB. The republic the union treated as its model: devastated
  // by the occupation, rebuilt entirely with all-union investment, and the most
  // quiescent party organisation in the USSR. There is no regional exception of
  // the western-Ukrainian kind, because the western oblasts here were absorbed
  // into the same partisan-war narrative rather than against it. Minsk leads on
  // apparat concentration; Grodno trails slightly as the most Catholic and most
  // Polish-adjacent oblast.
  BLR: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 220_000_000, "1979": 1_500_000_000 },
    org: {
      "1953": {
        BLR_MIN: 66,
        BLR_BRE: 55,
        BLR_HOM: 60,
        BLR_GRO: 50,
        BLR_MOG: 61,
        BLR_VIT: 62,
      },
      "1979": {
        BLR_MIN: 72,
        BLR_BRE: 62,
        BLR_HOM: 66,
        BLR_GRO: 58,
        BLR_MOG: 67,
        BLR_VIT: 68,
      },
    },
  },

  // Baltic republics — the three republican parties run as one country here.
  // The lowest org of the three union republics in both eras, and for a reason
  // the model should carry: these were independent states within living memory,
  // annexed in 1940, and their 1953 parties were thin, heavily Russian-staffed
  // organisations sitting on top of an unreconciled population with an active
  // armed resistance still in the forests. Estonia and Latvia rise more by 1979
  // than Lithuania does, because Russian in-migration around Tallinn and Riga
  // physically imported party members, while Lithuania stayed Lithuanian and
  // Catholic.
  BAL: {
    seqId: "1",
    stateTaxRate: 4,
    treasury: { "1953": 90_000_000, "1979": 700_000_000 },
    org: {
      "1953": {
        BAL_EST: 42,
        BAL_LVA: 44,
        BAL_LTU: 36,
      },
      "1979": {
        BAL_EST: 56,
        BAL_LVA: 58,
        BAL_LTU: 45,
      },
    },
  },
};

/** The bloc only exists in the Cold-War eras; anything else reads as 1979. */
export function easternBlocOrgEra(preset: string): "1953" | "1979" {
  return preset === "1953-default" ? "1953" : "1979";
}
