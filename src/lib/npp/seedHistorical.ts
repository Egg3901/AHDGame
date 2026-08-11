/**
 * Seeds historical NPPs and elected officials based on February 2020 data.
 * Called during game reset to populate Congress/Parliament with accurate
 * party composition.
 */

import { ObjectId, type Db } from "mongodb";
import { generateUniqueNPPName } from "./nameGenerator";
import { selectPoliticianImage, weightedRandomEthnicity } from "./generator";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import { reserveSequentialIds } from "@/lib/db/sequentialId";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { NPP, ElectedOfficial, OfficeType, PoliticalParty, State } from "@/lib/db/types";
import { getPresetSeats, type HistoricalSeat } from "@/lib/constants/historicalSeats";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Slug → party-name lookup used at resolve time. Exported so tests can
 * statically assert that every party slug in `getPresetSeats(preset)` has
 * either a SLUG_TO_NAME entry that maps to a seeded preset-valid party
 * name, or is in {@link INDEPENDENT_SLUGS}.
 *
 * Names MUST match the names in the seed files
 * (`src/lib/seeds/reference/politicalParties.ts`, `src/lib/seeds/uk/ukParties.ts`,
 * `src/lib/seeds/jp/jpParties.ts`, `src/lib/seeds/de/deParties.ts`,
 * `src/lib/seeds/br/brParties.ts`, `src/lib/seeds/ie/ieParties.ts`,
 * `src/lib/seeds/cn/cnParties.ts`).
 */
export const SLUG_TO_NAME: Record<string, string> = {
  // US
  us_democrat: "Democratic Party",
  us_republican: "Republican Party",
  // UK
  uk_labour: "Labour Party",
  uk_conservative: "Conservative Party",
  uk_libdem: "Liberal Democrats",
  uk_snp: "Scottish National Party",
  uk_plaid: "Plaid Cymru",
  uk_green: "Green Party",
  uk_dup: "Democratic Unionist Party",
  uk_sf: "Sinn Féin",
  uk_sdlp: "Social Democratic and Labour Party",
  uk_alliance: "Alliance Party",
  uk_uup: "Ulster Unionist Party",
  uk_speaker: "Speaker",
  uk_independent: "Independent",
  // JP
  jp_ldp: "Liberal Democratic Party",
  jp_cdp: "Constitutional Democratic Party",
  jp_komeito: "Komeito",
  jp_jcp: "Japanese Communist Party",
  jp_ishin: "Nippon Ishin no Kai",
  jp_dpfp: "Democratic Party for the People",
  // JP 1991-only defaults
  jp_jsp: "Japan Socialist Party",
  jp_dsp: "Democratic Socialist Party",
  // JP minor parties — resolve to "independent" if not in DB
  jp_sdp: "Social Democratic Party",
  jp_reiwa: "Reiwa Shinsengumi",
  jp_nhk: "NHK Party",
  jp_independent: "Independent",
  // CN
  cn_ccp: "Chinese Communist Party",
  cn_cdl: "China Democratic League",
  cn_cndca: "China National Democratic Construction Association",
  cn_independent: "Independent",
  // NG
  ng_apc: "All Progressives Congress",
  ng_pdp: "Peoples Democratic Party",
  ng_lp: "Labour Party",
  ng_nnpp: "New Nigeria Peoples Party",
  ng_apga: "All Progressives Grand Alliance",
  ng_sdp: "Social Democratic Party",
  ng_nrc: "National Republican Convention",
  // NG 1953 late-colonial triad
  ng_ncnc: "National Council of Nigeria and the Cameroons",
  ng_ag: "Action Group",
  ng_npc: "Northern People's Congress",
  ng_independent: "Independent",
  // DE
  de_spd: "Sozialdemokratische Partei Deutschlands",
  de_cdu: "Christlich Demokratische Union",
  de_csu: "Christlich-Soziale Union in Bayern",
  de_greens: "Bündnis 90/Die Grünen",
  de_fdp: "Freie Demokratische Partei",
  de_linke: "Die Linke",
  de_afd: "Alternative für Deutschland",
  // DE 1991-only default
  de_pds: "Partei des Demokratischen Sozialismus",
  de_independent: "Independent",
  // BR — modern roster (2019-default)
  br_pt: "Partido dos Trabalhadores",
  br_pl: "Partido Liberal",
  br_mdb: "MDB",
  br_uniao: "União Brasil",
  br_psd: "PSD",
  br_independent: "Independent",
  // BR 1991-only defaults
  br_pmdb: "Partido do Movimento Democrático Brasileiro",
  br_pfl: "Partido da Frente Liberal",
  br_pdt: "Partido Democrático Trabalhista",
  br_pds: "Partido Democrático Social",
  br_ptb: "Partido Trabalhista Brasileiro",
  br_prn: "Partido da Reconstrução Nacional",
  br_psb: "Partido Socialista Brasileiro",
  br_pcdob: "Partido Comunista do Brasil",
  // br_other folds to independent
  br_other: "Independent",
  // IE — modern roster (2019-default)
  ie_ff: "Fianna Fáil",
  ie_fg: "Fine Gael",
  ie_sf: "Sinn Féin",
  ie_labour: "Labour",
  ie_green: "Green Party",
  ie_independent: "Independent",
  ie_ind: "Independent",
  // IE 1991-only defaults
  ie_wp: "Workers' Party",
  ie_pd: "Progressive Democrats",
  // ── 1953/1979 Cold-War one-party states (single National Front lists) ───────
  su_cpsu: "Communist Party of the Soviet Union",
  dd_sed: "Sozialistische Einheitspartei Deutschlands",
  dd_cdu: "Christlich-Demokratische Union (Ost)",
  dd_ldpd: "Liberal-Demokratische Partei Deutschlands",
  dd_ndpd: "National-Demokratische Partei Deutschlands",
  dd_dbd: "Demokratische Bauernpartei Deutschlands",
  hu_mszmp: "Magyar Szocialista Munkáspárt", // 1979 (Kádár)
  hu_mdp: "Magyar Dolgozók Pártja", // 1953 (Rákosi) — MSZMP didn't exist until 1956
  pl_pzpr: "Polska Zjednoczona Partia Robotnicza",
  ro_pcr: "Partidul Comunist Român", // 1979 (Ceaușescu)
  ro_pmr: "Partidul Muncitoresc Român", // 1953 (Gheorghiu-Dej) — renamed to PCR in 1965
  yu_skj: "Savez komunista Jugoslavije",
  bg_bkp: "Bulgarian Communist Party",
  by_cpb: "Communist Party of Byelorussia",
  cs_ksc: "Komunistická strana Československa",
  bal_cpsu: "Communist Party (Baltic Republics)",
};

/**
 * Slugs that always resolve to "independent" regardless of country roster.
 * Includes both the canonical `_independent` per country and the
 * country-specific "other/none" buckets used by historical seat arrays
 * (e.g. `br_other` for sub-3%-share parties not seeded individually,
 * `ie_ind` for the historical "Independent" Dáil bucket).
 */
export const INDEPENDENT_SLUGS = new Set<string>([
  "independent",
  "uk_independent",
  "jp_independent",
  "de_independent",
  "cn_independent",
  "br_independent",
  "br_other",
  "ie_independent",
  "ie_ind",
  // UK speaker is convention: by tradition the Speaker stands as independent.
  "uk_speaker",
  // UK SDLP and Alliance are intentional fold-to-independent (historical
  // 1991-1992 NI seat-holders that we don't seed as default parties — see
  // comment in `historicalSeats.ts` UK_COMMONS_1992 / UK_REGIONAL_COUNCIL_1992).
  "uk_sdlp",
  "uk_alliance",
  // JP minor parties that aren't seeded as defaults — they fold to
  // independent (SDP fragment, Reiwa Shinsengumi, NHK Party).
  "jp_sdp",
  "jp_reiwa",
  "jp_nhk",
  // BR 1991: br_pl in 1991 refers to the original Partido Liberal
  // (1985-2006), a small free-market party that merged into PR and only
  // became today's PL after a 2019 rebrand. The two share a name but not
  // an ideology, so 1991 PL seats fold to independent rather than
  // miscategorising as the modern PL roster (which is 2019-only).
  "br_pl",
]);

// Minimal policy positions for seeded NPPs
function generateDefaultPolicies(party: string): { economic: number; social: number } {
  // US parties
  if (party === "democrat") return { economic: -2, social: -2 };
  if (party === "republican") return { economic: 2, social: 2 };
  if (party === "independent") return { economic: 0, social: 0 };

  // UK parties
  if (party === "uk_labour") return { economic: -2, social: -2 };
  if (party === "uk_conservative") return { economic: 2, social: 1 };
  if (party === "uk_libdem") return { economic: 0, social: -1 };
  if (party === "uk_snp") return { economic: -1, social: -2 };
  if (party === "uk_plaid") return { economic: -1, social: -1 };
  if (party === "uk_green") return { economic: -2, social: -3 };
  if (party === "uk_dup") return { economic: 1, social: 3 };
  if (party === "uk_sf") return { economic: -2, social: -1 };
  if (party === "uk_sdlp") return { economic: -1, social: -1 };
  if (party === "uk_alliance") return { economic: 0, social: -1 };
  if (party === "uk_speaker") return { economic: 0, social: 0 };
  if (party === "uk_independent") return { economic: 0, social: 0 };

  // JP parties
  if (party === "jp_ldp") return { economic: 2, social: 2 };
  if (party === "jp_cdp") return { economic: -2, social: -2 };
  if (party === "jp_komeito") return { economic: 0, social: 0 };
  if (party === "jp_jcp") return { economic: -4, social: -3 };
  if (party === "jp_ishin") return { economic: 3, social: 1 };
  if (party === "jp_dpfp") return { economic: 0, social: -1 };
  if (party === "jp_sdp") return { economic: -3, social: -3 };
  if (party === "jp_reiwa") return { economic: -4, social: -2 };
  if (party === "jp_nhk") return { economic: 1, social: 0 };
  if (party === "jp_independent") return { economic: 0, social: 0 };
  // JP 1991-only defaults
  if (party === "jp_jsp") return { economic: -3, social: -2 };
  if (party === "jp_dsp") return { economic: -1, social: -1 };

  // DE parties
  if (party === "de_spd") return { economic: -2, social: -2 };
  if (party === "de_cdu") return { economic: 2, social: 1 };
  if (party === "de_csu") return { economic: 2, social: 2 };
  if (party === "de_greens") return { economic: -2, social: -3 };
  if (party === "de_fdp") return { economic: 2, social: -1 };
  if (party === "de_linke") return { economic: -4, social: -2 };
  if (party === "de_afd") return { economic: 1, social: 4 };
  if (party === "de_independent") return { economic: 0, social: 0 };
  // DE 1991-only default
  if (party === "de_pds") return { economic: -4, social: -2 };

  // CN parties
  if (party === "cn_ccp") return { economic: 0, social: 3 };
  if (party === "cn_cdl") return { economic: -1, social: 0 };
  if (party === "cn_cndca") return { economic: 1, social: 0 };
  if (party === "cn_independent") return { economic: 0, social: 0 };

  // BR parties — modern roster
  if (party === "br_pt") return { economic: -3, social: -2 };
  if (party === "br_pl") return { economic: 2, social: 3 };
  if (party === "br_mdb") return { economic: 0, social: 0 };
  if (party === "br_uniao") return { economic: 1, social: 1 };
  if (party === "br_psd") return { economic: 1, social: 0 };
  // BR 1991-only defaults — positions match 1989-91 Brazilian political map
  if (party === "br_pmdb") return { economic: 0, social: 0 }; // catch-all centrist
  if (party === "br_pfl") return { economic: 2, social: 2 }; // post-Sarney conservatives
  if (party === "br_pdt") return { economic: -2, social: -1 }; // Brizola's labourists
  if (party === "br_pds") return { economic: 2, social: 3 }; // ARENA successor, right
  if (party === "br_ptb") return { economic: 1, social: 1 }; // Vargas-tradition trabalhismo
  if (party === "br_prn") return { economic: 1, social: 1 }; // Collor's party
  if (party === "br_psb") return { economic: -2, social: -2 }; // democratic socialists
  if (party === "br_pcdob") return { economic: -4, social: -2 }; // Communist Party of Brazil
  if (party === "br_other") return { economic: 0, social: 0 };
  if (party === "br_independent") return { economic: 0, social: 0 };

  // IE parties — modern roster
  if (party === "ie_ff") return { economic: 0, social: 0 };
  if (party === "ie_fg") return { economic: 2, social: -2 };
  if (party === "ie_sf") return { economic: -3, social: -3 };
  if (party === "ie_labour") return { economic: -2, social: -2 };
  if (party === "ie_green") return { economic: -1, social: -3 };
  if (party === "ie_independent") return { economic: 0, social: 0 };
  if (party === "ie_ind") return { economic: 0, social: 0 };
  // IE 1991-only defaults
  if (party === "ie_wp") return { economic: -4, social: -2 }; // Workers' Party (post-Sinn Féin split)
  if (party === "ie_pd") return { economic: 3, social: -1 }; // Progressive Democrats — free-market liberal

  // NG parties — modern + 1991 + 1953
  if (party === "ng_apc") return { economic: 2, social: 3 };
  if (party === "ng_pdp") return { economic: 0, social: -1 };
  if (party === "ng_lp") return { economic: -3, social: -2 };
  if (party === "ng_nnpp") return { economic: -1, social: -1 };
  if (party === "ng_apga") return { economic: 1, social: 1 };
  if (party === "ng_sdp") return { economic: -1, social: -1 };
  if (party === "ng_nrc") return { economic: 2, social: 2 };
  if (party === "ng_ncnc") return { economic: -1, social: -1 };
  if (party === "ng_ag") return { economic: 1, social: 0 };
  if (party === "ng_npc") return { economic: 1, social: 3 };
  if (party === "ng_independent") return { economic: 0, social: 0 };

  return { economic: 0, social: 0 };
}

// Default personality for historical NPPs
export function generateDefaultPersonality() {
  return {
    loyalty: 50 + Math.random() * 30 - 15, // 35-65
    ambition: 50 + Math.random() * 40 - 20, // 30-70
    stubbornness: 40 + Math.random() * 30 - 15, // 25-55
  };
}

interface SeedResult {
  nppsCreated: number;
  officialsCreated: number;
  /**
   * Seats dropped because their chamber was already seated and
   * `skipAlreadySeatedChambers` was set. Zero on every append-mode call.
   */
  seatsSkipped?: number;
}

export interface SeedFromSeatsOptions {
  /**
   * Make this call IDEMPOTENT: drop any seat whose (countryId, officeType)
   * chamber already holds a seated NPP official, instead of appending a second
   * parallel roster on top of it.
   *
   * `seedFromSeats` otherwise has NO existing-seat dedup — it dedups only on
   * generated NPP *name*, which merely avoids name collisions and never skips a
   * seat. So a second pass over the same authored roster creates a full extra
   * chamber. Reproduced live: a reset that died partway (missing env vars, after
   * rosters had already seeded) was re-run by the operator, and every
   * already-seeded country's officials and NPPs exactly doubled, with no error
   * and no warning — FR 80→160, IT 80→160, UK 72→144, SE 40→80, TR 16→32,
   * ES 8→16, AT 20→40, FI 24→48, GR 18→36. All nine funnel through
   * `seedEconTierRostersForCountry` (UK gets its own scoped call from
   * `bootstrapGameWorld`, so it is not an exception).
   *
   * OPT-IN, deliberately. `backfillMissingSeats` computes its own per-region
   * shortfall (`target − Σ seatsHeld`) and then passes ONLY the missing seats,
   * so it REQUIRES append semantics — turning this on globally would make it
   * skip exactly the gap it just measured and silently stop backfilling. The
   * destructive admin re-seeds (`seedUK`/`seedDE`/`seedJP`/`seedNG`) delete
   * their officials first, so they are already idempotent and do not need it.
   *
   * Chamber identity, not generated name, is the key: NPP names are random, so
   * they can never identify a re-run.
   *
   * Covers BOTH seed modes, keyed on whatever that mode actually leaves behind:
   * seated `electedOfficials` in `"winners"`, and the `seededForOfficeType`
   * marker on the candidate NPPs in `"priors"` (which seats no officials by
   * design, so the officials key would be inert there). The `"priors"` path is
   * load-bearing: enabling the pre-iteration founding phase by default for
   * 1953 makes it the primary reset path.
   *
   * GRAIN CAVEAT — whole-chamber, which assumes a chamber lands all-or-nothing.
   * `seedFromSeats` does issue a single bulk `insertMany` per collection per
   * call, and the realistic failure (the process dying between phases, as it did
   * live) is all-or-nothing. But `insertMany` is NOT atomic across documents:
   * an ordered batch that errors at document k leaves 0..k−1 inserted. In that
   * narrow case this guard sees the chamber as seeded and leaves it SHORT rather
   * than doubling it — a strictly better failure than the one being fixed, but
   * not a no-op. Converging from a partial land needs per-seat grain: a
   * deterministic keyed upsert instead of an append. See the PR body.
   */
  skipAlreadySeatedChambers?: boolean;
}

/**
 * Creates office type based on seat data
 */
export function buildOfficeType(seat: HistoricalSeat): OfficeType | null {
  switch (seat.officeType) {
    case "house":
      return { type: "house", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "senate":
      return { type: "senate", state: seat.state };
    case "president":
      return { type: "president" };
    case "vicePresident":
      // National executive — no sub-national state (seat.state carries the country code).
      return { type: "vicePresident" };
    case "governor":
      return { type: "governor", state: seat.state };
    case "commons":
      return { type: "commons", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "stateSenate":
      return { type: "stateSenate", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "regionalCouncil":
      return { type: "regionalCouncil", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "shugiin":
      return { type: "shugiin", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "sangiin":
      return {
        type: "sangiin",
        state: seat.state,
        seatsHeld: seat.seatsHeld ?? 1,
        chamberClass: seat.chamberClass,
      } as OfficeType;
    case "npcDelegate":
      return { type: "npcDelegate", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "peoplesCongress":
      // CN Provincial People's Congress — sub-national multi-seat chamber.
      // seatsHeld set by the splitter so 7 CCP NPPs hold ~1/7 of the
      // CCP allocation per province.
      return { type: "peoplesCongress", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "republicSupremeSoviet":
      // RU republic Supreme Soviets — the one-party sub-national analog of the
      // CN People's Congress (multi-seat per republic, seatsHeld-backed). #3386.
      return { type: "republicSupremeSoviet", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "bundestag":
      // DE Bundestag is a multi-seat Land-proportional chamber; seatsHeld lives on
      // ElectedOfficial, but OfficeType only types {type,state}. Use escape hatch.
      return { type: "bundestag", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "landtag":
      return { type: "landtag", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "ministerPresident":
      return { type: "ministerPresident", state: seat.state };
    case "dail":
      // IE Dáil constituencies — multi-seat STV chamber. seatsHeld varies per region.
      return { type: "dail", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "seanad":
      // IE Seanad regions — multi-seat upper chamber. seatsHeld varies per region.
      return { type: "seanad", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "uachtaran":
      // IE Uachtarán — single-seat national; no state.
      return { type: "uachtaran" };
    case "localCouncil":
      // IE Local Councils — multi-seat per region. seatsHeld varies per region.
      return { type: "localCouncil", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "chamber":
      // BR Chamber of Deputies — multi-seat proportional chamber. seatsHeld varies per region.
      return { type: "chamber", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "volkskammerDeputy":
      // DD Volkskammer — single-list National Front chamber (multi-seat per
      // region, seatsHeld-backed), the GDR analog of the RU Supreme Soviet.
      return { type: "volkskammerDeputy", state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    case "deputy":
    case "senator":
    case "member":
    case "procurador":
      // Beta-parliament office-type keys (FR/IT/ES/SE/TR + ES 1953 Cortes).
      // Multi-seat regional PR; seatsHeld varies per region.
      return { type: seat.officeType, state: seat.state, seatsHeld: seat.seatsHeld ?? 1 };
    default:
      return null;
  }
}

/**
 * Resolve a party slug to its sequentialId string.
 * Falls back to "independent" if party not found.
 */
async function resolvePartyId(
  db: Db,
  partySlug: string,
  countryId: CountryId,
  partyCache: Map<string, PoliticalParty>
): Promise<string> {
  if (INDEPENDENT_SLUGS.has(partySlug)) {
    return "independent";
  }

  // Check cache first
  const cacheKey = `${countryId}:${partySlug}`;
  const cached = partyCache.get(cacheKey);
  if (cached) {
    return String(cached.sequentialId);
  }

  // Try to find by name
  const partyName = SLUG_TO_NAME[partySlug];
  if (partyName) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: partyName, countryId });
    if (party) {
      partyCache.set(cacheKey, party);
      return String(party.sequentialId);
    }
  }

  // Fallback: substring-match the incoming string against a party NAME. Handles
  // two caller conventions: full names passed straight through (notably
  // backfillMissingSeats) and bare slugs that aren't SLUG_TO_NAME keys (e.g.
  // "republican" → "Republican Party"). Regex metacharacters MUST be escaped —
  // otherwise a name containing them (e.g. "Communist Party (Baltic Republics)",
  // "Christlich-Demokratische Union (Ost)") builds a regex whose parens act as a
  // capture group and never match the literally-parenthesised stored name,
  // silently defaulting the whole delegation to "independent". Not anchored:
  // substring matching is load-bearing for the bare-slug callers above.
  const fallbackParty = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ name: { $regex: new RegExp(escapeRegex(partySlug), "i") }, countryId });
  if (fallbackParty) {
    partyCache.set(cacheKey, fallbackParty);
    return String(fallbackParty.sequentialId);
  }

  console.warn(
    `[seedHistorical] Could not resolve party "${partySlug}" for ${countryId}, defaulting to independent`
  );
  return "independent";
}

/**
 * Seed historical NPPs and elected officials from a list of seats
 */
/**
 * `"winners"` (default) seats each historical seat's NPP as a sitting
 * `electedOfficial` (the pre-2026 behavior). `"priors"` creates the candidate
 * NPPs but leaves every chamber VACANT (no `electedOfficials`) so a live
 * pre-iteration founding election decides the actual seated composition; the
 * historical seat distribution informs the candidate field + the per-region
 * party-strength prior (see `deriveStatePartyOrgPriorsFromSeats`) rather than
 * the seated winners.
 */
export type SeedMode = "winners" | "priors";

export async function seedFromSeats(
  db: Db,
  seats: HistoricalSeat[],
  seedMode: SeedMode = "winners",
  options: SeedFromSeatsOptions = {}
): Promise<SeedResult> {
  if (seats.length === 0) {
    return { nppsCreated: 0, officialsCreated: 0, seatsSkipped: 0 };
  }
  const seatWinners = seedMode !== "priors";

  const now = new Date();

  // Build state → countryId lookup
  const allStates = await db
    .collection<State>("states")
    .find({})
    .project<{ _id: string; countryId: CountryId }>({ _id: 1, countryId: 1 })
    .toArray();
  const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

  // Idempotency guard (opt-in — see SeedFromSeatsOptions). A chamber already
  // seeded by a previous pass must be skipped, or this call appends a second
  // parallel roster instead of converging — how a retried reset silently doubled
  // nine countries' legislatures.
  //
  // The key is MODE-DEPENDENT, because the two modes leave different evidence:
  //
  //   "winners" — seats `electedOfficials`, so a seated NPP official for
  //     (countryId, officeType) IS the chamber's seededness.
  //
  //   "priors"  — creates candidate NPPs and deliberately seats NO officials
  //     (the founding election decides winners), so the officials key finds
  //     nothing and the guard would be inert. The NPP carries no other chamber
  //     identity either: `currentOffice` is null by construction, `homeState` is
  //     shared across a country's chambers, and the generated `name` is random.
  //     Hence `seededForOfficeType`, stamped at creation purely so this pass has
  //     a stable key to read back.
  const seededChambers = new Set<string>();
  if (options.skipAlreadySeatedChambers) {
    if (seatWinners) {
      const seated = await db
        .collection<ElectedOfficial>("electedOfficials")
        .aggregate<{ _id: { countryId?: string; officeType?: string } }>([
          { $match: { isNPP: true } },
          { $group: { _id: { countryId: "$countryId", officeType: "$officeType" } } },
        ])
        .toArray();
      for (const row of seated) {
        seededChambers.add(`${row._id?.countryId ?? "US"}:${row._id?.officeType ?? ""}`);
      }
    } else {
      // Live candidates only: `retiredAt: null` matches the existing-name query
      // above, so a retired prior-world roster never blocks a fresh founding seed.
      const seededCandidates = await db
        .collection<NPP>("npps")
        .aggregate<{ _id: { countryId?: string; officeType?: string } }>([
          { $match: { retiredAt: null, seededForOfficeType: { $ne: null } } },
          { $group: { _id: { countryId: "$countryId", officeType: "$seededForOfficeType" } } },
        ])
        .toArray();
      for (const row of seededCandidates) {
        if (!row._id?.officeType) continue;
        seededChambers.add(`${row._id?.countryId ?? "US"}:${row._id.officeType}`);
      }
    }
  }
  let seatsSkipped = 0;

  // Cache for party lookups
  const partyCache = new Map<string, PoliticalParty>();

  // Get existing names to avoid duplicates
  const existingNPPs = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null })
    .project({ name: 1 })
    .toArray();
  const existingNames = new Set(existingNPPs.map((n) => n.name));

  const nppsToInsert: NPP[] = [];
  const officialsToInsert: ElectedOfficial[] = [];

  // Determine country from state. National offices (e.g. president) pass the
  // country code itself as `state` (no sub-national state), so fall back to it
  // when the state isn't a known sub-national region.
  const countryForSeat = (seat: HistoricalSeat): CountryId =>
    stateCountryMap.get(seat.state) ??
    (seat.state in COUNTRY_CONFIGS ? (seat.state as CountryId) : "US");

  // Already-seeded chamber → this is a re-run, not a fresh seed.
  const isAlreadySeated = (seat: HistoricalSeat): boolean =>
    seededChambers.has(`${countryForSeat(seat)}:${seat.officeType}`);

  // One reservation instead of one round trip per seat. This predicate is the
  // SAME one the loop skips on below — deliberately a single function, because
  // a pre-count that drifts from the loop's skip would either strand ids or
  // run the pool dry mid-loop.
  //
  // Exact, not an upper bound: the only other `continue` in the loop sits after
  // the NPP has already been pushed (it skips seating an official, not creating
  // the NPP), so every id reserved here is consumed. And a pass where every
  // chamber is already seeded reserves nothing at all, which is what keeps a
  // no-op re-run a true no-op.
  const idPool = await reserveSequentialIds(
    db,
    "npp",
    seats.filter((seat) => !isAlreadySeated(seat)).length
  );
  let idCursor = 0;

  for (const seat of seats) {
    const nppCountryId = countryForSeat(seat);

    // Skip before any name/sequentialId is consumed so a no-op pass stays a
    // true no-op.
    if (isAlreadySeated(seat)) {
      seatsSkipped++;
      continue;
    }

    // Generate unique name (country-appropriate)
    let name = generateUniqueNPPName(Array.from(existingNames), 100, nppCountryId);
    if (!name) {
      name = `NPP ${Math.random().toString(36).substring(7)}`;
    }
    existingNames.add(name);

    // Draw from the block reserved above.
    const sequentialId = idPool[idCursor++];
    if (sequentialId === undefined) {
      // Unreachable unless the pre-count and the skip above disagree. Fail
      // loudly rather than insert an NPP with an undefined sequentialId.
      throw new Error(
        `seedFromSeats exhausted its reserved id block at seat ${idCursor} of ${idPool.length}`
      );
    }

    // Resolve party slug to sequentialId
    const partyId = await resolvePartyId(db, seat.party, nppCountryId, partyCache);

    // Positions: prefer the RESOLVED party's own economicPosition/socialPosition
    // (the single source of truth on the party doc, cached by resolvePartyId)
    // over the slug-keyed generateDefaultPolicies map. Backfilled seats — e.g.
    // the deliberately-vacant 1953 US/UK legislatures filled by
    // backfillMissingSeats — carry a party NAME ("Democratic Party"), which the
    // slug map ("democrat") never matched, so every backfilled NPP seeded at a
    // dead-centre (0,0). That nulled the authored per-era demographic appeal and
    // left Org/Registration as the sole vote driver (runaway one-party blowouts,
    // e.g. an 82% 1953 US presidential share). Fall back to the slug map only
    // when the resolved party carries no stored position.
    const resolvedParty = partyCache.get(`${nppCountryId}:${seat.party}`);
    const policies =
      resolvedParty && typeof resolvedParty.economicPosition === "number"
        ? { economic: resolvedParty.economicPosition, social: resolvedParty.socialPosition }
        : generateDefaultPolicies(seat.party);

    // Build office type. In "priors" mode the NPP is an unseated candidate
    // (chambers start vacant), so it carries no current office.
    const currentOffice = seatWinners ? buildOfficeType(seat) : null;

    // Assign demographics and avatar using the same pipeline as dynamic NPP generation
    const gender = Math.random() < 0.5 ? "male" : "female";
    const ethnicity = weightedRandomEthnicity(nppCountryId);
    const avatarUrl = selectPoliticianImage(nppCountryId, gender, ethnicity, name);

    // Create NPP
    const nppId = new ObjectId();
    const npp: NPP = {
      _id: nppId,
      sequentialId,
      name,
      countryId: nppCountryId,
      homeState: seat.state,
      gender,
      ethnicity,
      ...(avatarUrl && { avatarUrl }),
      politicalInfluence: 10,
      favorability: 50 + Math.random() * 20 - 10, // 40-60
      policies,
      party: partyId,
      currentOffice,
      // Seed provenance, stamped in BOTH modes. In "priors" mode `currentOffice`
      // is null by design, so this is the only thing on the document that
      // identifies which chamber the candidate was seeded for — the key the
      // idempotency guard needs.
      seededForOfficeType: seat.officeType,
      personality: generateDefaultPersonality(),
      generatedAt: now,
      retiredAt: null,
      influenceState: {
        totalTimesInfluenced: 0,
      },
      // Economy fields — initialized at creation (donor base 1 so NPPs earn a
      // small donor income from turn one) via the shared SSOT so every creation
      // path stays consistent.
      ...NPP_ECONOMY_DEFAULTS,
      archetypeApprovals: {},
      electionCooldowns: {},
      createdAt: now,
      updatedAt: now,
    };

    nppsToInsert.push(npp);

    // "priors" mode leaves the chamber vacant — the founding election seats the
    // winners — so skip the elected-official record entirely.
    if (!seatWinners) {
      continue;
    }

    // Create corresponding elected official record
    const official: ElectedOfficial = {
      _id: new ObjectId(),
      countryId: nppCountryId,
      officeType: seat.officeType,
      state: seat.state,
      isAppointment: false,
      characterId: null,
      characterName: name,
      party: partyId,
      isNPP: true,
      nppId,
      electedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    // Add office-specific fields
    if (
      seat.officeType === "house" ||
      seat.officeType === "commons" ||
      seat.officeType === "stateSenate" ||
      seat.officeType === "regionalCouncil" ||
      seat.officeType === "shugiin" ||
      seat.officeType === "sangiin" ||
      seat.officeType === "bundestag" ||
      seat.officeType === "landtag" ||
      seat.officeType === "npcDelegate" ||
      seat.officeType === "peoplesCongress" ||
      seat.officeType === "dail" ||
      seat.officeType === "seanad" ||
      seat.officeType === "localCouncil" ||
      seat.officeType === "chamber" ||
      seat.officeType === "volkskammerDeputy" ||
      seat.officeType === "supremeSovietDeputy" ||
      seat.officeType === "nationalitiesDeputy" ||
      // RU republic Supreme Soviets — multi-seat sub-national delegation office
      // (the CN People's Congress analog). Without this the backfilled
      // delegation collapses to one official per republic and the chamber seats
      // ~1 of its authored ~5000 seats, so the elections resolve near-empty
      // (#3386). Kept in sync with backfillMissingSeats.ts SEATS_HELD_OFFICE_TYPES.
      seat.officeType === "republicSupremeSoviet" ||
      // Beta-parliament office-type keys (FR/IT/ES/SE/TR + ES 1953 Cortes).
      seat.officeType === "deputy" ||
      seat.officeType === "senator" ||
      seat.officeType === "member" ||
      seat.officeType === "procurador"
    ) {
      official.seatsHeld = seat.seatsHeld ?? 1;
    }
    if (seat.officeType === "senate" && seat.senateClass) {
      official.senateClass = seat.senateClass;
    }
    if (seat.officeType === "sangiin" && seat.chamberClass) {
      (official as unknown as { chamberClass: number }).chamberClass = seat.chamberClass;
    }

    officialsToInsert.push(official);
  }

  // Bulk insert
  if (nppsToInsert.length > 0) {
    await db.collection<NPP>("npps").insertMany(nppsToInsert);
  }
  if (officialsToInsert.length > 0) {
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(officialsToInsert);
  }

  return {
    nppsCreated: nppsToInsert.length,
    officialsCreated: officialsToInsert.length,
    seatsSkipped,
  };
}

/**
 * Seed historical officials using a preset
 * @param db Database instance
 * @param presetId Preset ID from RESET_PRESETS (default: "2019-default")
 * @param seedMode "winners" (default) seats historical incumbents; "priors"
 *   leaves chambers vacant for a pre-iteration founding election to fill (see
 *   {@link seedFromSeats}).
 */
export async function seedHistoricalOfficials(
  db: Db,
  presetId: string = "2019-default",
  seedMode: SeedMode = "winners"
): Promise<SeedResult> {
  const seats = getPresetSeats(presetId);
  // Same idempotency contract as the econ-tier rosters: this seeds a country's
  // authored FULL chamber, so a second pass must converge, not append. A full
  // `resetGameWorld` wipes electedOfficials before this runs, making the guard a
  // no-op there; it earns its keep on the seed-only / re-run paths
  // (`bootstrapGameWorld({ seedOnly })`, the admin re-seed buttons) that do NOT
  // wipe first. `seedHistoricalOfficialsForCountry` is left on append semantics.
  const result = await seedFromSeats(db, seats, seedMode, { skipAlreadySeatedChambers: true });

  // RU governmentFormations doc links the Premier NPP just seeded from the SU
  // executive rows (D5: RU starts FORMED). Lives here — behind the
  // seedHistoricalOfficials seam every orchestrator/contract test already
  // mocks — so both the bootstrap and seed-only paths get the linkage.
  // Dynamic narrow import keeps the admin seeder graph out of this module's
  // static dependencies. No-op when the preset seeds no RU regions; in
  // "priors" founding mode the executives are unseeded, so the formation
  // degrades to "pending" and the founding elections form it properly.
  const { seedRUGovernmentFormation } = await import("@/lib/admin/seed/seedRU");
  await seedRUGovernmentFormation(db, () => {});

  // Same for BR: when the preset seeds a presidential incumbent (1953 PTB
  // ticket), stamp governmentFormations as FORMED with presidentNppId. Early
  // country seeders may have written a pending doc before officials existed.
  const { seedBRGovernmentFormation } = await import("@/lib/admin/seed/seedBR");
  await seedBRGovernmentFormation(db, () => {});

  return result;
}

/**
 * Seed historical officials for all active countries (uses 2019-default preset)
 * @deprecated Use seedHistoricalOfficials with a preset ID instead
 */
export async function seedAllHistoricalOfficials(db: Db): Promise<SeedResult> {
  return seedHistoricalOfficials(db, "2019-default");
}

/**
 * Seed historical officials for a single country. Filters the preset seats
 * by state ownership so a run doesn't disturb other countries' data.
 */
export async function seedHistoricalOfficialsForCountry(
  db: Db,
  countryId: CountryId,
  presetId: string = "2019-default"
): Promise<SeedResult> {
  const allSeats = getPresetSeats(presetId);
  const countryStateIds = new Set(
    (
      await db
        .collection<State>("states")
        .find({ countryId }, { projection: { _id: 1 } })
        .toArray()
    ).map((s) => s._id)
  );
  const scoped = allSeats.filter((s) => countryStateIds.has(s.state));
  return seedFromSeats(db, scoped);
}
