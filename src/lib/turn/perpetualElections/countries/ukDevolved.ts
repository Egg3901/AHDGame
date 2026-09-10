import {
  SCO_REGIONAL_COUNCIL_SEATS,
  WAL_REGIONAL_COUNCIL_SEATS,
  ensureSecededChamberElections,
} from "../shared";

/** SCO Holyrood standup spawner (sibling to `ensureIEElections`). */
export async function ensureSCOElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "holyrood", now);
}

/** WAL Senedd standup spawner. */
export async function ensureWALElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "senedd", now);
}

/** SCO/WAL regional-governor (Provost / Leader) standup — one single-seat race per macro-region. */
export async function ensureSCOGovernorElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "governor", now, { seatsPerRegion: 1 });
}

export async function ensureWALGovernorElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "governor", now, { seatsPerRegion: 1 });
}

/** SCO/WAL regional-council standup — per-region seats from the council-area tables. */
export async function ensureSCORegionalCouncilElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "regionalCouncil", now, {
    seatsByRegion: SCO_REGIONAL_COUNCIL_SEATS,
  });
}

export async function ensureWALRegionalCouncilElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "regionalCouncil", now, {
    seatsByRegion: WAL_REGIONAL_COUNCIL_SEATS,
  });
}
