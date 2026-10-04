/**
 * Electoral mandate intake (#2321): reads the governing party's platform,
 * its most recent locked manifesto and its chamber share, then hands them to
 * the pure `deriveElectoralMandate` rule. The governing agenda and the
 * caretaker-minister agenda both consume the result.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Party } from "@/lib/db/types";
import type {
  GovernmentFormation,
  PersistedElectoralMandate,
} from "@/lib/db/types/governmentFormation";
import { getManifestosCollection } from "@/lib/db/collections/manifestos";
import { getPledgeCatalogEntry } from "@/lib/countries/uk/manifesto/pledgeCatalog";
import { deriveElectoralMandate, type MandatePledge } from "./rules/electoralMandate";

type MandateGovernment = Pick<
  GovernmentFormation,
  "governingPartyId" | "seatsByParty" | "totalSeats"
>;

/** Governing party seat share, or null when no chamber result is recorded. */
export function governingSeatShare(gov: MandateGovernment): number | null {
  const partyId = gov.governingPartyId;
  if (!partyId) return null;
  const total = gov.totalSeats;
  const seats = gov.seatsByParty?.[partyId];
  if (!(typeof total === "number" && total > 0) || typeof seats !== "number") return null;
  return seats / total;
}

/**
 * Load and derive the governing party's mandate. Returns null when the
 * government has no governing party or the party record is missing.
 */
export async function loadElectoralMandate(
  db: Db,
  countryId: CountryId,
  gov: MandateGovernment,
  currentTurn: number
): Promise<PersistedElectoralMandate | null> {
  const partyId = gov.governingPartyId;
  if (!partyId) return null;
  const sequentialId = Number(partyId);
  if (!Number.isFinite(sequentialId)) return null;

  const party = await db
    .collection<Party>("parties")
    .findOne(
      { countryId, sequentialId },
      { projection: { economicPosition: 1, socialPosition: 1 } }
    );
  if (!party) return null;

  const latest = await getManifestosCollection(db)
    .find({ countryId, party: partyId, lockedAt: { $ne: null } })
    .sort({ lockedAt: -1 })
    .limit(1)
    .toArray();
  const pledges: MandatePledge[] = [];
  for (const pledge of latest[0]?.pledges ?? []) {
    const entry = getPledgeCatalogEntry(pledge.catalogEntryId);
    if (entry) pledges.push({ id: entry.id, policyDomain: entry.policyDomain });
  }

  const platform =
    typeof party.economicPosition === "number" && typeof party.socialPosition === "number"
      ? { economic: party.economicPosition, social: party.socialPosition }
      : null;

  const mandate = deriveElectoralMandate({
    platform,
    pledges,
    seatShare: governingSeatShare(gov),
  });

  const sources: PersistedElectoralMandate["sources"] = [];
  if (platform) sources.push("platform");
  if (pledges.length > 0) sources.push("manifesto");

  return {
    partyId,
    sources,
    domains: mandate.domains,
    strength: mandate.strength,
    computedTurn: currentTurn,
  };
}
