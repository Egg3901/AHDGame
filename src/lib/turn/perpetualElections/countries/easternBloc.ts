import { ensureEasternBlocAssemblyElections } from "../shared";

/** Poland Sejm — unicameral one-party assembly (DD regional-delegate pattern). */
export async function ensurePLElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections("PL", "sejm", "Sejm", now, inFlightTurn);
}

/** Czechoslovakia Chamber of the People. */
export async function ensureCSElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "CS",
    "chamberOfThePeople",
    "Chamber of the People",
    now,
    inFlightTurn
  );
}

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "HU",
    "nationalAssembly",
    "National Assembly",
    now,
    inFlightTurn
  );
}

/** Romania Grand National Assembly. */
export async function ensureROElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "RO",
    "grandNationalAssembly",
    "Grand National Assembly",
    now,
    inFlightTurn
  );
}

/** Bulgaria National Assembly. */
export async function ensureBGElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "BG",
    "nationalAssembly",
    "National Assembly",
    now,
    inFlightTurn
  );
}

/** Yugoslavia Federal Assembly. */
export async function ensureYUElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "YU",
    "federalAssembly",
    "Federal Assembly",
    now,
    inFlightTurn
  );
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
export async function ensureUKRElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "UKR",
    "supremeSoviet",
    "Supreme Soviet",
    now,
    inFlightTurn
  );
}

/** Byelorussian SSR Supreme Soviet (360 deputies). */
export async function ensureBLRElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "BLR",
    "supremeSoviet",
    "Supreme Soviet",
    now,
    inFlightTurn
  );
}

/** Baltic republican Supreme Soviets, modelled as one 300-seat chamber. */
export async function ensureBALElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "BAL",
    "supremeSoviet",
    "Supreme Soviet",
    now,
    inFlightTurn
  );
}

// ─── Nigeria: House of Representatives ──────────────────────────────────────
