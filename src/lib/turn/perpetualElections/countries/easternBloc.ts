import { ensureEasternBlocAssemblyElections } from "../shared";

/** Poland Sejm — unicameral one-party assembly (DD regional-delegate pattern). */
export async function ensurePLElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("PL", "sejm", "Sejm", now);
}

/** Czechoslovakia Chamber of the People. */
export async function ensureCSElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "CS",
    "chamberOfThePeople",
    "Chamber of the People",
    now
  );
}

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("HU", "nationalAssembly", "National Assembly", now);
}

/** Romania Grand National Assembly. */
export async function ensureROElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "RO",
    "grandNationalAssembly",
    "Grand National Assembly",
    now
  );
}

/** Bulgaria National Assembly. */
export async function ensureBGElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BG", "nationalAssembly", "National Assembly", now);
}

/** Yugoslavia Federal Assembly. */
export async function ensureYUElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("YU", "federalAssembly", "Federal Assembly", now);
}

// ─── Union republics: republican Supreme Soviets ────────────────────────────
//
// Mechanically these are the satellites' shape - one multi-seat single-list
// delegate election per region, seats from the live `houseDistricts` - but they
// ride a DIFFERENT canonical anchor. The "supremeSoviet" electionType maps to
// `ruRepublicSoviet` (1955 / 1980) rather than the satellites' `ddVolkskammer`,
// because the republican soviets were elected on the all-Union republic cycle,
// not on each satellite's own national schedule. Using the satellite anchor
// would have Kyiv going to the polls on the GDR's calendar.
//
// The RU regional-delegate path is the closer relative and is why this uses the
// shared assembly helper rather than a bespoke one: `ensureRURepublicSovietElections`
// does the same job for the republics RU still owns as regions.

/** Ukrainian SSR Supreme Soviet (435 deputies). */
export async function ensureUKRElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("UKR", "supremeSoviet", "Supreme Soviet", now);
}

/** Byelorussian SSR Supreme Soviet (360 deputies). */
export async function ensureBLRElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BLR", "supremeSoviet", "Supreme Soviet", now);
}

/** Baltic republican Supreme Soviets, modelled as one 300-seat chamber. */
export async function ensureBALElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BAL", "supremeSoviet", "Supreme Soviet", now);
}

// ─── Nigeria: House of Representatives ──────────────────────────────────────
