import type { CountryId } from "@/lib/constants/countries";

function normalizePartyId(partyId: string | number): string {
  const normalized = String(partyId).trim();

  // Sequential party IDs are numeric; canonicalize padded inputs like "01"
  // so uploads and cleanup always share the same storage key.
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
}

/**
 * Scope uploaded party-logo files by both country and party ID, and keep a
 * trailing separator so sequential IDs like 1 and 10 never share a prefix.
 */
export function getPartyLogoStoragePrefix(countryId: CountryId, partyId: string | number): string {
  return `party-logos/${countryId.toLowerCase()}-${normalizePartyId(partyId)}-`;
}

export function getPartyLogoFilename(
  countryId: CountryId,
  partyId: string | number,
  timestamp: number,
  ext: string
): string {
  return `${getPartyLogoStoragePrefix(countryId, partyId)}${timestamp}.${ext}`;
}

export function getLocalPartyLogoFilenamePrefix(
  countryId: CountryId,
  partyId: string | number
): string {
  return `${countryId.toLowerCase()}-${normalizePartyId(partyId)}-`;
}
