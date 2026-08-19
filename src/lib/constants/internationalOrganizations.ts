import type { CountryId } from "./countries";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type { OrganizationCategory } from "./orgCategory";

/**
 * The built-in organizations seeded at game start. Player-created orgs use
 * arbitrary slug IDs and are typed as the broader `InternationalOrganizationId`
 * (string) — runtime validation distinguishes the two.
 */
export type BuiltInInternationalOrganizationId =
  "EU" | "NATO" | "UN" | "COMMONWEALTH" | "WARSAW_PACT" | "NON_ALIGNED" | "COMECON";

/**
 * Identifier for any international organization — either a built-in literal
 * ("EU", "NATO", "UN") or a player-created slug. Storage layer treats these
 * uniformly; resolve a `def` via `loadOrganizationDef`.
 */
export type InternationalOrganizationId = string;

export type OrganizationLeadershipTitle = string;

export interface InternationalOrganizationDef {
  id: InternationalOrganizationId;
  name: string;
  shortName: string;
  description: string;
  /** Path under /public for the org's logo SVG, or null for player-created orgs without one. */
  logoPath: string | null;
  /**
   * Founding members. For built-ins, the seed list; for custom orgs, the
   * creator's country.
   *
   * `OrgMemberId`, not `CountryId`: membership is entity-wide, so an alliance
   * can seat the countries it historically seated even where the game does not
   * simulate them as playable. NATO without Canada and the Benelux was an
   * artifact of this type, not of history.
   */
  foundingMembers: OrgMemberId[];
  /**
   * Era-specific member overrides keyed by preset string (e.g. "1953-default").
   * When set, seedInternationalOrganizations uses this list instead of
   * foundingMembers for the matching preset. Handles historical cases like
   * DE not in NATO pre-1955, EU not existing pre-1993, etc.
   */
  foundingMembersByEra?: Partial<Record<string, OrgMemberId[]>>;
  /**
   * Real-world founding year. An org whose foundedYear is after the game's
   * live year does not exist yet: not seeded at reset, hidden from the world
   * list, not joinable. It auto-founds EMPTY when the live year reaches this
   * value (foundDueOrganizations) — membership is never automatic. Custom
   * player orgs never set this; they are founded live at creation.
   */
  foundedYear?: number;
  /**
   * Real-world dissolution year (e.g. Warsaw Pact 1991). Combined with
   * foundedYear it bounds the org's existence window for seeding/founding:
   * not seeded at presets starting at/after this year, never auto-founded
   * past it. It does NOT force-dissolve a running game's org — an org with
   * members persists as alternate history (member presence overrides all
   * year math); an org emptied by withdrawals past this year vanishes for
   * good.
   */
  dissolvedYear?: number;
  /**
   * Permanent leadership: the office is automatically held by this country's
   * sitting head of government — derived at read time, never elected. The
   * nominate route rejects these orgs, so leadership elections cannot exist
   * for them. The stored leadership row stays a vacant placeholder.
   */
  permanentLeadership?: { countryId: CountryId };
  /** Leadership office offered by this organization. */
  leadership: {
    title: OrganizationLeadershipTitle;
    /** Term length in turns (48 turns = 1 year). */
    termTurns: number;
  };
  /** Optional human-readable charter blurb shown on the org page. */
  charter: string;
  /** Shared classification driving powers, flagship, and group label. */
  category: OrganizationCategory;
  /** True for player-created orgs so the UI can badge / filter them. */
  isCustom?: boolean;
}

/**
 * Voting window length for any org-level proposal (membership, FTA legislation,
 * leadership election). 24 turns = 24 real hours.
 */
export const ORG_PROPOSAL_VOTING_TURNS = 24;

/**
 * Per-country diplomatic-action budget for the International Organizations page.
 * Proposing/initiating an action costs 1; voting is free. Resets each turn.
 */
export const DIPLOMATIC_ACTIONS_PER_TURN = 4;

/**
 * How long a passed sanctions resolution stays in force (turns) before the turn
 * phase auto-lifts its embargoes and marks the resolution terminated.
 * 48 turns ≈ one game year.
 */
export const SANCTIONS_DURATION_TURNS = 48;

/** Turns per game year (48 turns ≈ 1 year), for prorating annual org dues. */
export const ORG_DUES_TURNS_PER_YEAR = 48;

/**
 * `states.gdp` is stored in local-currency *millions*, but treasuries and the
 * org fund hold *absolute* currency units. Multiply GDP by this when assessing
 * money (dues) against those balances so the scales line up.
 */
export const GDP_MILLIONS_TO_USD = 1_000_000;

/**
 * Default annual org-fund dues rate: a member is assessed this fraction of its
 * (USD-normalized) GDP per game year, prorated per turn into the org fund.
 * Conservative (~0.006%/yr ≈ a realistic UN-scale budget); each org's rate is
 * member-voted via a `set_dues` resolution and stored on its fund.
 */
export const DEFAULT_ORG_DUES_RATE_ANNUAL = 0.00006;

/**
 * Annual tribute, as a share of GDP, owed by members who cannot vote — per
 * organisation, because the two blocs do not levy the same rate.
 *
 * Fixed rather than member-voted on purpose: tribute payers have no say, so
 * letting the voting members set it would be taxation without representation
 * dressed up as a mechanic.
 *
 * Scope and rate live in ONE table so an organisation cannot be added to the
 * system without being given a price. Membership of anything not listed here
 * costs nothing.
 *
 * WHY THE PACT PAYS MORE. The playable countries are US, UK, DD and RU, so
 * every other member of either bloc is a tribute payer. Measured against the
 * 1953 seed that leaves NATO collecting from France, Italy, Turkey and Greece
 * ($74.2B combined) and the Pact from Poland, Hungary, Romania, Bulgaria and
 * Czechoslovakia ($33.5B) — a 2.2x client-wealth gap from a comparable number
 * of clients. A flat rate would hand the West a structurally deeper pool for
 * nothing it did; half again as much narrows NATO's lead to about 1.5x.
 *
 * It deliberately does NOT equalise. Parity needs roughly 1.1% a year, and
 * taking that much from economies already the poorer of the two buys balance
 * with a fiction. A bloc extracting harder from a weaker periphery, and still
 * ending up with less, is the truer shape.
 */
export const ORG_TRIBUTE_RATES_ANNUAL: Readonly<
  Partial<Record<BuiltInInternationalOrganizationId, number>>
> = {
  NATO: 0.005,
  WARSAW_PACT: 0.0075,
};

/**
 * The only world tribute exists in. Scoped by PRESET rather than by live year: a
 * world that begins in 1953 keeps this arrangement as it runs forward, which is
 * the point. Gating on the live year would switch tribute off after one game
 * year.
 */
export const ORG_TRIBUTE_PRESET = "1953-default";

/**
 * The single authority on whether an organisation levies tribute in this world,
 * and at what rate. Returns 0 when it does not — callers gate on that rather
 * than repeating the scope rule.
 */
export function orgTributeRateAnnual(organizationId: string, preset: string): number {
  if (preset !== ORG_TRIBUTE_PRESET) return 0;
  return ORG_TRIBUTE_RATES_ANNUAL[organizationId as BuiltInInternationalOrganizationId] ?? 0;
}
export const MIN_ORG_DUES_RATE_ANNUAL = 0;
/** Ceiling so a runaway vote can't assess more than 1%/yr of GDP. */
export const MAX_ORG_DUES_RATE_ANNUAL = 0.01;

/**
 * Term length for elected org leadership; same for all current orgs (~2 game years).
 */
const DEFAULT_LEADERSHIP_TERM_TURNS = 96;

/**
 * The Non-Aligned Movement's chair passes to the host of each summit, which
 * convened roughly every three years. 144 turns = 3 game years.
 */
const NAM_CHAIR_TERM_TURNS = 144;

export const INTERNATIONAL_ORGANIZATIONS: Record<
  BuiltInInternationalOrganizationId,
  InternationalOrganizationDef
> = {
  EU: {
    id: "EU",
    name: "European Union",
    shortName: "EU",
    description:
      "A political and economic union of European member states pursuing deep integration, a common market, and coordinated foreign policy.",
    logoPath: "/orgs/eu.svg",
    foundingMembers: ["DE", "IE"],
    // Maastricht Treaty. Pre-1993 presets (1953/1979/1991) do not seed the EU
    // at all — it auto-founds (empty) when the live game year reaches
    // foundedYear, and countries accede by choice (no era rosters: an org
    // founding mid-game never gains members automatically).
    foundedYear: 1993,
    leadership: {
      title: "President of the European Council",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "Member states commit to the four freedoms — free movement of goods, services, capital, and people — and to common institutions including the Commission, Parliament, and Council.",
    category: "economic",
  },
  NATO: {
    id: "NATO",
    name: "North Atlantic Treaty Organization",
    shortName: "NATO",
    description:
      "A transatlantic military alliance founded on the principle of collective defense: an attack on one is an attack on all.",
    logoPath: "/orgs/nato.svg",
    foundingMembers: ["US", "UK", "DE"],
    foundedYear: 1949,
    // The full historical alliance, not just the countries the game simulates.
    // Membership is entity-wide, so the eight founders that exist only as
    // background entities (CA/NL/BE/LU/NO/DK/PT/IS) are seated too — NATO
    // without Canada and the Benelux was an artifact of the old CountryId-only
    // roster, not of history. They carry no economy, so they pay no tribute and
    // hold no vote; they are the alliance's real shape.
    //
    // 1953 — 14 members. Twelve founders (Washington Treaty, 4 April 1949) plus
    //   Greece and Turkey, who both acceded 18 February 1952. West Germany
    //   joined 9 May 1955, so it is absent here. AT and FI were neutral
    //   throughout and never joined; ES joined only in 1982.
    // 1979 — 15 members: the 1953 fourteen plus West Germany (1955). Spain is
    //   still three years away. Greece had withdrawn from the integrated
    //   military command (1974-1980) but remained a member throughout.
    //   Without this entry a 1979 world fell through to the 3-country founding
    //   list and seated only US/UK/DE — the same bug the 1991 entry fixed.
    // 1991 — 16 members: the 1979 fifteen plus Spain (30 May 1982). SE excluded
    //   (Sweden joined 2024); IE neutral; JP/CN/BR/NG never members.
    foundingMembersByEra: {
      "1953-default": [
        "US",
        "UK",
        "FR",
        "IT",
        "TR",
        "GR",
        "CA",
        "NL",
        "BE",
        "LU",
        "NO",
        "DK",
        "PT",
        "IS",
      ],
      "1979-default": [
        "US",
        "UK",
        "DE",
        "FR",
        "IT",
        "TR",
        "GR",
        "CA",
        "NL",
        "BE",
        "LU",
        "NO",
        "DK",
        "PT",
        "IS",
      ],
      "1991-default": [
        "US",
        "UK",
        "DE",
        "FR",
        "IT",
        "ES",
        "TR",
        "GR",
        "CA",
        "NL",
        "BE",
        "LU",
        "NO",
        "DK",
        "PT",
        "IS",
      ],
    },
    leadership: {
      title: "Secretary-General",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "Article 5 commits each member to treat an armed attack against any one ally as an attack against all. Members coordinate defense planning, joint exercises, and integrated command structures.",
    category: "security",
  },
  UN: {
    id: "UN",
    name: "United Nations",
    shortName: "UN",
    description:
      "The premier global forum for diplomacy, peacekeeping, humanitarian coordination, and international law.",
    logoPath: "/orgs/un.svg",
    foundingMembers: ["US", "UK", "DE", "JP"],
    foundedYear: 1945,
    // 1991: the full seeded roster — every 1991-world country was a UN member
    // (DE 1973, JP 1956, IE/IT/ES 1955, NG 1960; the rest founding-era). RU is
    // deliberately absent: the USSR held the seat until Dec 1991 but RU is not
    // a seedable 1991 country (bootstrap gates the bloc to 1953/1979).
    foundingMembersByEra: {
      /**
       * The real UN of 1953: 60 states, of which 58 exist as entities here —
       * plus Italy and Ireland, seated by design decision (see below).
       *
       * The 51 founders of 1945 plus the nine admitted before the Cold War
       * froze admissions — Afghanistan, Iceland, Sweden and Thailand in 1946,
       * Pakistan and Yemen in 1947, Burma in 1948, Israel in 1949, Indonesia in
       * 1950. Nothing then joined until December 1955, which is why so many
       * obvious names are missing below.
       *
       * TWO FOUNDERS HAVE NO SEAT HERE. The Byelorussian and Ukrainian SSRs
       * each held their own General Assembly seat, a Soviet negotiating win at
       * Yalta. Ukraine has no entity at all (it is drawn inside the
       * soviet-union shard), and Byelorussia is modelled as a dependency of RU
       * rather than a sovereign — seating a dependency would give the USSR two
       * votes through the back door, which is exactly what the real arrangement
       * was, but not something the membership model expresses.
       *
       * THE CHINA SEAT is CN here, though in 1953 it was held by the Republic
       * of China on Taiwan — the PRC did not take it until 1971. Left as CN
       * because that is the existing seating and changing it is a separate
       * decision about what TW is for.
       *
       * ABSENT ON PURPOSE, all admitted December 1955 or later: Spain, Austria,
       * Finland, Portugal, Hungary, Romania, Bulgaria, Albania, Jordan, Laos,
       * Cambodia, Nepal, Ceylon and Libya (1955); Japan (1956); Nigeria (1960);
       * Mongolia (1961); Bhutan and Oman (1971); both Germanies (1973); both
       * Vietnams (1977); Liechtenstein (1990); Korea, North and South (1991);
       * San Marino (1992); Monaco and Andorra (1993); Switzerland (2002). The
       * Vatican has never joined.
       *
       * Italy and Ireland belong to that 1955 cohort too and ARE seated anyway,
       * by decision. If a further divergence is ever wanted, add it here with
       * the same note — the rule is that a departure from history is written
       * down as one, never left looking like an oversight.
       */
      "1953-default": [
        // Permanent members and Europe
        "US",
        "UK",
        "FR",
        "RU",
        "CN",
        "GR",
        "TR",
        "YU",
        "CS",
        "PL",
        "BE",
        "NL",
        "LU",
        "DK",
        "NO",
        "SE",
        "IS",
        // Seated by DESIGN DECISION, not by history: both were admitted on 14
        // December 1955 in the package deal that broke the admissions deadlock.
        // They are playable-adjacent economies the 1953 board wants in the room,
        // so the divergence is deliberate and kept here rather than silently
        // corrected.
        "IT",
        "IE",
        // The Commonwealth and the Dominions
        "CA",
        "AU",
        "NZ",
        "ZA",
        "IN",
        "PK",
        // Latin America — the largest single bloc in the 1953 Assembly
        "AR",
        "BO",
        "BR",
        "CL",
        "CO",
        "CR",
        "CU",
        "DO",
        "EC",
        "SV",
        "GT",
        "HT",
        "HN",
        "MX",
        "NI",
        "PA",
        "PY",
        "PE",
        "UY",
        "VE",
        // Middle East and Africa
        "EG",
        "ET",
        "IR",
        "IQ",
        "IL",
        "LB",
        "LR",
        "SA",
        "SY",
        "YE",
        "AF",
        // Asia
        "ID",
        "MM",
        "PH",
        "TH",
      ],
      // AT and FI both joined the UN in December 1955 — absent from the 1953
      // roster, present from 1991 (both neutral: never NATO; EU only in 1995).
      "1991-default": [
        "US",
        "UK",
        "FR",
        "IT",
        "ES",
        "SE",
        "TR",
        "AT",
        "FI",
        "DE",
        "JP",
        "CN",
        "BR",
        "IE",
        "NG",
      ],
    },
    leadership: {
      title: "Secretary-General",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "Members pledge to maintain international peace and security, develop friendly relations among nations, and cooperate in solving international problems.",
    category: "political",
  },
  COMMONWEALTH: {
    id: "COMMONWEALTH",
    name: "Commonwealth of Nations",
    shortName: "Commonwealth",
    description:
      "A voluntary association of sovereign states bound by shared history, language, and institutions, coordinating on development, trade, and diplomacy.",
    logoPath: "/orgs/commonwealth.svg",
    foundingMembers: ["UK", "NG"],
    foundedYear: 1949,
    permanentLeadership: { countryId: "UK" },
    leadership: {
      title: "Head of the Commonwealth",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "Members are free and equal partners who consult and cooperate in the common interests of their peoples, promoting development, mutual assistance, and consensus diplomacy under the Head of the Commonwealth.",
    category: "political",
  },
  WARSAW_PACT: {
    id: "WARSAW_PACT",
    name: "Warsaw Pact",
    shortName: "Warsaw Pact",
    description:
      "The collective-defense alliance of the socialist states, binding its members under a unified military command.",
    logoPath: "/orgs/warsaw-pact.svg",
    foundingMembers: ["RU", "DD", "PL", "HU", "RO", "BG", "CS"],
    // Albania signed the Warsaw Treaty as one of its eight founders (14 May
    // 1955) but stopped participating after the 1961 Soviet-Albanian split and
    // formally withdrew in September 1968 — so it belongs to a 1953 world and
    // not to a 1979 one. It exists only as a background entity, which
    // entity-wide membership now permits.
    foundingMembersByEra: {
      "1953-default": ["RU", "DD", "PL", "HU", "RO", "BG", "CS", "AL"],
      "1979-default": ["RU", "DD", "PL", "HU", "RO", "BG", "CS"],
    },
    // User decision: pulled earlier than history so the first cold-war preset
    // includes it; dissolved on schedule. A running game's pact is never
    // force-dissolved (member presence overrides the window).
    foundedYear: 1952,
    dissolvedYear: 1991,
    permanentLeadership: { countryId: "RU" },
    leadership: {
      title: "Supreme Commander of the Unified Command",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "An armed attack against any member shall be considered an attack against them all. Members place their forces under a unified command and render immediate assistance by all means deemed necessary.",
    category: "security",
  },
  NON_ALIGNED: {
    id: "NON_ALIGNED",
    name: "Non-Aligned Movement",
    shortName: "Non-Aligned",
    description:
      "A movement of states that decline alliance with either bloc, coordinating through periodic summits under a rotating chair rather than a permanent secretariat.",
    logoPath: "/orgs/non-aligned-movement.svg",
    // Yugoslavia founded the movement at Belgrade; Nigeria joined after
    // independence. Of every country the game models, those two are the only
    // members it ever had — Brazil and China were observers, never members.
    //
    // NOTE: resolveOrgFundCurrencyCountry denominates an org's fund in
    // foundingMembers[0] — here YU — and reads this list, not the era override
    // below. YU is absent from the 1991/2019/2023 preset rosters, so should a
    // country join the movement in one of those worlds its fund reads in
    // Yugoslav dinar. Harmless today (convertLocal resolves rates from the
    // static COUNTRY_CONFIGS, so no NaN) and unreachable while the roster is
    // empty, but making that resolver era-aware would fix it for every org.
    foundingMembers: ["YU", "NG"],
    // The 1991/2019/2023 presets contain neither YU nor NG (nor any other
    // member), so the movement exists there but seats nobody. Countries may
    // still apply — an empty org waives the member vote at application time.
    foundingMembersByEra: {
      "1991-default": [],
      "2019-default": [],
      "2023-default": [],
    },
    // After the 1953 preset's start, so a 1953 game auto-founds it EMPTY on
    // reaching 1961 via foundDueOrganizations. Never dissolved.
    foundedYear: 1961,
    leadership: {
      title: "Chair of the Non-Aligned Movement",
      termTurns: NAM_CHAIR_TERM_TURNS,
    },
    charter:
      "Members pursue independence from great-power blocs, refusing military alliance with either, and hold to sovereign equality, non-aggression, non-interference, and peaceful coexistence.",
    category: "political",
  },
  COMECON: {
    id: "COMECON",
    name: "Council for Mutual Economic Assistance",
    shortName: "COMECON",
    description:
      "The economic coordination body of the socialist states, organising planned trade, specialisation, and technical cooperation among members.",
    logoPath: "/orgs/comecon.svg",
    // Jan 1949 Moscow founders were USSR, Bulgaria, Czechoslovakia, Hungary,
    // Poland, Romania. East Germany (DD) joined Sept 1950 — included in the
    // default post-1950 roster below. Albania joined Feb 1949 but has no
    // CountryId in this game (never seeded). Yugoslavia was expelled from
    // Cominform in 1948 and only took limited associate status in 1964 —
    // never a full member; omitted from every roster.
    foundingMembers: ["RU", "BG", "CS", "HU", "PL", "RO", "DD"],
    // Real founding (CMEA / Comecon, Moscow, January 1949) — no early pull
    // needed, unlike Warsaw Pact. Dissolved 28 June 1991; same window gate
    // as the pact (not seeded at presets whose starting year ≥ 1991).
    foundedYear: 1949,
    dissolvedYear: 1991,
    // Mongolia 1962, Cuba 1972, Vietnam 1978 joined historically but none
    // are CountryIds here, so the 1953 and 1979 game rosters stay identical.
    // 1991+/2019 presets never reach this list — dissolvedYear blocks seed.
    foundingMembersByEra: {
      "1953-default": ["RU", "BG", "CS", "HU", "PL", "RO", "DD"],
      "1979-default": ["RU", "BG", "CS", "HU", "PL", "RO", "DD"],
    },
    permanentLeadership: { countryId: "RU" },
    leadership: {
      title: "Secretary of the Council",
      termTurns: DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    charter:
      "Members coordinate national economic plans, specialise production across the community, and settle mutual trade through clearing arrangements under a common secretariat.",
    category: "economic",
  },
};

export const INTERNATIONAL_ORGANIZATION_ORDER: BuiltInInternationalOrganizationId[] = [
  "EU",
  "NATO",
  "UN",
  "COMMONWEALTH",
  "WARSAW_PACT",
  "NON_ALIGNED",
  "COMECON",
];

export function getOrganizationDef(
  id: BuiltInInternationalOrganizationId
): InternationalOrganizationDef {
  return INTERNATIONAL_ORGANIZATIONS[id];
}

export function isBuiltInInternationalOrganizationId(
  id: string
): id is BuiltInInternationalOrganizationId {
  return id in INTERNATIONAL_ORGANIZATIONS;
}

/**
 * Validates the slug format used for player-created orgs. We restrict to
 * lowercase letters, digits, and hyphens (2-32 chars), require start/end to
 * be alphanumeric so URLs are clean, and reject built-in IDs to avoid
 * collisions.
 */
export function isValidCustomOrganizationSlug(id: string): boolean {
  // Reject built-in ids case-insensitively — org page URLs resolve case-insensitively,
  // so a custom slug "eu" would collide with the built-in "EU".
  const builtinIds = Object.keys(INTERNATIONAL_ORGANIZATIONS).map((k) => k.toLowerCase());
  if (builtinIds.includes(id.toLowerCase())) return false;
  return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(id);
}

/**
 * Default leadership term length (in turns) for player-created orgs. Matches
 * the built-in default (~2 game years).
 */
export const CUSTOM_ORG_DEFAULT_LEADERSHIP_TERM_TURNS = DEFAULT_LEADERSHIP_TERM_TURNS;

/**
 * Country-by-country mapping from foreign-affairs cabinet seat ID to country.
 * Used by `requireForeignMinister` to authorize diplomatic actions. Countries
 * without a configured seat fall back to the head of government.
 */
export const FOREIGN_AFFAIRS_POSITION_BY_COUNTRY: Record<CountryId, string | null> = {
  US: "secretary_of_state",
  UK: "foreign_secretary",
  DE: "foreign_minister",
  JP: "foreign_affairs_minister",
  IE: "minister_for_foreign_affairs",
  BR: null,
  CN: "minister_of_foreign_affairs",
  NG: "minister_of_foreign_affairs",
  // The eastern bloc and RU reuse DD_CABINET_POSITIONS, which defines a real
  // `minister_of_foreign_affairs`. These were null — the same defect #980 fixed for
  // CN/IE/NG, left standing for eight more countries: a player foreign minister here
  // was never recognized, and only the head-of-government fallback could act. Note
  // the same cabinets also hold `minister_of_foreign_trade`, which is NOT this seat.
  HU: "minister_of_foreign_affairs",
  PL: "minister_of_foreign_affairs",
  RO: "minister_of_foreign_affairs",
  YU: "minister_of_foreign_affairs",
  BG: "minister_of_foreign_affairs",
  // The Ukrainian and Byelorussian SSRs ran their own foreign ministries and
  // held UN seats in their own right from 1945, which is exactly why they are
  // the two union republics with a real seat here rather than a null.
  BLR: "minister_of_foreign_affairs",
  UKR: "minister_of_foreign_affairs",
  CS: "minister_of_foreign_affairs",
  BAL: "minister_of_foreign_affairs",
  RU: "minister_of_foreign_affairs",
  FR: null,
  IT: null,
  ES: null,
  SE: null,
  TR: null,
  GR: null,
  AT: null,
  FI: null,
  DD: "minister_of_foreign_affairs",
  // Sub-national entities. Both define `externalAffairsSecretary`, but they are left
  // on the head-of-government fallback deliberately: neither can be a belligerent
  // (validateDeclareWar refuses any target not enabled for players), and the
  // diplomatic surfaces for a devolved administration are unverified. The
  // completeness test below carries them as named exceptions so this stays visible.
  SCO: null,
  WAL: null,
};

/**
 * Cabinet seat that owns trade policy per country (the existing trade-stance
 * holder). Used by `requireTradeMinister` to authorize trade actions such as
 * temporary embargoes. Countries without a configured seat fall back to the
 * head of government.
 */
export const TRADE_MINISTER_POSITION_BY_COUNTRY: Record<CountryId, string | null> = {
  US: "secretary_of_commerce",
  UK: "business_secretary",
  DE: "economy_minister",
  JP: "economy_minister",
  CN: "minister_of_commerce",
  IE: "minister_for_enterprise", // Minister for Enterprise, Trade and Employment
  BR: null,
  NG: null,
  HU: null,
  PL: null,
  RO: null,
  YU: null,
  BG: null,
  BLR: null,
  UKR: null,
  CS: null,
  BAL: null,
  RU: "minister_of_foreign_affairs",
  FR: null,
  IT: null,
  ES: null,
  SE: null,
  TR: null,
  GR: null,
  AT: null,
  FI: null,
  DD: "minister_of_foreign_affairs",
  // Sub-national entities. Both define `externalAffairsSecretary`, but they are left
  // on the head-of-government fallback deliberately: neither can be a belligerent
  // (validateDeclareWar refuses any target not enabled for players), and the
  // diplomatic surfaces for a devolved administration are unverified. The
  // completeness test below carries them as named exceptions so this stays visible.
  SCO: null,
  WAL: null,
};
