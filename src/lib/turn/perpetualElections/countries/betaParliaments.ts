import { ensureBetaParliamentElections, ensureBetaSenateElections } from "../shared";

/** FR Assemblée nationale spawner (5-year cycle; era-aware via preset anchors). */
export async function ensureFRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("FR", "assembleeNationale", now);
}

/** IT Camera dei Deputati spawner (5-year cycle). */
export async function ensureITElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("IT", "cameraDeputati", now);
}

/** ES Congreso de los Diputados spawner (4-year cycle; NO-OP in 1953-default — Franco era). */
export async function ensureESElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("ES", "congresoDiputados", now);
}

/** SE Riksdag spawner (4-year cycle; 1953 seed contests the 230-seat Second Chamber). */
export async function ensureSEElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("SE", "riksdag", now);
}

/** TR Grand National Assembly spawner (4-year cycle). */
export async function ensureTRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("TR", "milletMeclisi", now);
}

/**
 * GR / AT / FI lower chambers. These three used to be spawned from inside
 * `ensureTRElections`, which meant their elections only ran while Turkey's
 * phase ran and any failure or timing shift there was misattributed to TR.
 * They are unrelated countries and now own their COUNTRY_ELECTION_PHASES
 * entries. Spawning stays idempotent, so the split is behaviour-preserving
 * for a healthy TR phase and strictly more correct for an unhealthy one.
 */
export async function ensureGRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("GR", "vouli", now);
}

export async function ensureATElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("AT", "nationalrat", now);
}

export async function ensureFIElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("FI", "eduskunta", now);
}

// ─── Beta parliamentary countries: upper chambers / Senates (#3791) ─────────

/** FR Sénat spawner (9-year full-chamber cycle — see simplification note above). */
export async function ensureFRSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("FR", "senat", now);
}

/** IT Senato della Repubblica spawner (concurrent with the Camera — same real election day). */
export async function ensureITSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("IT", "senato", now);
}

/** ES Senado spawner (concurrent with the Congreso; NO-OP in 1953-default — Franco era). */
export async function ensureESSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("ES", "senado", now);
}

/** TR Senate of the Republic spawner (1953-default only — see simplification note above). */
export async function ensureTRSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("TR", "senato", now);
}
