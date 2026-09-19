/**
 * RU (Soviet Union) seat apportionment constants — spec D11.
 *
 * The Soviet of the UNION has no map here: its apportionment is
 * `region.houseDistricts` (ruRegions1953 / ruRegions), invariant-tested in
 * sovietSeatMap.test.ts — a parallel map would drift.
 *
 * The Soviet of NATIONALITIES is republic-weighted, not population-weighted:
 * 25 seats per union republic a macro-region groups, plus 11 per autonomous
 * republic, with an in-game floor of 20 per region so every region has
 * contestable seats. The real formula's autonomous-oblast (5) and national-
 * okrug (1) tiers are omitted: the 14-region model does not represent those
 * entities. Ukraine, Byelorussia and the Baltics used to be RU regions and are
 * absent now: they are their own countries, and their 125 combined Nationalities
 * seats (25 + 25 + 75) left with them, taking the total from 640 to 515.
 * The Karelo-Finnish SSR is abstracted as the Karelian ASSR
 * under NWR. One table serves both Cold-War presets: the formula is
 * population-independent.
 */

/** Soviet of Nationalities seats per region. Total: 515. */
export const RU_NATIONALITIES_SEATS: Record<string, number> = {
  // RSFSR macro-regions. The RSFSR's own 25 union-republic seats sit in CEN
  // (seat of the RSFSR government); ASSR seats (11 each) land in the region
  // hosting the ASSR; regions with no ASSR take the 20-seat floor.
  CEN: 25, // RSFSR union-republic delegation
  NWR: 22, // Karelian + Komi ASSRs
  NOR: 20, // floor
  CBE: 20, // floor
  VOL: 44, // Tatar + Chuvash + Mari + Mordovian ASSRs
  NCA: 33, // Dagestan + North Ossetian + Kabardian ASSRs
  URA: 22, // Bashkir + Udmurt ASSRs
  WSB: 20, // floor
  ESB: 20, // Buryat ASSR (11) → floor
  FEA: 20, // Yakut ASSR (11) → floor
  // Non-RSFSR union republics.
  KAZ: 25, // Kazakh SSR
  TRA: 108, // Georgian + Armenian + Azerbaijani SSRs (75) + Abkhaz/Adjar/Nakhichevan ASSRs (33)
  CAS: 111, // Uzbek + Turkmen + Tajik + Kirghiz SSRs (100) + Karakalpak ASSR (11)
  MOL: 25, // Moldavian SSR
};
