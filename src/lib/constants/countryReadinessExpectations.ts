/**
 * Per-country expectations for the admin readiness diagnostic. Drives
 * /api/admin/country/[code]/readiness and the CountryReadinessPanel UI.
 *
 * To add a country: add an entry below. To tighten a check: edit the
 * expected count in place.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export interface ReadinessCheck {
  name: string;
  status: "ok" | "missing" | "warning";
  count?: number;
  detail?: string;
}

export interface CountryReadinessExpectations {
  /** Expected count of states/regions for this country. */
  regionCount: number;
  /** Expected minimum count of seeded parties. */
  partyMin: number;
  /** Human-readable roster shown in the detail string. */
  partyRoster: string;
  /** Expected minimum statePartyOrg rows. */
  statePartyOrgMin: number;
  /** Expected minimum seats. */
  seatMin: number;
  /** Seat composition note for the detail string. */
  seatNote: string;
  /** Expected minimum NPP roster size. */
  nppMin: number;
  nppNote: string;
  /** Expected minimum electedOfficials. */
  officialMin: number;
  /** Expected demographic rows (typically = regionCount). */
  demographicsCount: number;
  /** Filter for the stateMetrics readiness check (applied via countDocuments). */
  stateMetricsFilter: Record<string, unknown>;
  /** Expected stateMetrics count. */
  stateMetricsCount: number;
  /** Expected minimum legislation types (countDocuments({ countryId })). */
  legislationTypesMin: number;
  /** Country-specific extra checks colocated with the country. */
  extras?: Array<(db: Db) => Promise<ReadinessCheck>>;
}

/** RU: leader-confidence state (post-Premier-install). */
async function checkRUCountryLeaderStates(db: Db): Promise<ReadinessCheck> {
  const count = await db
    .collection<{ _id: string }>("countryLeaderStates")
    .countDocuments({ _id: { $regex: "^RU_" } });
  return {
    name: "CountryLeaderStates",
    status: count > 0 ? "ok" : "warning",
    count,
    detail: count > 0 ? `${count} leader confidence state(s)` : "No leader installed yet",
  };
}

/** CN: leader-confidence state (post-PM-install). */
async function checkCNCountryLeaderStates(db: Db): Promise<ReadinessCheck> {
  const count = await db
    .collection<{ _id: string }>("countryLeaderStates")
    .countDocuments({ _id: { $regex: "^CN_" } });
  return {
    name: "CountryLeaderStates",
    status: count > 0 ? "ok" : "warning",
    count,
    detail: count > 0 ? `${count} leader confidence state(s)` : "No leader installed yet",
  };
}

/** CN: government formation doc */
async function checkGovernmentFormation(countryId: CountryId, db: Db): Promise<ReadinessCheck> {
  const gov = await db
    .collection<{ _id: string; status?: string; cycle?: number }>("governmentFormations")
    .findOne({ _id: countryId });
  return {
    name: "GovernmentFormation",
    status: gov ? "ok" : "missing",
    detail: gov
      ? `Status: ${gov.status}, cycle: ${gov.cycle}`
      : `No ${countryId} governmentFormations doc`,
  };
}

/** DE: Landeslisten populated. */
async function checkDELandeslisten(db: Db): Promise<ReadinessCheck> {
  const count = await db.collection("landeslisten").countDocuments({ countryId: "DE" });
  return {
    name: "Landeslisten",
    status: count > 0 ? "ok" : "warning",
    count,
    detail:
      count > 0
        ? `${count} Landeslisten entries`
        : "No Landeslisten yet (chairs not yet published)",
  };
}

export const COUNTRY_READINESS_EXPECTATIONS: Partial<
  Record<CountryId, CountryReadinessExpectations>
> = {
  US: {
    regionCount: 51,
    partyMin: 2,
    partyRoster: "Democratic, Republican",
    statePartyOrgMin: 96, // 48 contiguous × 2 under 1953; 50 × 2 under later presets

    seatMin: 535,
    seatNote: "Expected ≥535 (435 House + 100 Senate)",
    nppMin: 0,
    nppNote: "NPPs are optional for US",
    officialMin: 535,
    demographicsCount: 51,
    stateMetricsFilter: { countryId: "US" },
    stateMetricsCount: 51,
    legislationTypesMin: 0,
    extras: [(db) => checkGovernmentFormation("US", db)],
  },
  UK: {
    regionCount: 12,
    partyMin: 5,
    partyRoster: "Conservative, Labour, Lib Dem, SNP, Green",
    statePartyOrgMin: 60,
    seatMin: 650,
    seatNote: "Expected ≥650 (Commons)",
    nppMin: 600,
    nppNote: "Expected ≥600 Commons NPPs",
    officialMin: 600,
    demographicsCount: 12,
    stateMetricsFilter: { countryId: "UK" },
    stateMetricsCount: 12,
    legislationTypesMin: 0,
    extras: [(db) => checkGovernmentFormation("UK", db)],
  },
  DE: {
    regionCount: 16,
    partyMin: 7,
    partyRoster: "SPD, CDU, CSU, GRN, FDP, LNK, AfD",
    statePartyOrgMin: 112,
    seatMin: 16,
    seatNote: "Expected ≥16 (Bundestag + ministerPresident)",
    nppMin: 200,
    nppNote: "Expected ≥217 (201 Bundestag + 16 Minister-Presidents)",
    officialMin: 200,
    demographicsCount: 16,
    // Bare Land codes (BW, BY, NW…), like every other country's region docs.
    // The `de_` prefix is the national-scope convention (`de_national`), so an
    // `^de_` regex matched none of the seeded Länder and read as "0 found".
    stateMetricsFilter: { countryId: "DE" },
    stateMetricsCount: 16,
    legislationTypesMin: 1,
    extras: [(db) => checkGovernmentFormation("DE", db), checkDELandeslisten],
  },
  JP: {
    regionCount: 47,
    partyMin: 5,
    partyRoster: "LDP, CDP, Komeito, JIP, JCP",
    statePartyOrgMin: 235,
    seatMin: 713,
    seatNote: "Expected ≥713 (465 Shugiin + 248 Sangiin)",
    nppMin: 700,
    nppNote: "Expected ≥700 Diet NPPs",
    officialMin: 700,
    demographicsCount: 47,
    stateMetricsFilter: { countryId: "JP" },
    stateMetricsCount: 47,
    legislationTypesMin: 0,
    extras: [(db) => checkGovernmentFormation("JP", db)],
  },
  CN: {
    regionCount: 7,
    partyMin: 3,
    partyRoster: "CCP, CDL, CNDCA",
    statePartyOrgMin: 21,
    seatMin: 14,
    seatNote: "Expected ≥14 (7 npcDelegate + 7 governor)",
    nppMin: 21,
    nppNote: "Expected ≥21 (3 per region)",
    officialMin: 21,
    demographicsCount: 7,
    stateMetricsFilter: {
      _id: { $in: ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] },
    },
    stateMetricsCount: 7,
    legislationTypesMin: 1,
    extras: [(db) => checkGovernmentFormation("CN", db), checkCNCountryLeaderStates],
  },
  // Soviet Union (Cold-War presets only — RU seeds no regions under 2019/1991,
  // so run this report against a 1953/1979 world).
  RU: {
    regionCount: 17,
    partyMin: 1,
    partyRoster: "CPSU",
    statePartyOrgMin: 17,
    // The seats registry backfills from resolved elections
    // (backfillMissingSeats) — RU has no static seedSeats section, so a fresh
    // world legitimately starts at 0.
    seatMin: 0,
    seatNote: "Seat registry backfills from resolved elections (0 at fresh seed)",
    nppMin: 70,
    nppNote: "Expected ≥70 (34 Union + 34 Nationalities delegation rows + Premier + Chairman)",
    officialMin: 70,
    // 14 regions: Ukraine, Byelorussia and the Baltics left RU to become their
    // own countries and are checked under their own entries.
    demographicsCount: 14,
    stateMetricsFilter: {
      _id: {
        $in: [
          "CEN",
          "NWR",
          "NOR",
          "CBE",
          "VOL",
          "NCA",
          "URA",
          "WSB",
          "ESB",
          "FEA",
          "KAZ",
          "TRA",
          "CAS",
          "MOL",
        ],
      },
    },
    stateMetricsCount: 14,
    legislationTypesMin: 1,
    extras: [(db) => checkGovernmentFormation("RU", db), checkRUCountryLeaderStates],
  },
  // East Germany (Cold-War presets only — DD seeds no regions under 2019/1991).
  // Both Cold-War eras seed the same 6 eastern Länder (BEO/MV/BB/ST/SN/TH), so
  // the exact-match region/metric checks below hold in 1953 and 1979 alike.
  DD: {
    regionCount: 6,
    partyMin: 5,
    partyRoster: "SED, CDU, LDPD, NDPD, DBD (National Front)",
    statePartyOrgMin: 30, // 6 Länder × 5 National Front parties (SED + 4 bloc)
    seatMin: 0, // Volkskammer roster seeds from historicalSeats + backfills
    seatNote: "Volkskammer (500) seeds from historicalSeats + backfills from resolved elections",
    nppMin: 0,
    nppNote: "One-party National Front — no separate NPP roster requirement",
    officialMin: 15, // ≥15 Volkskammer seat rows (1953 floor; 1979 seeds 30)
    demographicsCount: 6,
    stateMetricsFilter: {
      _id: { $in: ["BEO", "MV", "BB", "ST", "SN", "TH"] },
    },
    stateMetricsCount: 6,
    legislationTypesMin: 1,
    extras: [(db) => checkGovernmentFormation("DD", db)],
  },
  IE: {
    regionCount: 8,
    partyMin: 5,
    partyRoster: "Fine Gael, Fianna Fáil, Sinn Féin, Labour, Green",
    statePartyOrgMin: 40, // 8 regions × 5 default parties (see ieRegionVoteShares.ts)
    seatMin: 160,
    seatNote: "Expected ≥160 (Dáil Éireann). Seanad excluded from player loop.",
    nppMin: 0,
    nppNote: "NPPs spawned by elections post-bootstrap; no IE historical seed yet",
    officialMin: 0,
    demographicsCount: 8,
    stateMetricsFilter: { countryId: "IE" },
    stateMetricsCount: 8,
    legislationTypesMin: 50,
    extras: [(db) => checkGovernmentFormation("IE", db)],
  },
  BR: {
    regionCount: 27,
    partyMin: 0,
    partyRoster: "TBD — coming soon",
    statePartyOrgMin: 0,
    seatMin: 0,
    seatNote: "Coming soon — no seats expected yet",
    nppMin: 0,
    nppNote: "Coming soon",
    officialMin: 0,
    demographicsCount: 27,
    stateMetricsFilter: { countryId: "BR" },
    stateMetricsCount: 27,
    legislationTypesMin: 0,
  },
  NG: {
    regionCount: 6,
    // Parties are preset-gated (validForPresets):
    //   1953 → NCNC / AG / NPC (late-colonial regional triad = 3)
    //   1991 → SDP / NRC (Third Republic = 2)
    //   2019 → APC / PDP / LP / NNPP / APGA (5)
    // Floor at 2 so the diagnostic passes on every live preset.
    partyMin: 2,
    partyRoster: "1953: NCNC, AG, NPC · 1991: SDP, NRC · 2019: APC, PDP, LP, NNPP, APGA",
    // statePartyOrg is preset-scoped: 1953 = 3×6 = 18; 1991 = 2×6 = 12; 2019 = 5×6 = 30.
    // Use the 1991 floor so the diagnostic passes on the live preset.
    statePartyOrgMin: 12,
    seatMin: 18,
    seatNote: "Expected ≥18 (6 geopolitical zones × House + Senate + Governor)",
    nppMin: 0,
    nppNote: "NPPs spawned by elections / governor historical seeds; floor stays permissive",
    officialMin: 0,
    demographicsCount: 6,
    stateMetricsFilter: { countryId: "NG" },
    stateMetricsCount: 6,
    legislationTypesMin: 50, // 54 ng-scoped types authored (ngLegislationTypes.ts)
    extras: [(db) => checkGovernmentFormation("NG", db)],
  },
  // Eastern bloc Tier-1 (1953/1979 Cold-War presets) — one-party planned economies
  // promoted to full-autonomous economy-preview (product decision 2026-07-25).
  PL: {
    regionCount: 8,
    partyMin: 1,
    partyRoster: "PZPR",
    statePartyOrgMin: 8, // 8 regions × 1 ruling party
    seatMin: 0,
    seatNote: "Sejm roster seeds from historicalSeats + backfills from resolved elections",
    nppMin: 0,
    nppNote: "One-party National Unity Front — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 8,
    stateMetricsFilter: { countryId: "PL" },
    stateMetricsCount: 8,
    legislationTypesMin: 0,
  },
  CS: {
    regionCount: 4,
    partyMin: 1,
    partyRoster: "KSČ",
    statePartyOrgMin: 4,
    seatMin: 0,
    seatNote: "Chamber of the People seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party National Front — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 4,
    stateMetricsFilter: { countryId: "CS" },
    stateMetricsCount: 4,
    legislationTypesMin: 0,
  },
  HU: {
    regionCount: 6,
    partyMin: 1,
    // Parties are preset-gated: 1953 → MDP; 1979 → MSZMP.
    partyRoster: "1953: MDP · 1979: MSZMP",
    statePartyOrgMin: 6,
    seatMin: 0,
    seatNote: "National Assembly seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 6,
    stateMetricsFilter: { countryId: "HU" },
    stateMetricsCount: 6,
    legislationTypesMin: 0,
  },
  RO: {
    regionCount: 7,
    partyMin: 1,
    // Parties are preset-gated: 1953 → PMR; 1979 → PCR.
    partyRoster: "1953: PMR · 1979: PCR",
    statePartyOrgMin: 7,
    seatMin: 0,
    seatNote: "Grand National Assembly seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 7,
    stateMetricsFilter: { countryId: "RO" },
    stateMetricsCount: 7,
    legislationTypesMin: 0,
  },
  BG: {
    regionCount: 5,
    partyMin: 1,
    partyRoster: "BKP",
    statePartyOrgMin: 5,
    seatMin: 0,
    seatNote: "National Assembly seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party Fatherland Front — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 5,
    stateMetricsFilter: { countryId: "BG" },
    stateMetricsCount: 5,
    legislationTypesMin: 0,
  },
  // Soviet union republics. Same shape as the satellites: one ruling party, one
  // statePartyOrg row per region, seats from historicalSeats. The seat and NPP
  // minimums stay at 0 for the same reason they do for BG - a single-slate
  // Supreme Soviet has no opposition roster to require.
  UKR: {
    regionCount: 6,
    partyMin: 1,
    partyRoster: "KPU",
    statePartyOrgMin: 6,
    seatMin: 0,
    seatNote: "Supreme Soviet of the Ukrainian SSR (435) seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party republican branch of the CPSU — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 6,
    stateMetricsFilter: { countryId: "UKR" },
    stateMetricsCount: 6,
    legislationTypesMin: 0,
  },
  BLR: {
    regionCount: 6,
    partyMin: 1,
    partyRoster: "CPB",
    statePartyOrgMin: 6,
    seatMin: 0,
    seatNote: "Supreme Soviet of the Byelorussian SSR (360) seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party republican branch of the CPSU — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 6,
    stateMetricsFilter: { countryId: "BLR" },
    stateMetricsCount: 6,
    legislationTypesMin: 0,
  },
  // Three republics modelled as one country, so every per-region count is 3.
  BAL: {
    regionCount: 3,
    partyMin: 1,
    partyRoster: "CPSU",
    statePartyOrgMin: 3,
    seatMin: 0,
    seatNote: "Baltic republican Supreme Soviets (300 combined) seed from historicalSeats",
    nppMin: 0,
    nppNote: "One-party republican organisations of the CPSU — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 3,
    stateMetricsFilter: { countryId: "BAL" },
    stateMetricsCount: 3,
    legislationTypesMin: 0,
  },
  YU: {
    regionCount: 8,
    partyMin: 1,
    partyRoster: "SKJ",
    statePartyOrgMin: 8,
    seatMin: 0,
    seatNote: "Federal Assembly seeds from historicalSeats + backfills",
    nppMin: 0,
    nppNote: "One-party League of Communists — no separate NPP roster requirement",
    officialMin: 0,
    demographicsCount: 8,
    stateMetricsFilter: { countryId: "YU" },
    stateMetricsCount: 8,
    legislationTypesMin: 0,
  },
};
