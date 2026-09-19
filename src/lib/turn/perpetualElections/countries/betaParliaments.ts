import { ensureBetaParliamentElections, ensureBetaSenateElections } from "../shared";

/** FR Assemblée nationale spawner (5-year cycle; era-aware via preset anchors). */
export async function ensureFRElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("FR", "assembleeNationale", now, inFlightTurn);
}

/** IT Camera dei Deputati spawner (5-year cycle). */
export async function ensureITElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("IT", "cameraDeputati", now, inFlightTurn);
}

/** ES Congreso de los Diputados spawner (4-year cycle; NO-OP in 1953-default — Franco era). */
export async function ensureESElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("ES", "congresoDiputados", now, inFlightTurn);
}

/** SE Riksdag spawner (4-year cycle; 1953 seed contests the 230-seat Second Chamber). */
export async function ensureSEElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("SE", "riksdag", now, inFlightTurn);
}

/** TR Grand National Assembly spawner (4-year cycle). */
export async function ensureTRElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("TR", "milletMeclisi", now, inFlightTurn);
}

/**
 * GR / AT / FI lower chambers. These three used to be spawned from inside
 * `ensureTRElections`, which meant their elections only ran while Turkey's
 * phase ran and any failure or timing shift there was misattributed to TR.
 * They are unrelated countries and now own their COUNTRY_ELECTION_PHASES
 * entries. Spawning stays idempotent, so the split is behaviour-preserving
 * for a healthy TR phase and strictly more correct for an unhealthy one.
 */
export async function ensureGRElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("GR", "vouli", now, inFlightTurn);
}

export async function ensureATElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("AT", "nationalrat", now, inFlightTurn);
}

export async function ensureFIElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaParliamentElections("FI", "eduskunta", now, inFlightTurn);
}

// ─── Beta parliamentary countries: upper chambers / Senates (#3791) ─────────

/** FR Sénat spawner (9-year full-chamber cycle — see simplification note above). */
export async function ensureFRSenateElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaSenateElections("FR", "senat", now, inFlightTurn);
}

/** IT Senato della Repubblica spawner (concurrent with the Camera — same real election day). */
export async function ensureITSenateElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaSenateElections("IT", "senato", now, inFlightTurn);
}

/** ES Senado spawner (concurrent with the Congreso; NO-OP in 1953-default — Franco era). */
export async function ensureESSenateElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaSenateElections("ES", "senado", now, inFlightTurn);
}

/** TR Senate of the Republic spawner (1953-default only — see simplification note above). */
export async function ensureTRSenateElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureBetaSenateElections("TR", "senato", now, inFlightTurn);
}
