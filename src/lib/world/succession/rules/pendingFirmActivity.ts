/** A player firm waiting for a playable headquarters keeps its identity and
 * accounts, but cannot operate retained facilities until the owner chooses. */
export function excludePendingFederationFirms<
  Firm extends { _id: { toString(): string }; federationPendingHeadquartersId?: string },
  Facility extends { corporationId: { toString(): string } },
>(
  firms: readonly Firm[],
  facilities: readonly Facility[]
): { firms: Firm[]; facilities: Facility[] } {
  const pending = new Set(
    firms.filter((firm) => firm.federationPendingHeadquartersId).map((firm) => firm._id.toString())
  );
  return {
    firms: firms.filter((firm) => !pending.has(firm._id.toString())),
    facilities: facilities.filter((facility) => !pending.has(facility.corporationId.toString())),
  };
}
