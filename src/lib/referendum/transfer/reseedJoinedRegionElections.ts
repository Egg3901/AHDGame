/**
 * Re-seed a region's races in the country it just joined — immediately at
 * transfer time, instead of waiting for the next turn's election phase — and
 * settle that country's chamber-size / majority math on the government doc.
 *
 * The per-country spawners are idempotent and country-scoped: they only create
 * races for regions that lack a live one (the newcomer), mirroring the live cycle
 * so the joined region resolves in sync with the rest of the country. The turn's
 * election phase re-runs them every turn, so this is the fast path, not the only
 * path — a best-effort failure here self-heals on the next turn.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIECathaoirleachElections,
  ensureDEElections,
} from "@/lib/turn/perpetualElections";
import { updateParliamentaryGovernmentSeats } from "@/lib/turn/parliamentaryGovernment";

export async function reseedJoinedRegionElections(
  db: Db,
  toCountryId: CountryId,
  now: Date
): Promise<void> {
  if (toCountryId === "IE") {
    // Dáil, Local Council, and Cathaoirleach (regional executive) for the newcomer.
    await ensureIEElections(now);
    await ensureIELocalCouncilElections(now);
    await ensureIECathaoirleachElections(now);
    // Grow the Dáil's recorded size + majority threshold on the government doc.
    await updateParliamentaryGovernmentSeats(db, toCountryId);
  }
  if (toCountryId === "DE") {
    // Bundestag races for the newcomer, then the chamber size and majority
    // threshold. `ensureDEElections` enumerates `states` by countryId, so it
    // picks up a Land that arrived a moment ago without being told which one.
    //
    // Germany has no Land-level spawner of its own, so a joined Land gets its
    // Landtag races from the ordinary turn phase rather than from here.
    await ensureDEElections(now);
    await updateParliamentaryGovernmentSeats(db, toCountryId);
  }
  // Future transfer targets register their region-election spawners here.
}
